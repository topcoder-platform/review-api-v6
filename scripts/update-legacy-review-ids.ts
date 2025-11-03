import {
  PrismaClient as ReviewPrismaClient,
  ScorecardType,
  Prisma,
} from '@prisma/client';
import {
  PrismaClient as ChallengePrismaClient,
  ChallengePhase,
} from '@prisma/client-challenge';
import {
  PrismaClient as ResourcePrismaClient,
  Resource,
  ResourceRole,
} from '@prisma/client-resource';

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

const resourcePrisma = new ResourcePrismaClient({
  datasources: {
    db: {
      url: process.env.RESOURCE_DB_URL,
    },
  },
});

const SCRIPT_ACTOR = 'scripts/update-legacy-review-ids';

const SCORECARD_PHASE_NAME_MAP: Partial<Record<ScorecardType, string>> = {
  [ScorecardType.CHECKPOINT_SCREENING]: 'Checkpoint Screening',
  [ScorecardType.ITERATIVE_REVIEW]: 'Iterative Review',
  [ScorecardType.CHECKPOINT_REVIEW]: 'Checkpoint Review',
  [ScorecardType.SCREENING]: 'Screening',
  [ScorecardType.REVIEW]: 'Review',
  [ScorecardType.APPROVAL]: 'Approval',
};

const SCORECARD_RESOURCE_ROLE_PRIORITIES: Partial<
  Record<ScorecardType, string[]>
> = {
  [ScorecardType.ITERATIVE_REVIEW]: ['Iterative Reviewer', 'Reviewer'],
  [ScorecardType.REVIEW]: ['Reviewer', 'Iterative Reviewer'],
  [ScorecardType.SCREENING]: ['Screener', 'Checkpoint Screener'],
  [ScorecardType.APPROVAL]: ['Approver', 'Reviewer'],
  [ScorecardType.CHECKPOINT_SCREENING]: ['Checkpoint Screener', 'Screener'],
  [ScorecardType.CHECKPOINT_REVIEW]: ['Checkpoint Reviewer', 'Reviewer'],
};

const LEGACY_NUMERIC_REGEX = /^\d+$/;

interface ReviewRecord {
  id: string;
  resourceId: string;
  phaseId: string;
  submissionId: string | null;
  scorecardId: string;
  legacyResourceId: number | null;
  createdAt: Date;
  createdBy: string | null;
  scorecardType: ScorecardType;
  scorecardLegacyId: string | null;
  challengeId: string | null;
}

interface ResourceWithRole extends Resource {
  resourceRole: ResourceRole;
}

interface ComputedUpdate {
  reviewId: string;
  challengeId: string;
  submissionId: string | null;
  scorecardId: string;
  scorecardType: ScorecardType;
  scorecardLegacyId: string | null;
  phaseName: string;
  reviewCreatedAt: Date;
  memberId: string | null;
  legacyResourceId: number | null;
  oldPhaseId: string;
  newPhaseId?: string;
  phaseSelectionReason?: string;
  oldResourceId: string;
  newResourceId?: string;
  resourceRoleName?: string;
  resourceSelectionReason?: string;
}

function isLegacyId(value: string | null | undefined) {
  if (!value) {
    return false;
  }
  return LEGACY_NUMERIC_REGEX.test(value.trim());
}

function toCacheKey(challengeId: string, phaseName: string) {
  return `${challengeId}::${phaseName.toLowerCase()}`;
}

const phaseCache = new Map<string, ChallengePhase[]>();
const resourceCache = new Map<string, ResourceWithRole[]>();

async function getChallengePhases(
  challengeId: string,
  phaseName: string,
): Promise<ChallengePhase[]> {
  const key = toCacheKey(challengeId, phaseName);
  if (phaseCache.has(key)) {
    return phaseCache.get(key) ?? [];
  }

  const phases = await challengePrisma.challengePhase.findMany({
    where: {
      challengeId,
      name: {
        equals: phaseName,
        mode: 'insensitive',
      },
    },
    orderBy: [
      { scheduledStartDate: 'asc' },
      { actualStartDate: 'asc' },
      { createdAt: 'asc' },
    ],
  });

  phaseCache.set(key, phases);
  return phases;
}

