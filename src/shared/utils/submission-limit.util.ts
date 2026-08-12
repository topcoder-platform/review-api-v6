import type { ChallengeData } from 'src/shared/modules/global/challenge.service';

type SubmissionLimitChallenge = Pick<ChallengeData, 'track' | 'legacy'> & {
  metadata?: Record<string, unknown> | undefined;
};

type SubmissionLimitPolicy =
  | { mode: 'finite'; count: number }
  | { mode: 'unlimited' }
  | { mode: 'malformed' };

const SUBMISSION_LIMIT_COUNT_FIELDS = [
  'count',
  'max',
  'maximum',
  'limitCount',
  'value',
] as const;

/**
 * Converts a submission-limit count to a positive integer.
 *
 * @param value - Raw scalar count from current or legacy challenge metadata.
 * @returns The positive integer count, or null when the value is not a limit.
 * @throws Never.
 */
function toPositiveInteger(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') {
    return null;
  }

  const numericValue = Number(value);
  return Number.isSafeInteger(numericValue) && numericValue > 0
    ? numericValue
    : null;
}

/**
 * Parses a loosely typed submission-limit metadata flag.
 *
 * @param value - Boolean-like value from submission-limit metadata.
 * @returns The parsed boolean, or null when the flag is not recognizable.
 * @throws Never.
 */
function parseMetadataBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalizedValue = value.trim().toLowerCase();
    if (['true', 'yes', '1'].includes(normalizedValue)) {
      return true;
    }
    if (['false', 'no', '0'].includes(normalizedValue)) {
      return false;
    }
    return null;
  }

  if (value === 1) {
    return true;
  }
  if (value === 0) {
    return false;
  }

  return null;
}

/**
 * Resolves raw current or legacy metadata into one submission-limit policy.
 *
 * Current and legacy count aliases share the same precedence as Autopilot.
 * Equal recognized `limit` and `unlimited` flags are contradictory. Otherwise
 * `unlimited=true` or `limit=false` takes precedence over a stale count.
 *
 * @param value - Raw `submissionLimit` challenge metadata value.
 * @returns A finite count, explicit unlimited mode, or malformed mode.
 * @throws Never; malformed serialized metadata is returned as malformed.
 */
function resolveSubmissionLimitPolicy(value: unknown): SubmissionLimitPolicy {
  let parsedValue = value;
  if (typeof value === 'string') {
    const normalizedValue = value.trim();
    if (!normalizedValue) {
      return { mode: 'malformed' };
    }

    try {
      parsedValue = JSON.parse(normalizedValue);
    } catch {
      parsedValue = normalizedValue;
    }
  }

  const primitiveLimit = toPositiveInteger(parsedValue);
  if (primitiveLimit !== null) {
    return { mode: 'finite', count: primitiveLimit };
  }

  if (typeof parsedValue === 'number' && parsedValue === 0) {
    return { mode: 'unlimited' };
  }

  if (typeof parsedValue === 'boolean') {
    return parsedValue ? { mode: 'malformed' } : { mode: 'unlimited' };
  }

  if (typeof parsedValue === 'string') {
    return ['unlimited', 'false', '0', 'no', 'none'].includes(
      parsedValue.trim().toLowerCase(),
    )
      ? { mode: 'unlimited' }
      : { mode: 'malformed' };
  }

  if (
    !parsedValue ||
    typeof parsedValue !== 'object' ||
    Array.isArray(parsedValue)
  ) {
    return { mode: 'malformed' };
  }

  const metadata = parsedValue as Record<string, unknown>;
  const unlimited = parseMetadataBoolean(metadata.unlimited);
  const limit = parseMetadataBoolean(metadata.limit);
  const countValue = SUBMISSION_LIMIT_COUNT_FIELDS.map(
    (fieldName) => metadata[fieldName],
  ).find(
    (candidate) =>
      candidate !== undefined && candidate !== null && candidate !== '',
  );
  const count = toPositiveInteger(countValue);
  const flagsConflict =
    unlimited !== null && limit !== null && unlimited === limit;

  if (flagsConflict) {
    return { mode: 'malformed' };
  }

  if (unlimited === true || limit === false) {
    return { mode: 'unlimited' };
  }

  return count === null ? { mode: 'malformed' } : { mode: 'finite', count };
}

