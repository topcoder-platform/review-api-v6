/* eslint-disable no-console */
import {
  PrismaClient as ReviewPrismaClient,
  ReviewStatus,
} from '@prisma/client';
import { PrismaClient as ResourcePrismaClient } from '@prisma/client-resource';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';

type IdentityPrismaModule = typeof import('../../identity-api-v6/node_modules/@prisma/client');
type IdentityPrismaClient = IdentityPrismaModule['PrismaClient'];
const DEFAULT_REVIEW_BATCH_SIZE = 2000;
const DEFAULT_RESOURCE_BATCH_SIZE = 500;
const DEFAULT_ASSIGN_BATCH_SIZE = 500;
const MEMBER_SUBJECT_TYPE = Number(
  process.env.REVIEWER_ROLE_SUBJECT_TYPE ?? '1',
) || 1;
const ROLE_NAME = process.env.REVIEWER_ROLE_NAME ?? 'reviewer';
const RESOURCE_ROLE_KEYWORD = (
  process.env.REVIEWER_ROLE_RESOURCE_MATCH ?? 'reviewer'
).trim().toLowerCase();

const REVIEW_BATCH_SIZE = toPositiveInteger(
  process.env.REVIEWER_ROLE_REVIEW_BATCH_SIZE,
  DEFAULT_REVIEW_BATCH_SIZE,
);
const RESOURCE_BATCH_SIZE = toPositiveInteger(
  process.env.REVIEWER_ROLE_RESOURCE_BATCH_SIZE,
  DEFAULT_RESOURCE_BATCH_SIZE,
);
const ASSIGN_BATCH_SIZE = toPositiveInteger(
  process.env.REVIEWER_ROLE_ASSIGN_BATCH_SIZE,
  DEFAULT_ASSIGN_BATCH_SIZE,
);

function toPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value ?? '');
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function ensureEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable "${name}".`);
  }
  return value;
}

function resolveIdentityRepoRoot(): string {
  const overridePath = process.env.IDENTITY_API_PATH;
  if (overridePath) {
    const absolute = path.resolve(overridePath);
    if (!fs.existsSync(absolute)) {
      throw new Error(
        `IDENTITY_API_PATH was set to "${overridePath}", but that path does not exist.`,
      );
    }
    return absolute;
  }

  const defaultPath = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    'identity-api-v6',
  );
  if (!fs.existsSync(defaultPath)) {
    throw new Error(
      `Failed to locate identity-api-v6. Set IDENTITY_API_PATH to the repository root if it lives elsewhere.`,
    );
  }
  return defaultPath;
}

function createIdentityPrismaClient(identityDbUrl: string): IdentityPrismaClient {
  const identityRoot = resolveIdentityRepoRoot();
  const packageJsonPath = path.join(identityRoot, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(
      `Could not find package.json at ${packageJsonPath}. Verify identity-api-v6 is installed.`,
    );
  }

  const identityRequire = createRequire(packageJsonPath);
  let identityModule: IdentityPrismaModule;
  try {
    identityModule = identityRequire(
      '@prisma/client',
    ) as IdentityPrismaModule;
  } catch (error) {
    throw new Error(
      `Unable to load Prisma client from identity-api-v6. Run "pnpm install" inside identity-api-v6 first.\n${error}`,
    );
  }

  return new identityModule.PrismaClient({
    datasources: {
      db: {
        url: identityDbUrl,
      },
    },
  });
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

async function collectCompletedReviewResourceIds(
  reviewPrisma: ReviewPrismaClient,
): Promise<{ resourceIds: Set<string>; scanned: number }> {
  const resourceIds = new Set<string>();
  let lastId: string | null = null;
  let scanned = 0;

  while (true) {
    const reviews = await reviewPrisma.review.findMany({
      where: {
        status: ReviewStatus.COMPLETED,
        resourceId: { not: null },
      },
      select: {
        id: true,
        resourceId: true,
      },
      orderBy: {
        id: 'asc',
      },
      take: REVIEW_BATCH_SIZE,
      ...(lastId
        ? {
            skip: 1,
            cursor: {
              id: lastId,
            },
          }
        : {}),
    });

    if (!reviews.length) {
      break;
    }

    for (const review of reviews) {
      if (review.resourceId) {
        resourceIds.add(review.resourceId);
      }
    }
    scanned += reviews.length;
    lastId = reviews[reviews.length - 1].id;
  }

  return { resourceIds, scanned };
}

async function resolveReviewerMemberIds(
  resourcePrisma: ResourcePrismaClient,
  resourceIds: Set<string>,
): Promise<{
  memberIds: Set<number>;
  skipped: number;
}> {
  const memberIds = new Set<number>();
  const skippedResources: Set<string> = new Set();
  const ids = Array.from(resourceIds);

  for (const chunk of chunkArray(ids, RESOURCE_BATCH_SIZE)) {
    const whereClause: Parameters<
      ResourcePrismaClient['resource']['findMany']
    >[0]['where'] = {
      id: { in: chunk },
      memberId: { not: null },
    };

    if (RESOURCE_ROLE_KEYWORD) {
      whereClause.resourceRole = {
        nameLower: {
          contains: RESOURCE_ROLE_KEYWORD,
        },
      };
    }

    const resources = await resourcePrisma.resource.findMany({
      where: whereClause,
      include: {
        resourceRole: true,
      },
    });

    for (const resource of resources) {
      if (!resource.memberId) {
        skippedResources.add(resource.id);
        continue;
      }

      const numericMemberId = Number(resource.memberId.trim());
      if (
        !Number.isFinite(numericMemberId) ||
        !Number.isInteger(numericMemberId)
      ) {
        console.warn(
          `Skipping resource ${resource.id} because memberId "${resource.memberId}" is not a valid integer.`,
        );
        skippedResources.add(resource.id);
        continue;
      }
      memberIds.add(numericMemberId);
    }
  }

  return { memberIds, skipped: skippedResources.size };
}

async function addReviewerRoleAssignments(
  identityPrisma: IdentityPrismaClient,
  memberIds: Set<number>,
): Promise<{ created: number; alreadyHadRole: number; roleName: string }> {
  if (!memberIds.size) {
    return { created: 0, alreadyHadRole: 0, roleName: ROLE_NAME };
  }

  const role = await identityPrisma.role.findFirst({
    where: {
      name: {
        equals: ROLE_NAME,
        mode: 'insensitive',
      },
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (!role) {
    throw new Error(
      `Role "${ROLE_NAME}" was not found in the identity database.`,
    );
  }

  const memberIdList = Array.from(memberIds);

  const existingAssignments = await identityPrisma.roleAssignment.findMany({
    where: {
      roleId: role.id,
      subjectType: MEMBER_SUBJECT_TYPE,
      subjectId: {
        in: memberIdList,
      },
    },
    select: {
      subjectId: true,
    },
  });

  const alreadyAssigned = new Set(
    existingAssignments.map((assignment) => assignment.subjectId),
  );

  const pendingAssignments = memberIdList.filter(
    (memberId) => !alreadyAssigned.has(memberId),
  );

  if (!pendingAssignments.length) {
    return {
      created: 0,
      alreadyHadRole: alreadyAssigned.size,
      roleName: role.name,
    };
  }

  let created = 0;
  for (const chunk of chunkArray(pendingAssignments, ASSIGN_BATCH_SIZE)) {
    const now = new Date();
    const result = await identityPrisma.roleAssignment.createMany({
      data: chunk.map((subjectId) => ({
        roleId: role.id,
        subjectId,
        subjectType: MEMBER_SUBJECT_TYPE,
        createdAt: now,
        modifiedAt: now,
        createdBy: null,
        modifiedBy: null,
      })),
      skipDuplicates: true,
    });
    created += result.count;
  }

  return {
    created,
    alreadyHadRole: alreadyAssigned.size,
    roleName: role.name,
  };
}

async function main() {
  const reviewDbUrl = ensureEnv('DATABASE_URL');
  const resourceDbUrl = ensureEnv('RESOURCE_DB_URL');
  const identityDbUrl = ensureEnv('IDENTITY_DB_URL');

  const reviewPrisma = new ReviewPrismaClient({
    datasources: {
      db: {
        url: reviewDbUrl,
      },
    },
  });
  const resourcePrisma = new ResourcePrismaClient({
    datasources: {
      db: {
        url: resourceDbUrl,
      },
    },
  });

  let identityPrisma: IdentityPrismaClient | null = null;

  try {
    identityPrisma = createIdentityPrismaClient(identityDbUrl);
    console.log('Collecting resource IDs for completed reviews...');
    const { resourceIds, scanned } =
      await collectCompletedReviewResourceIds(reviewPrisma);
    console.log(
      `Scanned ${scanned} completed reviews and found ${resourceIds.size} unique resource IDs.`,
    );

    if (!resourceIds.size) {
      console.log('No completed reviews found. Nothing to do.');
      return;
    }

    console.log('Resolving member IDs from reviewer resources...');
    const { memberIds, skipped } = await resolveReviewerMemberIds(
      resourcePrisma,
      resourceIds,
    );
    console.log(
      `Resolved ${memberIds.size} unique member IDs from reviewer resources (skipped ${skipped}).`,
    );

    if (!memberIds.size) {
      console.log(
        'No reviewer member IDs matched the criteria. No identity updates are required.',
      );
      return;
    }

    console.log(`Assigning role "${ROLE_NAME}" to reviewer members...`);
    const { created, alreadyHadRole, roleName } =
      await addReviewerRoleAssignments(identityPrisma, memberIds);
    console.log(
      `Role assignment complete. Created ${created} new "${roleName}" assignments (${alreadyHadRole} already had the role).`,
    );
  } finally {
    const tasks = [
      reviewPrisma.$disconnect(),
      resourcePrisma.$disconnect(),
    ];
    if (identityPrisma) {
      tasks.push(identityPrisma.$disconnect());
    }
    await Promise.allSettled(tasks);
  }
}

main().catch((error) => {
  console.error('Failed to grant reviewer role assignments.');
  console.error(error);
  process.exit(1);
});