async function getChallengeResources(
  challengeId: string,
): Promise<ResourceWithRole[]> {
  if (resourceCache.has(challengeId)) {
    return resourceCache.get(challengeId) ?? [];
  }

  const resources = await resourcePrisma.resource.findMany({
    where: { challengeId },
    include: { resourceRole: true },
  });

  resourceCache.set(challengeId, resources);
  return resources;
}

function selectResourceForReview(
  resources: ResourceWithRole[],
  memberId: string,
  scorecardType: ScorecardType,
  legacyResourceId: number | null,
): { resource: ResourceWithRole; reason: string } | null {
  if (legacyResourceId !== null) {
    const legacyMatch = resources.find(
      (resource) => resource.legacyId === legacyResourceId,
    );
    if (legacyMatch) {
      return {
        resource: legacyMatch,
        reason: `matched legacy resourceId ${legacyResourceId}`,
      };
    }
  }

  const trimmedMemberId = memberId.trim();
  const matching = resources.filter(
    (resource) => resource.memberId === trimmedMemberId,
  );

  if (!matching.length) {
    return null;
  }

  const requestedRoles =
    SCORECARD_RESOURCE_ROLE_PRIORITIES[scorecardType]?.map((role) =>
      role.toLowerCase(),
    ) ?? [];

  for (const requestedRole of requestedRoles) {
    const directMatch = matching.find(
      (resource) =>
        resource.resourceRole.nameLower === requestedRole ||
        resource.resourceRole.name.toLowerCase() === requestedRole,
    );
    if (directMatch) {
      return { resource: directMatch, reason: `matched role "${requestedRole}"` };
    }
  }

  if (matching.length === 1) {
    return { resource: matching[0], reason: 'only role for member' };
  }

  const reviewerLike = matching.find((resource) =>
    resource.resourceRole.nameLower.includes('review'),
  );
  if (reviewerLike) {
    return { resource: reviewerLike, reason: 'fallback reviewer-like role' };
  }

  return { resource: matching[0], reason: 'fallback first role for member' };
}

function sampleArray<T>(items: T[], size: number) {
  const pool = [...items];
  const sample: T[] = [];
  const targetSize = Math.min(size, pool.length);

  for (let i = 0; i < targetSize; i += 1) {
    const index = Math.floor(Math.random() * pool.length);
    sample.push(pool.splice(index, 1)[0]);
  }

  return sample;
}

async function fetchLegacyReviews(): Promise<ReviewRecord[]> {
  const reviews = await reviewPrisma.review.findMany({
    where: {
      OR: [
        {
          resourceId: {
            not: {
              contains: '-',
            },
          },
        },
        {
          phaseId: {
            not: {
              contains: '-',
            },
          },
        },
      ],
    },
    select: {
      id: true,
      resourceId: true,
      phaseId: true,
      submissionId: true,
      scorecardId: true,
      createdAt: true,
      createdBy: true,
      scorecard: {
        select: {
          type: true,
          legacyId: true,
        },
      },
      submission: {
        select: {
          challengeId: true,
        },
      },
    },
    orderBy: {
      id: 'asc',
    },
  });

  return reviews
    .filter(
      (review) =>
        isLegacyId(review.resourceId) || isLegacyId(review.phaseId),
    )
    .map((review) => ({
      id: review.id,
      resourceId: review.resourceId,
      phaseId: review.phaseId,
      submissionId: review.submissionId,
      scorecardId: review.scorecardId,
      legacyResourceId: isLegacyId(review.resourceId)
        ? Number.parseInt(review.resourceId, 10)
        : null,
      createdAt: review.createdAt,
      createdBy: review.createdBy,
      scorecardType: review.scorecard.type,
      scorecardLegacyId: review.scorecard.legacyId,
      challengeId: review.submission?.challengeId ?? null,
    }));
}

