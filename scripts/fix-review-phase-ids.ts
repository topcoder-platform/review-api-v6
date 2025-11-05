import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  PrismaClient as ReviewPrismaClient,
  ScorecardType,
} from '@prisma/client';
import { PrismaClient as ChallengePrismaClient } from '@prisma/client-challenge';

const SCRIPT_ACTOR = 'scripts/fix-review-phase-ids';
const DEFAULT_OUTPUT_FILE = 'ambiguous-review-phase-fixes.jsonl';
const DEFAULT_BATCH_SIZE = 500;

const SCORECARD_PHASE_NAME_MAP: Partial<Record<ScorecardType, string>> = {
  [ScorecardType.CHECKPOINT_SCREENING]: 'Checkpoint Screening',
  [ScorecardType.ITERATIVE_REVIEW]: 'Iterative Review',
  [ScorecardType.CHECKPOINT_REVIEW]: 'Checkpoint Review',
  [ScorecardType.SCREENING]: 'Screening',
  [ScorecardType.REVIEW]: 'Review',
  [ScorecardType.APPROVAL]: 'Approval',
};

interface ScriptOptions {
  dryRun: boolean;
  batchSize: number;
  outputPath: string;
}

interface ManualReviewEntry {
  reviewId: string;
  challengeId: string;
  reviewTypeName: string | null;
  scorecardType: ScorecardType | null;
  currentPhaseId: string;
  candidatePhaseIds: string[];
}

interface ReviewCandidate {
  id: string;
  phaseId: string;
  typeId: string | null;
  submission: {
    challengeId: string | null;
  } | null;
  scorecard: {
    type: ScorecardType;
  } | null;
}

const reviewPrisma = new ReviewPrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

const challengePrisma = new ChallengePrismaClient({
  datasources: {
    db: {
      url: process.env.CHALLENGE_DB_URL,
    },
  },
});

const challengePhaseCache = new Map<string, Array<{ id: string; name: string }>>();

function parseArgs(): ScriptOptions {
  const args = process.argv.slice(2);
  const options: ScriptOptions = {
    dryRun: false,
    batchSize: DEFAULT_BATCH_SIZE,
    outputPath: path.resolve(process.cwd(), DEFAULT_OUTPUT_FILE),
  };

  for (const arg of args) {
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg.startsWith('--output=')) {
      const [, rawPath] = arg.split('=', 2);
      if (rawPath) {
        options.outputPath = path.resolve(process.cwd(), rawPath);
      }
      continue;
    }

    if (arg.startsWith('--batch-size=')) {
      const [, value] = arg.split('=', 2);
      const parsed = Number.parseInt(value ?? '', 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        options.batchSize = parsed;
      }
      continue;
    }
  }

  return options;
}

async function loadValidPhaseIds() {
  const phases = await challengePrisma.challengePhase.findMany({
    select: { id: true },
  });
  const ids = new Set<string>();
  for (const phase of phases) {
    ids.add(phase.id);
  }
  return ids;
}

async function loadReviewTypeMap() {
  const types = await reviewPrisma.reviewType.findMany({
    select: {
      id: true,
      name: true,
    },
  });
  const map = new Map<string, string>();
  for (const type of types) {
    map.set(type.id, type.name);
  }
  return map;
}

function normalize(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? '';
}