/**
 * Reads the finite count from current or legacy submission-limit metadata.
 *
 * Current metadata uses `count`, `limit`, and `unlimited`. Legacy aliases
 * `max`, `maximum`, `limitCount`, and `value`, loose boolean flags, positive
 * scalar values, and flag-less count objects remain supported. Missing,
 * malformed, contradictory, invalid, or unlimited values are treated as
 * uncapped by submission creation.
 *
 * @param value - Raw `submissionLimit` challenge metadata value.
 * @returns A positive finite limit, or null when submissions are uncapped.
 * @throws Never; malformed serialized metadata is handled as uncapped.
 */
export function parseSubmissionLimitCount(value: unknown): number | null {
  const policy = resolveSubmissionLimitPolicy(value);
  return policy.mode === 'finite' ? policy.count : null;
}

/**
 * Checks whether metadata explicitly and consistently enables unlimited submissions.
 *
 * @param value - Raw `submissionLimit` challenge metadata value.
 * @returns True only for a recognizable unlimited value without a conflicting limit flag.
 * @throws Never; malformed serialized metadata is not treated as unlimited.
 */
export function isExplicitUnlimitedSubmissionLimit(value: unknown): boolean {
  return resolveSubmissionLimitPolicy(value).mode === 'unlimited';
}

/**
 * Determines whether challenge data identifies the Design track.
 *
 * @param challenge - Challenge data containing current and optional legacy track names.
 * @returns True when either track name is Design.
 * @throws Never.
 */
export function isDesignTrackChallenge(
  challenge: SubmissionLimitChallenge | null | undefined,
): boolean {
  return [challenge?.track, challenge?.legacy?.track].some(
    (track) =>
      String(track ?? '')
        .trim()
        .toLowerCase() === 'design',
  );
}

/**
 * Resolves the per-member rank limit used when selecting submissions for review.
 *
 * Design challenges use their configured finite count, allow all submissions
 * when metadata is missing or explicitly unlimited, and fail closed to the
 * latest submission for malformed metadata. Other tracks retain their
 * established latest-submission-only behavior. Missing challenge data also
 * fails closed to the latest submission.
 *
 * @param challenge - Challenge and submission-limit metadata.
 * @returns A positive maximum rank, or null when all Design submissions qualify.
 * @throws Never.
 */
export function resolveReviewSubmissionRankLimit(
  challenge: SubmissionLimitChallenge | null | undefined,
): number | null {
  if (!challenge || !isDesignTrackChallenge(challenge)) {
    return 1;
  }

  if (
    !challenge.metadata ||
    !Object.prototype.hasOwnProperty.call(
      challenge.metadata,
      'submissionLimit',
    ) ||
    challenge.metadata.submissionLimit === null ||
    challenge.metadata.submissionLimit === undefined
  ) {
    return null;
  }

  const policy = resolveSubmissionLimitPolicy(
    challenge.metadata.submissionLimit,
  );
  if (policy.mode === 'finite') {
    return policy.count;
  }

  return policy.mode === 'unlimited' ? null : 1;
}

/**
 * Checks whether a ranked submission falls within a configured review limit.
 *
 * @param rank - One-based member submission rank, newest first.
 * @param maximumRank - Positive maximum rank, or null for uncapped Design submissions.
 * @returns True when the submission is eligible for screening or review.
 * @throws Never.
 */
export function isSubmissionRankEligible(
  rank: number | null | undefined,
  maximumRank: number | null,
): boolean {
  if (maximumRank === null) {
    return true;
  }

  return (
    typeof rank === 'number' &&
    Number.isInteger(rank) &&
    rank > 0 &&
    rank <= maximumRank
  );
}
