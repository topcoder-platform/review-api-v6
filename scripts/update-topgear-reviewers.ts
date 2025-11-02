import {
  PrismaClient,
  ChallengeStatusEnum,
  ReviewOpportunityTypeEnum,
  DefaultChallengeReviewer,
  Prisma,
} from '@prisma/client-challenge';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.CHALLENGE_DB_URL,
    },
  },
});

const SCRIPT_ACTOR = 'scripts/update-topgear-reviewers';

interface ChallengePhaseInfo {
  id: string;
  phaseId: string;
  name: string;
}

interface ChallengeContext {
  id: string;
  name: string;
  typeId: string | null;
  trackId: string | null;
  type?: {
    name: string | null;
  } | null;
  track?: {
    name: string | null;
  } | null;
  phases: ChallengePhaseInfo[];
}

const normalizeName = (value: string) => value.trim().toLowerCase();

async function transitionFirst2FinishChallenges() {
  const first2FinishType = await prisma.challengeType.findFirst({
    where: { name: 'First2Finish' },
    select: { id: true, name: true },
  });
  if (!first2FinishType) {
    throw new Error('Challenge type "First2Finish" was not found.');
  }

  const topgearTaskType = await prisma.challengeType.findFirst({
    where: { name: 'Topgear Task' },
    select: { id: true, name: true },
  });
  if (!topgearTaskType) {
    throw new Error('Challenge type "Topgear Task" was not found.');
  }

  const challengesToUpdate = await prisma.challenge.findMany({
    where: {
      status: ChallengeStatusEnum.ACTIVE,
      typeId: first2FinishType.id,
      billingRecord: {
        billingAccountId: '80000062',
      },
    },
    select: { id: true, name: true },
  });

  if (!challengesToUpdate.length) {
    console.log(
      'No ACTIVE First2Finish challenges with billing account 80000062 require type transition.',
    );
    return { updatedCount: 0, challengeIds: [] as string[] };
  }

  await prisma.challenge.updateMany({
    where: {
      id: {
        in: challengesToUpdate.map((challenge) => challenge.id),
      },
    },
    data: {
      typeId: topgearTaskType.id,
      updatedBy: SCRIPT_ACTOR,
    },
  });

  console.log(
    `Transitioned ${challengesToUpdate.length} challenges to type "${topgearTaskType.name}".`,
  );

  return {
    updatedCount: challengesToUpdate.length,
    challengeIds: challengesToUpdate.map((challenge) => challenge.id),
  };
}