function ensureDirectoryExists(filePath: string) {
  const directory = path.dirname(filePath);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

async function getChallengePhases(challengeId: string) {
  if (challengePhaseCache.has(challengeId)) {
    return challengePhaseCache.get(challengeId) ?? [];
  }

  const phases = await challengePrisma.challengePhase.findMany({
    where: { challengeId },
    select: {
      id: true,
      name: true,
    },
  });

  challengePhaseCache.set(challengeId, phases);
  return phases;
}

async function processInvalidReview(
  review: ReviewCandidate,
  reviewTypeMap: Map<string, string>,
  manualReviewEntries: ManualReviewEntry[],
  validPhaseIds: Set<string>,
  options: ScriptOptions,
) {
  const challengeId = review.submission?.challengeId?.trim();
  if (!challengeId) {
    console.warn(
      `Skipping review ${review.id} because the associated challengeId could not be determined.`,
    );
    return { updated: false };
  }

  const reviewTypeName = review.typeId
    ? reviewTypeMap.get(review.typeId) ?? null
    : null;

  const candidatePhaseNames: string[] = [];
  if (reviewTypeName) {
    candidatePhaseNames.push(reviewTypeName);
  }

  const scorecardType = review.scorecard?.type ?? null;
  if (scorecardType) {
    const mappedName = SCORECARD_PHASE_NAME_MAP[scorecardType];
    if (mappedName && !candidatePhaseNames.includes(mappedName)) {
      candidatePhaseNames.push(mappedName);
    }
  }

  if (!candidatePhaseNames.length) {
    console.warn(
      `Review ${review.id} has no review type or scorecard mapping to identify a target phase.`,
    );
    return { updated: false };
  }

  const challengePhases = await getChallengePhases(challengeId);
  if (!challengePhases.length) {
    console.warn(
      `Challenge ${challengeId} has no phases; review ${review.id} requires manual cleanup.`,
    );
    return { updated: false };
  }

  const matches = challengePhases.filter((phase) =>
    candidatePhaseNames.some(
      (name) => normalize(phase.name) === normalize(name),
    ),
  );

  if (matches.length === 0) {
    console.warn(
      `No matching phases found for review ${review.id} (challenge ${challengeId}).`,
    );
    return { updated: false };
  }

  if (matches.length > 1) {
    manualReviewEntries.push({
      reviewId: review.id,
      challengeId,
      reviewTypeName,
      scorecardType,
      currentPhaseId: review.phaseId,
      candidatePhaseIds: matches.map((phase) => phase.id),
    });
    console.warn(
      `Multiple phase matches found for review ${review.id} (challenge ${challengeId}); added to manual review list.`,
    );
    return { updated: false };
  }

  const selectedPhase = matches[0];

  if (review.phaseId === selectedPhase.id) {
    validPhaseIds.add(review.phaseId);
    return { updated: false };
  }

  if (options.dryRun) {
    console.log(
      `[dry-run] Would update review ${review.id} phaseId ${review.phaseId} -> ${selectedPhase.id}`,
    );
    validPhaseIds.add(selectedPhase.id);
    return { updated: false };
  }

  await reviewPrisma.review.update({
    where: { id: review.id },
    data: {
      phaseId: selectedPhase.id,
      updatedBy: SCRIPT_ACTOR,
    },
  });

  validPhaseIds.add(selectedPhase.id);
  console.log(
    `Updated review ${review.id}: phaseId ${review.phaseId} -> ${selectedPhase.id}`,
  );

  return { updated: true };
}

async function writeManualReviewFile(
  entries: ManualReviewEntry[],
  outputPath: string,
) {
  if (!entries.length) {
    return;
  }

  ensureDirectoryExists(outputPath);
  const content = entries
    .map((entry) => JSON.stringify(entry))
    .join('\n')
    .concat('\n');
  fs.writeFileSync(outputPath, content, 'utf-8');
  console.log(
    `Wrote ${entries.length} ambiguous review records to ${outputPath}.`,
  );
}

async function main() {
  const options = parseArgs();

  console.log('Loading challenge phase IDs...');
  const validPhaseIds = await loadValidPhaseIds();
  console.log(`Loaded ${validPhaseIds.size} challenge phase IDs.`);

  console.log('Loading review types...');
  const reviewTypeMap = await loadReviewTypeMap();
  console.log(`Loaded ${reviewTypeMap.size} review types.`);

  const manualReviewEntries: ManualReviewEntry[] = [];
  let processed = 0;
  let invalidCount = 0;
  let updatedCount = 0;

  let cursor: string | null = null;
  while (true) {
    const reviews = await reviewPrisma.review.findMany({
      select: {
        id: true,
        phaseId: true,
        typeId: true,
        submission: {
          select: { challengeId: true },
        },
        scorecard: {
          select: { type: true },
        },
      },
      orderBy: { id: 'asc' },
      take: options.batchSize,
      ...(cursor
        ? {
            skip: 1,
            cursor: { id: cursor },
          }
        : {}),
    });

    if (!reviews.length) {
      break;
    }

    for (const review of reviews as ReviewCandidate[]) {
      processed += 1;
      if (!review.phaseId || !validPhaseIds.has(review.phaseId)) {
        invalidCount += 1;
        const result = await processInvalidReview(
          review,
          reviewTypeMap,
          manualReviewEntries,
          validPhaseIds,
          options,
        );
        if (result.updated) {
          updatedCount += 1;
        }
      }
    }

    cursor = reviews[reviews.length - 1]?.id ?? null;
  }

  await writeManualReviewFile(manualReviewEntries, options.outputPath);

  console.log('Processing complete.');
  console.log(`Reviews scanned: ${processed}`);
  console.log(`Invalid phaseId detected: ${invalidCount}`);
  console.log(`Reviews updated: ${updatedCount}`);
  console.log(
    `Reviews requiring manual attention: ${manualReviewEntries.length}`,
  );
}

main()
  .catch((error) => {
    console.error('Script failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await reviewPrisma.$disconnect();
    await challengePrisma.$disconnect();
  });

