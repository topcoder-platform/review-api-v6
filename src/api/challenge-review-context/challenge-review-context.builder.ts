/**
 * Builds the deterministic part of the unified challenge review context.
 *
 * The AI "challenge-context" workflow in tc-ai-api produces a unified context
 * whose non-AI fields are mapped straight from the Challenge API payload.
 * Contexts created manually in Work Manager only carry `requirements`, so the
 * review API backfills these fields at read time using the same mapping.
 * Keep this mapping aligned with `parseChallengeContext` in
 * tc-ai-api/src/mastra/workflows/challenge/challenge-context-workflow.ts.
 */

type UnknownRecord = Record<string, unknown>;

export interface ReviewContextScorecard {
  id: string;
  name: string;
  version: string;
  status: string;
  type: string;
  challengeTrack: string;
  challengeType: string;
  minScore: number;
  minimumPassingScore: number;
  maxScore: number;
  scorecardGroups: Array<{
    id: string;
    name: string;
    weight: number;
    sortOrder: number;
    sections: Array<{
      id: string;
      name: string;
      weight: number;
      sortOrder: number;
      questions: Array<{
        id: string;
        type: string;
        description: string;
        guidelines: string;
        weight: number;
        requiresUpload?: boolean;
        scaleMin?: number | null;
        scaleMax?: number | null;
        sortOrder: number;
      }>;
    }>;
  }>;
}

const DAY_MS = 86_400_000;

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Returns the scorecard id of the human (member) reviewer, if any.
 *
 * @param challenge raw Challenge API payload
 * @returns scorecard id used by the member review, or undefined
 */
export function findMemberReviewScorecardId(
  challenge: UnknownRecord,
): string | undefined {
  const reviewer = asArray(challenge.reviewers)
    .map(asRecord)
    .find((r) => r?.isMemberReview === true);
  const scorecardId = asString(reviewer?.scorecardId).trim();
  return scorecardId || undefined;
}

/**
 * Maps a Challenge API payload to the deterministic unified-context fields.
 * AI-extracted fields are seeded only where an honest empty value exists
 * (`requirements`, `requirement_groups`, `tech_stack`); the structured
 * `runtime_environment`, `existing_codebase` and `submission_guidelines`
 * objects require AI extraction and are left out.
 *
 * @param challenge raw Challenge API payload
 * @param scorecard member-review scorecard, or null when unavailable
 * @returns unified-context fields derived from challenge data
 */
export function buildDeterministicReviewContext(
  challenge: UnknownRecord,
  scorecard: ReviewContextScorecard | null,
): UnknownRecord {
  const startDate =
    asString(challenge.startDate) || asString(challenge.registrationStartDate);
  const endDate = asString(challenge.endDate);
  const startMs = startDate ? new Date(startDate).getTime() : NaN;
  const endMs = endDate ? new Date(endDate).getTime() : NaN;
  const totalDurationDays =
    Number.isFinite(startMs) && Number.isFinite(endMs)
      ? Math.round((endMs - startMs) / DAY_MS)
      : 0;

  const placementPrizeSet = asArray(challenge.prizeSets)
    .map(asRecord)
    .find((ps) => ps?.type === 'PLACEMENT');
  const prizes = asArray(placementPrizeSet?.prizes)
    .map(asRecord)
    .filter((p): p is UnknownRecord => !!p)
    .map((p, idx) => ({
      placement: idx + 1,
      value: asNumber(p.value),
      currency: asString(p.type),
    }));

  const skills = asArray(challenge.skills)
    .map(asRecord)
    .filter((s): s is UnknownRecord => !!s)
    .map((s) => ({ id: asString(s.id), name: asString(s.name) }));

  const reviewers = asArray(challenge.reviewers)
    .map(asRecord)
    .filter((r): r is UnknownRecord => !!r)
    .map((r) => ({
      scorecardId: asString(r.scorecardId),
      isMemberReview: r.isMemberReview === true,
      type: typeof r.type === 'string' ? r.type : undefined,
      aiWorkflowId:
        typeof r.aiWorkflowId === 'string' ? r.aiWorkflowId : undefined,
    }));

  const discussionUrl = asString(
    asRecord(asArray(challenge.discussions)[0])?.url,
  );
  const privateDescription = asString(challenge.privateDescription);

  const context: UnknownRecord = {
    challengeId: asString(challenge.id),
    title: asString(challenge.name),
    descriptionRaw: asString(challenge.description),
    descriptionFormat: asString(challenge.descriptionFormat) || 'markdown',
    requirements: [],
    requirement_groups: [],
    tech_stack: [],
    skills,
    challenge_metadata: {
      status: asString(challenge.status),
      track: asString(asRecord(challenge.track)?.name),
      type: asString(asRecord(challenge.type)?.name),
      totalPrizes: asNumber(asRecord(challenge.overview)?.totalPrizes),
      numOfRegistrants: asNumber(challenge.numOfRegistrants),
      numOfSubmissions: asNumber(challenge.numOfSubmissions),
      isTask: asRecord(challenge.task)?.isTask === true,
    },
    timeline: {
      registrationStartDate: asString(challenge.registrationStartDate),
      registrationEndDate: asString(challenge.registrationEndDate),
      startDate,
      endDate,
      totalDurationDays,
    },
    prizes,
    review_criteria: {
      reviewType: asString(asRecord(challenge.legacy)?.reviewType) || 'UNKNOWN',
      reviewers,
      scorecard,
    },
  };

  if (privateDescription) {
    context.privateDescription = privateDescription;
  }
  if (discussionUrl) {
    context.discussion_url = discussionUrl;
  }

  return context;
}

/**
 * Top-level keys that `buildDeterministicReviewContext` always produces.
 * Optional keys (`privateDescription`, `discussion_url`) are excluded so a
 * complete AI-generated context never triggers a backfill.
 */
const BACKFILLED_CONTEXT_KEYS = [
  'challengeId',
  'title',
  'descriptionRaw',
  'descriptionFormat',
  'requirements',
  'requirement_groups',
  'tech_stack',
  'skills',
  'challenge_metadata',
  'timeline',
  'prizes',
  'review_criteria',
] as const;

/**
 * Checks whether a stored context lacks any deterministic top-level field.
 *
 * @param stored context persisted in challengeReviewContext.context
 * @returns true when at least one backfillable key is missing
 */
export function isReviewContextIncomplete(stored: UnknownRecord): boolean {
  return BACKFILLED_CONTEXT_KEYS.some(
    (key) => stored[key] === undefined || stored[key] === null,
  );
}

/**
 * Fills top-level keys missing from a stored context with derived values.
 * Keys present in the stored context always win, so human edits and
 * AI-generated snapshots are never overwritten.
 *
 * @param stored context persisted in challengeReviewContext.context
 * @param derived deterministic fields built from current challenge data
 * @returns stored context with missing top-level keys backfilled
 */
export function backfillReviewContext(
  stored: UnknownRecord,
  derived: UnknownRecord,
): UnknownRecord {
  const result: UnknownRecord = { ...stored };
  for (const [key, value] of Object.entries(derived)) {
    if (result[key] === undefined || result[key] === null) {
      result[key] = value;
    }
  }
  return result;
}