async function fetchDefaultReviewers(
  typeId: string,
  trackId: string,
  cache: Map<string, DefaultChallengeReviewer[]>,
) {
  const cacheKey = `${typeId}:${trackId}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey) ?? [];
  }

  const defaults = await prisma.defaultChallengeReviewer.findMany({
    where: {
      typeId,
      trackId,
    },
  });

  cache.set(cacheKey, defaults);
  return defaults;
}

async function backfillChallengeReviewers() {
  const defaultsCache = new Map<string, DefaultChallengeReviewer[]>();

  const taskTypes = await prisma.challengeType.findMany({
    where: {
      name: { equals: 'Task', mode: 'insensitive' },
    },
    select: { id: true },
  });
  const taskTypeIds = new Set(taskTypes.map((type) => type.id));

  const challenges = await prisma.challenge.findMany({
    where: {
      status: ChallengeStatusEnum.ACTIVE,
      reviewers: {
        none: {},
      },
    },
    select: {
      id: true,
      name: true,
      typeId: true,
      trackId: true,
      type: {
        select: {
          name: true,
        },
      },
      track: {
        select: {
          name: true,
        },
      },
      phases: {
        select: {
          id: true,
          phaseId: true,
          name: true,
        },
      },
    },
  });

  if (!challenges.length) {
    console.log('No ACTIVE challenges without reviewers found for backfill.');
    return { challengesUpdated: 0, reviewersCreated: 0 };
  }

  let reviewersCreated = 0;
  let challengesUpdated = 0;

  for (const challenge of challenges) {
    const typeName = challenge.type?.name ?? 'Unknown type';
    const trackName = challenge.track?.name ?? 'Unknown track';

    console.log(
      `Processing challenge ${challenge.id} (${challenge.name}) – Type: ${typeName}, Track: ${trackName}`,
    );

    if (!challenge.typeId || !challenge.trackId) {
      console.warn(
        `Skipping challenge ${challenge.id} (${challenge.name}) because typeId or trackId is missing.`,
      );
      continue;
    }

    if (taskTypeIds.has(challenge.typeId)) {
      console.log(
        `Skipping challenge ${challenge.id} (${challenge.name}) because it is a Task type (Type: ${typeName}, Track: ${trackName}).`,
      );
      continue;
    }

    const defaultReviewers = await fetchDefaultReviewers(
      challenge.typeId,
      challenge.trackId,
      defaultsCache,
    );

    if (!defaultReviewers.length) {
      console.warn(
        `No default reviewers configured for challenge ${challenge.id} (${challenge.name}).`,
      );
      continue;
    }

    if (!challenge.phases.length) {
      console.warn(
        `Challenge ${challenge.id} (${challenge.name}) has no phases; skipping reviewer creation.`,
      );
      continue;
    }

    const phasesByName = challenge.phases.reduce<Map<string, ChallengePhaseInfo[]>>(
      (acc, phase) => {
        const key = normalizeName(phase.name);
        if (!acc.has(key)) {
          acc.set(key, []);
        }
        acc.get(key)!.push(phase);
        return acc;
      },
      new Map(),
    );

    const records: Prisma.ChallengeReviewerCreateManyInput[] = [];

    for (const defaultReviewer of defaultReviewers) {
      const normalizedPhaseName = normalizeName(defaultReviewer.phaseName);
      const matchingPhases = phasesByName.get(normalizedPhaseName);

      if (!matchingPhases || !matchingPhases.length) {
        console.warn(
          `Challenge ${challenge.id} (${challenge.name}) does not have a phase matching "${defaultReviewer.phaseName}". Available phases: ${challenge.phases
            .map((phase) => phase.name)
            .join(', ')}`,
        );
        continue;
      }

      for (const phase of matchingPhases) {
        records.push({
          challengeId: challenge.id,
          phaseId: phase.phaseId,
          scorecardId: defaultReviewer.scorecardId,
          isMemberReview: defaultReviewer.isMemberReview,
          memberReviewerCount: defaultReviewer.isMemberReview
            ? defaultReviewer.memberReviewerCount ?? null
            : null,
          fixedAmount: defaultReviewer.fixedAmount ?? null,
          baseCoefficient: defaultReviewer.baseCoefficient ?? null,
          incrementalCoefficient: defaultReviewer.incrementalCoefficient ?? null,
          type: (defaultReviewer.opportunityType ??
            null) as ReviewOpportunityTypeEnum | null,
          createdBy: SCRIPT_ACTOR,
          updatedBy: SCRIPT_ACTOR,
        });
      }
    }

    if (!records.length) {
      console.warn(
        `No reviewer records generated for challenge ${challenge.id} (${challenge.name}).`,
      );
      continue;
    }

    const result = await prisma.challengeReviewer.createMany({
      data: records,
      skipDuplicates: true,
    });

    if (result.count > 0) {
      reviewersCreated += result.count;
      challengesUpdated += 1;
      console.log(
        `Created ${result.count} reviewer records for challenge ${challenge.id} (${challenge.name}).`,
      );
    }
  }

  if (!reviewersCreated) {
    console.log('No reviewer records were created during backfill.');
  }

  return { challengesUpdated, reviewersCreated };
}

async function main() {
  if (!process.env.CHALLENGE_DB_URL) {
    throw new Error('CHALLENGE_DB_URL is not set. Aborting.');
  }

  console.log('Starting Topgear reviewer update script...');

  const transitionResult = await transitionFirst2FinishChallenges();
  const reviewerResult = await backfillChallengeReviewers();

  console.log('--- Summary ------------------------------------------------');
  console.log(
    `Challenges transitioned: ${transitionResult.updatedCount} (${transitionResult.challengeIds.join(', ') || 'none'})`,
  );
  console.log(
    `Challenges with reviewers backfilled: ${reviewerResult.challengesUpdated}; total reviewer records created: ${reviewerResult.reviewersCreated}.`,
  );
}

main()
  .catch((error) => {
    console.error('Script failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
