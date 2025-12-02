/* eslint-disable no-console */
import {
  PrismaClient as ReviewPrismaClient,
  ReviewStatus,
} from '@prisma/client';
import { PrismaClient as ResourcePrismaClient } from '@prisma/client-resource';

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
    const resources = await resourcePrisma.resource.findMany({
      where: {
        id: { in: chunk },
        ...(RESOURCE_ROLE_KEYWORD
          ? {
              resourceRole: {
                nameLower: {
                  contains: RESOURCE_ROLE_KEYWORD,
                },
              },
            }
          : {}),
      },
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

function escapeSqlLiteral(value: string) {
  return value.replace(/'/g, "''");
}

function buildInsertStatement(memberIds: number[]) {
  const values = memberIds
    .map((subjectId) => `(${subjectId})`)
    .join(',\n    ');

  return `WITH role_cte AS (
  SELECT id
  FROM identity.role
  WHERE LOWER(name) = LOWER('${escapeSqlLiteral(ROLE_NAME)}')
  LIMIT 1
)
INSERT INTO identity.role_assignment (role_id, subject_id, subject_type, created_by, created_at, modified_by, modified_at)
SELECT role_cte.id,
       data.subject_id,
       ${MEMBER_SUBJECT_TYPE},
       NULL,
       CURRENT_TIMESTAMP,
       NULL,
       CURRENT_TIMESTAMP
FROM role_cte
CROSS JOIN (VALUES
    ${values}
) AS data(subject_id)
ON CONFLICT (role_id, subject_id, subject_type) DO NOTHING;`;
}

function generateRoleAssignmentSql(memberIds: Set<number>): string[] {
  if (!memberIds.size) {
    return [];
  }

  const memberIdList = Array.from(memberIds);
  const statements: string[] = [];

  for (const chunk of chunkArray(memberIdList, ASSIGN_BATCH_SIZE)) {
    statements.push(buildInsertStatement(chunk));
  }

  return statements;
}

async function main() {
  const reviewDbUrl = ensureEnv('DATABASE_URL');
  const resourceDbUrl = ensureEnv('RESOURCE_DB_URL');

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

  try {
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

    console.log(
      `Preparing SQL to assign role "${ROLE_NAME}" to reviewer members...`,
    );
    const statements = generateRoleAssignmentSql(memberIds);

    if (!statements.length) {
      console.log('All members already processed locally. No SQL generated.');
      return;
    }

    console.log(
      `Generated ${statements.length} INSERT statement(s) covering ${memberIds.size} members.`,
    );
    statements.forEach((statement, index) => {
      console.log(`\n-- Statement ${index + 1}\n${statement}`);
    });
    console.log(
      '\n-- Apply the above SQL inside the identity database to grant the reviewer role.',
    );
  } finally {
    await Promise.allSettled([
      reviewPrisma.$disconnect(),
      resourcePrisma.$disconnect(),
    ]);
  }
}

main().catch((error) => {
  console.error('Failed to prepare reviewer role assignments.');
  console.error(error);
  process.exit(1);
});