async function computeUpdates(): Promise<ComputedUpdate[]> {
  const legacyReviews = await fetchLegacyReviews();
  console.log(`Found ${legacyReviews.length} review(s) with legacy IDs.`);

  const grouped = new Map<string, ReviewRecord[]>();

  for (const review of legacyReviews) {
    if (!review.challengeId) {
      console.warn(
        `Skipping review ${review.id}: missing challengeId (submissionId = ${review.submissionId}).`,
      );
      continue;
    }

    const phaseName = SCORECARD_PHASE_NAME_MAP[review.scorecardType];
    if (!phaseName) {
      console.warn(
        `Skipping review ${review.id}: unsupported scorecard type ${review.scorecardType}.`,
      );
      continue;
    }

    const key = `${review.challengeId}::${review.scorecardType}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)?.push(review);
  }

  const updates: ComputedUpdate[] = [];

  for (const [, reviews] of grouped) {
    if (!reviews.length) {
      continue;
    }

    const { challengeId, scorecardType } = reviews[0];
    if (!challengeId) {
      continue;
    }

    const phaseName = SCORECARD_PHASE_NAME_MAP[scorecardType];
    if (!phaseName) {
      continue;
    }

    const phases = await getChallengePhases(challengeId, phaseName);
    if (!phases.length) {
      console.warn(
        `Challenge ${challengeId}: no phases found matching "${phaseName}".`,
      );
      continue;
    }

    const sortedReviews = [...reviews].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );

    let phaseIndex = 0;

    for (const review of sortedReviews) {
      const update: ComputedUpdate = {
        reviewId: review.id,
        challengeId,
        submissionId: review.submissionId,
        scorecardId: review.scorecardId,
        scorecardType,
        scorecardLegacyId: review.scorecardLegacyId,
        phaseName,
        reviewCreatedAt: review.createdAt,
        memberId: review.createdBy,
        legacyResourceId: review.legacyResourceId,
        oldPhaseId: review.phaseId,
        oldResourceId: review.resourceId,
      };

      if (isLegacyId(review.phaseId)) {
        if (phaseIndex >= phases.length) {
          console.warn(
            `Review ${review.id}: not enough "${phaseName}" phases for ${sortedReviews.length} review(s) (found ${phases.length}).`,
          );
        } else {
          const phase = phases[phaseIndex];
          update.newPhaseId = phase.id;
          update.phaseSelectionReason = `phase #${phaseIndex + 1} (${phase.id}) by ${phase.scheduledStartDate ?? phase.actualStartDate ?? phase.createdAt}`;
          phaseIndex += 1;
        }
      }

      if (isLegacyId(review.resourceId) && review.createdBy) {
        const resources = await getChallengeResources(challengeId);
        const selection = selectResourceForReview(
          resources,
          review.createdBy,
          scorecardType,
          review.legacyResourceId,
        );
        if (selection) {
          update.newResourceId = selection.resource.id;
          update.resourceRoleName = selection.resource.resourceRole.name;
          update.resourceSelectionReason = selection.reason;
        } else {
          console.warn(
            `Review ${review.id}: no resource found for member ${review.createdBy} on challenge ${challengeId}.`,
          );
        }
      } else if (isLegacyId(review.resourceId) && !review.createdBy) {
        console.warn(
          `Review ${review.id}: missing createdBy, cannot map resource.`,
        );
      }

      if (
        (update.newPhaseId && update.newPhaseId !== update.oldPhaseId) ||
        (update.newResourceId && update.newResourceId !== update.oldResourceId)
      ) {
        updates.push(update);
      }
    }
  }

  return updates;
}

