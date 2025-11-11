import { PrismaClient, ScorecardType } from '@prisma/client';

const SCRIPT_ACTOR = 'scripts/rebuild-review-summations';
const DEFAULT_BATCH_SIZE = 100;
const TARGET_SCORECARD_TYPES = [
  ScorecardType.REVIEW,
  ScorecardType.ITERATIVE_REVIEW,
];

interface ScriptOptions {
  dryRun: boolean;
  batchSize: number;
  limit?: number;
  submissionId?: string;
}

interface ScriptSummary {
  examined: number;
  updated: number;
  deleted: number;
  dryRunUpdates: number;
  dryRunDeletes: number;
  skippedNoScore: number;
  skippedMissingScorecard: number;
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

function parseArgs(): ScriptOptions {
  const args = process.argv.slice(2);
  const options: ScriptOptions = {
    dryRun: false,
    batchSize: DEFAULT_BATCH_SIZE,
  };

  for (const arg of args) {
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg.startsWith('--batch-size=')) {
      const [, raw] = arg.split('=', 2);
      const value = Number.parseInt(raw ?? '', 10);
      if (Number.isInteger(value) && value > 0) {
        options.batchSize = value;
      }
      continue;
    }

    if (arg.startsWith('--limit=')) {
      const [, raw] = arg.split('=', 2);
      const value = Number.parseInt(raw ?? '', 10);
      if (Number.isInteger(value) && value > 0) {
        options.limit = value;
      }
      continue;
    }

    if (arg.startsWith('--submission=')) {
      const [, submissionId] = arg.split('=', 2);
      if (submissionId?.trim()) {
        options.submissionId = submissionId.trim();
      }
    }
  }

  return options;
}

function roundScore(value: number) {
  return Math.round(value * 100) / 100;
}

function getPassingThreshold(scorecard: {
  minimumPassingScore: number | null;
  minScore: number;
}) {
  if (
    typeof scorecard.minimumPassingScore === 'number' &&
    Number.isFinite(scorecard.minimumPassingScore)
  ) {
    return scorecard.minimumPassingScore;
  }
  return scorecard.minScore ?? 0;
}

function selectBestReview(
  reviews: Array<{
    id: string;
    submissionId: string | null;
    finalScore: number | null;
    initialScore: number | null;
    scorecardId: string | null;
    scorecard: {
      id: string;
      legacyId: string | null;
      minScore: number;
      minimumPassingScore: number | null;
      type: ScorecardType;
    } | null;
  }>,
) {
  const bestBySubmission = new Map<
    string,
    (typeof reviews)[number] & { effectiveScore: number }
  >();

  for (const review of reviews) {
    if (!review.submissionId) {
      continue;
    }

    const score =
      typeof review.finalScore === 'number'
        ? review.finalScore
        : typeof review.initialScore === 'number'
          ? review.initialScore
          : null;
    if (score === null || !Number.isFinite(score)) {
      continue;
    }

    const existing = bestBySubmission.get(review.submissionId);
    if (!existing || score > existing.effectiveScore) {
      bestBySubmission.set(review.submissionId, {
        ...review,
        effectiveScore: score,
      });
    }
  }

  return bestBySubmission;
}

async function processBatch(
  batch: Array<{ id: string; submissionId: string }>,
  options: ScriptOptions,
  summary: ScriptSummary,
) {
  if (!batch.length) {
    return;
  }

  const submissionIds = Array.from(
    new Set(batch.map((summation) => summation.submissionId)),
  );
  const reviews = await prisma.review.findMany({
    where: {
      submissionId: {
        in: submissionIds,
      },
      committed: true,
      scorecard: {
        type: {
          in: TARGET_SCORECARD_TYPES,
        },
      },
    },
    select: {
      id: true,
      submissionId: true,
      finalScore: true,
      initialScore: true,
      scorecardId: true,
      scorecard: {
        select: {
          id: true,
          legacyId: true,
          minScore: true,
          minimumPassingScore: true,
          type: true,
        },
      },
    },
  });

  const bestReviewBySubmission = selectBestReview(reviews);

  for (const summation of batch) {
    summary.examined += 1;

    const review = bestReviewBySubmission.get(summation.submissionId);
    if (!review) {
      if (options.dryRun) {
        summary.dryRunDeletes += 1;
        console.info(
          `[DRY-RUN] Would delete reviewSummation ${summation.id} because no committed review exists for submission ${summation.submissionId}.`,
        );
        continue;
      }

      await prisma.reviewSummation.delete({
        where: { id: summation.id },
      });
      summary.deleted += 1;
      continue;
    }

    if (!review.scorecardId || !review.scorecard) {
      summary.skippedMissingScorecard += 1;
      console.warn(
        `Review ${review.id} for submission ${summation.submissionId} is missing scorecard details.`,
      );
      continue;
    }

    const aggregateScore = roundScore(review.effectiveScore);
    if (!Number.isFinite(aggregateScore)) {
      summary.skippedNoScore += 1;
      console.warn(
        `Review ${review.id} has an invalid score (${review.effectiveScore}).`,
      );
      continue;
    }

    const threshold = getPassingThreshold(review.scorecard);
    const isPassing = aggregateScore >= threshold;

    if (options.dryRun) {
      summary.dryRunUpdates += 1;
      console.info(
        `[DRY-RUN] Would update reviewSummation ${summation.id} using review ${review.id} with score ${aggregateScore} and scorecard ${review.scorecardId}. (isPassing=${isPassing})`,
      );
      continue;
    }

    await prisma.reviewSummation.update({
      where: { id: summation.id },
      data: {
        aggregateScore,
        scorecardId: review.scorecardId,
        scorecardLegacyId: review.scorecard.legacyId,
        isPassing,
        updatedBy: SCRIPT_ACTOR,
      },
    });
    summary.updated += 1;
  }
}

async function main() {
  const options = parseArgs();
  const summary: ScriptSummary = {
    examined: 0,
    updated: 0,
    deleted: 0,
    dryRunUpdates: 0,
    dryRunDeletes: 0,
    skippedNoScore: 0,
    skippedMissingScorecard: 0,
  };

  try {
    let cursorId: string | null = null;

    while (true) {
      const remaining =
        options.limit !== undefined ? options.limit - summary.examined : null;
      if (remaining !== null && remaining <= 0) {
        break;
      }

      const take = remaining
        ? Math.min(options.batchSize, remaining)
        : options.batchSize;

      const batch = await prisma.reviewSummation.findMany({
        where: {
          aggregateScore: 0,
          scorecardId: null,
          ...(options.submissionId
            ? { submissionId: options.submissionId }
            : {}),
        },
        select: {
          id: true,
          submissionId: true,
        },
        orderBy: { id: 'asc' },
        take,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      });

      if (!batch.length) {
        break;
      }

      await processBatch(batch, options, summary);
      cursorId = batch[batch.length - 1]?.id ?? null;
    }

    console.info(
      JSON.stringify(
        {
          ...summary,
          dryRun: options.dryRun,
          actor: SCRIPT_ACTOR,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Failed to rebuild review summations:', error);
  process.exitCode = 1;
});
