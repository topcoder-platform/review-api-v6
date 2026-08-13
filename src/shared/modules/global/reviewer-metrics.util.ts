import { Prisma } from '@prisma/client';
import { ChallengePrismaService } from './challenge-prisma.service';

/** Number of days included in the public reviewer completion metric. */
export const RECENT_REVIEW_WINDOW_DAYS = 60;

/** Public-safe assignment totals displayed beside a review applicant. */
export interface ReviewerMetrics {
  openReviews: number;
  latestCompletedReviews: number;
}

interface ReviewerMetricsRow {
  memberId: string;
  openReviews: bigint | number;
  latestCompletedReviews: bigint | number;
}

/**
 * Resolves public-safe reviewer assignment totals in one database query.
 * Callers pass every applicant represented by a response page so the resolver
 * never creates an applicant-by-applicant query pattern. Unknown members are
 * returned with zero totals.
 *
 * @param challengePrisma - Read-only Challenge/Resource database connection.
 * @param userIds - Applicant member identifiers to aggregate.
 * @returns Metrics keyed by normalized member identifier.
 * @throws Propagates database errors so the owning endpoint can apply its
 * standard error contract.
 */
export async function resolveReviewerMetrics(
  challengePrisma: ChallengePrismaService,
  userIds: Array<string | null | undefined>,
): Promise<Map<string, ReviewerMetrics>> {
  const metrics = new Map<string, ReviewerMetrics>();
  const normalizedIds = Array.from(
    new Set(
      userIds
        .map((id) => String(id ?? '').trim())
        .filter((id) => id.length > 0),
    ),
  );
  if (!normalizedIds.length) {
    return metrics;
  }

  const recentThreshold = new Date();
  recentThreshold.setDate(
    recentThreshold.getDate() - RECENT_REVIEW_WINDOW_DAYS,
  );
  const memberIdList = Prisma.join(
    normalizedIds.map((id) => Prisma.sql`${id}`),
  );
  const rows = await challengePrisma.$queryRaw<ReviewerMetricsRow[]>(Prisma.sql`
    SELECT
      r."memberId" AS "memberId",
      COUNT(DISTINCT CASE WHEN c.status = 'ACTIVE' THEN c.id END)::bigint AS "openReviews",
      COUNT(
        DISTINCT CASE
          WHEN c.status IN ('COMPLETED', 'CANCELLED_FAILED_REVIEW')
           AND c."updatedAt" >= ${recentThreshold}
          THEN c.id
        END
      )::bigint AS "latestCompletedReviews"
    FROM resources."Resource" r
    INNER JOIN challenges."Challenge" c
      ON c.id = r."challengeId"
    INNER JOIN resources."ResourceRole" rr
      ON rr.id = r."roleId"
    WHERE r."memberId" IN (${memberIdList})
      AND LOWER(rr.name) LIKE '%reviewer%'
    GROUP BY r."memberId"
  `);

  for (const row of rows) {
    const memberId = String(row.memberId ?? '').trim();
    if (!memberId) continue;
    metrics.set(memberId, {
      openReviews: Number(row.openReviews ?? 0),
      latestCompletedReviews: Number(row.latestCompletedReviews ?? 0),
    });
  }
  for (const memberId of normalizedIds) {
    if (!metrics.has(memberId)) {
      metrics.set(memberId, { openReviews: 0, latestCompletedReviews: 0 });
    }
  }
  return metrics;
}