async function applyUpdates(updates: ComputedUpdate[]) {
  if (!updates.length) {
    console.log('No updates required.');
    return;
  }

  let updatedCount = 0;
  let phaseUpdates = 0;
  let resourceUpdates = 0;
  let skippedConflicts = 0;
  let errors = 0;

  for (const update of updates) {
    const data: Record<string, unknown> = {};
    const phaseChanged =
      update.newPhaseId && update.newPhaseId !== update.oldPhaseId;
    const resourceChanged =
      update.newResourceId && update.newResourceId !== update.oldResourceId;

    if (phaseChanged) {
      data.phaseId = update.newPhaseId;
    }

    let applyResource = false;
    if (resourceChanged) {
      if (!update.submissionId) {
        applyResource = true;
      } else {
        const conflictingReview = await reviewPrisma.review.findFirst({
          where: {
            id: { not: update.reviewId },
            submissionId: update.submissionId,
            scorecardId: update.scorecardId,
            resourceId: update.newResourceId,
          },
          select: { id: true },
        });

        if (conflictingReview) {
          console.warn(
            `Skipping resource update for review ${update.reviewId}: would conflict with review ${conflictingReview.id}.`,
          );
          skippedConflicts += 1;
        } else {
          applyResource = true;
        }
      }
    }

    if (applyResource && update.newResourceId) {
      data.resourceId = update.newResourceId;
    }

    if (!phaseChanged && !applyResource) {
      continue;
    }

    data.updatedBy = SCRIPT_ACTOR;

    try {
      await reviewPrisma.review.update({
        where: { id: update.reviewId },
        data,
      });

      updatedCount += 1;
      if (phaseChanged) {
        phaseUpdates += 1;
      }
      if (applyResource) {
        resourceUpdates += 1;
      }
    } catch (error) {
      errors += 1;
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        console.warn(
          `Unique constraint prevented updating review ${update.reviewId}; leaving legacy value in place.`,
        );
      } else {
        console.error(`Failed to update review ${update.reviewId}:`, error);
      }
    }
  }

  console.log(
    `Updated ${updatedCount} review(s): ${phaseUpdates} phaseId change(s), ${resourceUpdates} resourceId change(s). Skipped conflicts: ${skippedConflicts}. Failed updates: ${errors}.`,
  );
}

async function outputTestSample(updates: ComputedUpdate[]) {
  console.log(`Previewing up to 10 updates (out of ${updates.length}).`);
  const sample = sampleArray(updates, 10);

  for (const [index, update] of sample.entries()) {
    const messages: string[] = [];

    if (update.newPhaseId && update.newPhaseId !== update.oldPhaseId) {
      messages.push(
        `phaseId: ${update.oldPhaseId} -> ${update.newPhaseId} (${update.phaseName})`,
      );
    }

    if (update.newResourceId && update.newResourceId !== update.oldResourceId) {
      messages.push(
        `resourceId: ${update.oldResourceId} -> ${update.newResourceId} (role ${update.resourceRoleName})`,
      );
    }

    console.log(
      `[${index + 1}] review ${update.reviewId} | challenge ${update.challengeId} | submission ${update.submissionId} | scorecard type ${update.scorecardType} (legacy ${update.scorecardLegacyId}) | created ${update.reviewCreatedAt.toISOString()} | ${messages.join(
        '; ',
      )}`,
    );
    if (update.phaseSelectionReason) {
      console.log(`    phase selection: ${update.phaseSelectionReason}`);
    }
    if (update.resourceSelectionReason) {
      console.log(`    resource selection: ${update.resourceSelectionReason}`);
    }
  }

  console.log('Run without --test to apply these updates.');
}

async function main() {
  const args = process.argv.slice(2);
  const testMode = args.includes('--test') || args.includes('-t');

  try {
    const updates = await computeUpdates();
    if (!updates.length) {
      console.log('No actionable updates found.');
      return;
    }

    if (testMode) {
      await outputTestSample(updates);
    } else {
      await applyUpdates(updates);
    }
  } catch (error) {
    console.error('Error while processing legacy review updates:', error);
    process.exitCode = 1;
  } finally {
    await Promise.all([
      reviewPrisma.$disconnect(),
      challengePrisma.$disconnect(),
      resourcePrisma.$disconnect(),
    ]);
  }
}

void main();
