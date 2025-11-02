import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ChallengePrismaService } from 'src/shared/modules/global/challenge-prisma.service';
import { MemberPrismaService } from 'src/shared/modules/global/member-prisma.service';
import { JwtUser, isAdmin } from 'src/shared/modules/global/jwt.service';
import {
  ACTIVE_MY_REVIEW_SORT_FIELDS,
  MyReviewFilterDto,
  MyReviewSortField,
  MyReviewSummaryDto,
  MyReviewWinnerDto,
  PAST_MY_REVIEW_SORT_FIELDS,
} from 'src/dto/my-review.dto';
import { PaginatedResponse, PaginationDto } from 'src/dto/pagination.dto';
import { LoggerService } from 'src/shared/modules/global/logger.service';

interface ChallengeSummaryRow {
  challengeId: string;
  challengeName: string;
  challengeTypeId: string | null;
  challengeTypeName: string | null;
  hasAIReview: boolean;
  currentPhaseName: string | null;
  currentPhaseScheduledEnd: Date | null;
  currentPhaseActualEnd: Date | null;
  resourceRoleName: string | null;
  challengeEndDate: Date | null;
  totalReviews: bigint | null;
  completedReviews: bigint | null;
  winners: Prisma.JsonValue | null;
  status: string;
  hasIncompleteReviews: boolean | null;
  incompletePhaseName: string | null;
  hasPendingAppealResponses: boolean;
  isAppealsResponsePhaseOpen: boolean | null;
  appealsResponsePhaseName: string | null;
}

const PAST_CHALLENGE_STATUSES = [
  'COMPLETED',
  'CANCELLED',
  'CANCELLED_FAILED_REVIEW',
  'CANCELLED_FAILED_SCREENING',
  'CANCELLED_ZERO_SUBMISSIONS',
  'CANCELLED_CLIENT_REQUEST',
] as const;

const joinSqlFragments = (
  fragments: Prisma.Sql[],
  separator: Prisma.Sql,
): Prisma.Sql => {
  if (!fragments.length) {
    return Prisma.sql``;
  }

  return fragments
    .slice(1)
    .reduce(
      (acc, fragment) => Prisma.sql`${acc}${separator}${fragment}`,
      fragments[0],
    );
};

@Injectable()
export class MyReviewService {
  private readonly logger = LoggerService.forRoot(MyReviewService.name);

  constructor(
    private readonly challengePrisma: ChallengePrismaService,
    private readonly memberPrisma: MemberPrismaService,
  ) {}

  async getMyReviews(
    authUser: JwtUser,
    filters: MyReviewFilterDto,
    paginationDto?: PaginationDto,
  ): Promise<PaginatedResponse<MyReviewSummaryDto>> {
    if (!authUser || (!authUser.userId && !isAdmin(authUser))) {
      throw new UnauthorizedException('User information is required');
    }

    const adminUser = isAdmin(authUser);
    const normalizedUserId = authUser.userId ? String(authUser.userId) : null;
    const rawPage = paginationDto?.page ?? 1;
    const rawPerPage = paginationDto?.perPage ?? 10;
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const perPage =
      Number.isFinite(rawPerPage) && rawPerPage > 0 ? rawPerPage : 10;
    const offset = (page - 1) * perPage;

    this.logger.log(
      `Fetching active challenges for user ${normalizedUserId ?? 'admin'} with filters ${JSON.stringify(filters)} (page ${page}, perPage ${perPage})`,
    );

    const challengeTypeId = filters.challengeTypeId?.trim();
    const challengeTrackId = filters.challengeTrackId?.trim();
    const challengeTypeName = filters.challengeTypeName?.trim();
    const challengeName = filters.challengeName?.trim();
    const normalizedChallengeStatus = filters.challengeStatus
      ? filters.challengeStatus.trim().toUpperCase()
      : undefined;

    const shouldFetchPastChallenges =
      typeof filters.past === 'string'
        ? filters.past.toLowerCase() === 'true'
        : false;

    const requestedSortBy = filters.sortBy;
    const allowedSortFields = new Set<MyReviewSortField>(
      shouldFetchPastChallenges
        ? [...PAST_MY_REVIEW_SORT_FIELDS]
        : [...ACTIVE_MY_REVIEW_SORT_FIELDS],
    );
    const sortBy =
      requestedSortBy && allowedSortFields.has(requestedSortBy)
        ? requestedSortBy
        : undefined;

    if (requestedSortBy && !sortBy) {
      this.logger.warn(
        `Sort field ${requestedSortBy} is not supported for ${shouldFetchPastChallenges ? 'past' : 'active'} reviews. Falling back to default ordering.`,
      );
    }

    const sortOrder =
      filters.sortOrder?.toLowerCase() === 'desc' ? 'desc' : 'asc';

    const whereFragments: Prisma.Sql[] = [];

    if (shouldFetchPastChallenges) {
      if (normalizedChallengeStatus) {
        const pastStatusSet = new Set<string>(PAST_CHALLENGE_STATUSES);
        if (pastStatusSet.has(normalizedChallengeStatus)) {
          whereFragments.push(
            Prisma.sql`c.status = ${normalizedChallengeStatus}::"ChallengeStatusEnum"`,
          );
        } else {
          this.logger.warn(
            `Challenge status ${normalizedChallengeStatus} is not allowed for past reviews; returning empty result set.`,
          );
          whereFragments.push(Prisma.sql`1 = 0`);
        }
      } else {
        const statusFragments = PAST_CHALLENGE_STATUSES.map(
          (status) => Prisma.sql`${status}::"ChallengeStatusEnum"`,
        );
        const statusList = joinSqlFragments(statusFragments, Prisma.sql`, `);
        whereFragments.push(Prisma.sql`c.status IN (${statusList})`);
      }
    } else {
      if (normalizedChallengeStatus && normalizedChallengeStatus !== 'ACTIVE') {
        this.logger.warn(
          `Challenge status filter ${normalizedChallengeStatus} is not supported for active reviews and will be ignored.`,
        );
      }
      whereFragments.push(Prisma.sql`c.status = 'ACTIVE'`);
    }

    const cteFragments: Prisma.Sql[] = [];
    const baseJoins: Prisma.Sql[] = [];
    const countJoins: Prisma.Sql[] = [];
    const countExtras: Prisma.Sql[] = [];
    const rowExtras: Prisma.Sql[] = [];

    if (!adminUser) {
      if (!normalizedUserId) {
        throw new UnauthorizedException(
          'Unable to resolve user identifier for challenge lookup',
        );
      }

      cteFragments.push(
        Prisma.sql`
          member_resources AS (
            SELECT
              r.id,
              r."challengeId",
              r."roleId"
            FROM resources."Resource" r
            WHERE r."memberId" = ${normalizedUserId}
          )
        `,
      );
      cteFragments.push(
        Prisma.sql`
          review_totals AS (
            SELECT
              rv."resourceId",
              COUNT(*)::bigint AS "totalReviews",
              COALESCE(
                SUM(CASE WHEN rv.status = 'COMPLETED' THEN 1 ELSE 0 END),
                0
              )::bigint AS "completedReviews"
            FROM reviews.review rv
            WHERE rv."resourceId" IN (
              SELECT mr.id FROM member_resources mr
            )
            GROUP BY rv."resourceId"
          )
        `,
      );
      cteFragments.push(
        Prisma.sql`
          incomplete_reviews AS (
            SELECT DISTINCT ON (rv."resourceId")
              rv."resourceId",
              TRUE AS "hasIncompleteReviews",
              cp_incomplete.name AS "incompletePhaseName"
            FROM reviews.review rv
            JOIN challenges."ChallengePhase" cp_incomplete
              ON cp_incomplete.id = rv."phaseId"
            WHERE rv."resourceId" IN (
              SELECT mr.id FROM member_resources mr
            )
              AND (rv.status IS NULL OR rv.status <> 'COMPLETED')
            ORDER BY
              rv."resourceId",
              CASE WHEN cp_incomplete."isOpen" IS TRUE THEN 0 ELSE 1 END,
              cp_incomplete."scheduledEndDate" NULLS LAST,
              cp_incomplete."actualEndDate" NULLS LAST,
              cp_incomplete.name ASC
          )
        `,
      );
      cteFragments.push(
        Prisma.sql`
          appeals_phase AS (
            SELECT DISTINCT ON (p."challengeId")
              p."challengeId",
              TRUE AS "isAppealsResponsePhaseOpen",
              p.name AS "appealsResponsePhaseName"
            FROM challenges."ChallengePhase" p
            WHERE p."challengeId" IN (
              SELECT DISTINCT mr."challengeId"
              FROM member_resources mr
            )
              AND LOWER(p.name) IN ('appeals response', 'iterative appeals response')
              AND p."isOpen" IS TRUE
            ORDER BY
              p."challengeId",
              p."scheduledEndDate" DESC NULLS LAST,
              p."actualEndDate" DESC NULLS LAST,
              p.name ASC
          )
        `,
      );

      baseJoins.push(
        Prisma.sql`
          JOIN member_resources r
            ON r."challengeId" = c.id
        `,
      );
      baseJoins.push(
        Prisma.sql`
          LEFT JOIN resources."ResourceRole" rr
            ON rr.id = r."roleId"
        `,
      );

      countJoins.push(
        Prisma.sql`
          JOIN member_resources r
            ON r."challengeId" = c.id
        `,
      );
      countJoins.push(
        Prisma.sql`
          LEFT JOIN resources."ResourceRole" rr
            ON rr.id = r."roleId"
        `,
      );
    } else {
      baseJoins.push(
        Prisma.sql`
          LEFT JOIN resources."Resource" r
            ON r."challengeId" = c.id
           AND ${normalizedUserId} IS NOT NULL AND r."memberId" = ${normalizedUserId}
          LEFT JOIN resources."ResourceRole" rr
            ON rr.id = r."roleId"
        `,
      );
    }

    baseJoins.push(
      Prisma.sql`
        LEFT JOIN challenges."ChallengeType" ct ON ct.id = c."typeId"
      `,
    );
    countJoins.push(
      Prisma.sql`
        LEFT JOIN challenges."ChallengeType" ct ON ct.id = c."typeId"
      `,
    );

    const metricJoins: Prisma.Sql[] = [];

    metricJoins.push(
      Prisma.sql`
        LEFT JOIN LATERAL (
          SELECT
            p.name,
            p."scheduledEndDate",
            p."actualEndDate"
          FROM challenges."ChallengePhase" p
          WHERE p."challengeId" = c.id
          ORDER BY
            CASE WHEN p."isOpen" IS TRUE THEN 0 ELSE 1 END,
            p."scheduledEndDate" NULLS LAST,
            p."actualEndDate" NULLS LAST
          LIMIT 1
        ) cp ON TRUE
      `,
    );

    const reviewTotalsJoin = adminUser
      ? Prisma.sql`
          LEFT JOIN LATERAL (
            SELECT
              COUNT(*)::bigint AS "totalReviews",
              COALESCE(
                SUM(CASE WHEN rv.status = 'COMPLETED' THEN 1 ELSE 0 END),
                0
              )::bigint AS "completedReviews"
            FROM reviews.review rv
            WHERE rv."resourceId" = r.id
          ) review_totals ON r.id IS NOT NULL
        `
      : Prisma.sql`
          LEFT JOIN review_totals
            ON review_totals."resourceId" = r.id
        `;
    metricJoins.push(reviewTotalsJoin);

    metricJoins.push(
      Prisma.sql`
        LEFT JOIN LATERAL (
          SELECT
            jsonb_agg(
              jsonb_build_object(
                'userId', w."userId",
                'handle', w.handle,
                'placement', w."placement",
                'type', w.type
              )
              ORDER BY w."placement" ASC
            ) AS winners
          FROM challenges."ChallengeWinner" w
          WHERE w."challengeId" = c.id
        ) cw ON TRUE
      `,
    );

    const incompleteReviewsJoin = adminUser
      ? Prisma.sql`
          LEFT JOIN LATERAL (
            SELECT
              EXISTS (
                SELECT 1
                FROM reviews.review rv_incomplete
                WHERE rv_incomplete."resourceId" = r.id
                  AND (rv_incomplete.status IS NULL OR rv_incomplete.status <> 'COMPLETED')
              ) AS "hasIncompleteReviews",
              (
                SELECT cp_incomplete.name
                FROM reviews.review rv_incomplete2
                JOIN challenges."ChallengePhase" cp_incomplete
                  ON cp_incomplete.id = rv_incomplete2."phaseId"
                WHERE rv_incomplete2."resourceId" = r.id
                  AND (rv_incomplete2.status IS NULL OR rv_incomplete2.status <> 'COMPLETED')
                ORDER BY
                  CASE WHEN cp_incomplete."isOpen" IS TRUE THEN 0 ELSE 1 END,
                  cp_incomplete."scheduledEndDate" NULLS LAST,
                  cp_incomplete."actualEndDate" NULLS LAST,
                  cp_incomplete.name ASC
                LIMIT 1
              ) AS "incompletePhaseName"
          ) deliverable_reviews ON r.id IS NOT NULL
        `
      : Prisma.sql`
          LEFT JOIN incomplete_reviews deliverable_reviews
            ON deliverable_reviews."resourceId" = r.id
        `;
    metricJoins.push(incompleteReviewsJoin);

    metricJoins.push(
      Prisma.sql`
        LEFT JOIN reviews.review_pending_summary pending_appeals
          ON pending_appeals."resourceId" = r.id
      `,
    );

    if (!adminUser) {
      metricJoins.push(
        Prisma.sql`
          LEFT JOIN appeals_phase appeals_response_phase
            ON appeals_response_phase."challengeId" = c.id
        `,
      );
    } else {
      metricJoins.push(
        Prisma.sql`
          LEFT JOIN LATERAL (
            SELECT
              TRUE AS "isAppealsResponsePhaseOpen",
              p.name AS "appealsResponsePhaseName"
            FROM challenges."ChallengePhase" p
            WHERE p."challengeId" = c.id
              AND LOWER(p.name) IN ('appeals response', 'iterative appeals response')
              AND p."isOpen" IS TRUE
            ORDER BY
              p."scheduledEndDate" DESC NULLS LAST,
              p."actualEndDate" DESC NULLS LAST,
              p.name ASC
            LIMIT 1
          ) appeals_response_phase ON TRUE
        `,
      );
    }

    metricJoins.push(
      Prisma.sql`
        LEFT JOIN LATERAL (
          SELECT
            TRUE AS "hasAIReview"
          FROM challenges."ChallengeReviewer" cr
          WHERE cr."challengeId" = c.id
            AND cr."aiWorkflowId" IS NOT NULL
          LIMIT 1
        ) cr ON TRUE
      `,
    );

    const joinClause = joinSqlFragments(
      [...baseJoins, ...metricJoins],
      Prisma.sql``,
    );
    const countJoinClause = joinSqlFragments(countJoins, Prisma.sql``);

    if (challengeTypeId) {
      whereFragments.push(Prisma.sql`c."typeId" = ${challengeTypeId}`);
    }

    if (challengeTrackId) {
      whereFragments.push(Prisma.sql`c."trackId" = ${challengeTrackId}`);
    }

    if (challengeTypeName) {
      whereFragments.push(
        Prisma.sql`LOWER(ct.name) = LOWER(${challengeTypeName})`,
      );
    }

    if (challengeName) {
      whereFragments.push(
        Prisma.sql`LOWER(c.name) LIKE LOWER(${`%${challengeName}%`})`,
      );
    }

    const rowWhereFragments = [...whereFragments, ...rowExtras];
    const countWhereFragments = [...whereFragments, ...countExtras];

    const rowWhereClause = joinSqlFragments(
      rowWhereFragments,
      Prisma.sql` AND `,
    );
    const countWhereClause = joinSqlFragments(
      countWhereFragments,
      Prisma.sql` AND `,
    );

    const phaseEndExpression = Prisma.sql`
      COALESCE(cp."actualEndDate", cp."scheduledEndDate")
    `;
    const timeLeftExpression = Prisma.sql`
      EXTRACT(EPOCH FROM (${phaseEndExpression} - NOW()))
    `;
    // Only consider review progress for known review-related phases.
    // For non-review phases, treat progress as NULL so they sort after
    // in-review items (due to NULLS LAST in ORDER BY).
    const reviewProgressExpression = Prisma.sql`
      CASE
        WHEN LOWER(COALESCE(cp.name, '')) NOT IN (
          'review',
          'iterative review',
          'appeals',
          'appeals response',
          'topgear iterative review'
        ) THEN NULL
        ELSE CASE
          WHEN review_totals."totalReviews" IS NULL OR review_totals."totalReviews" = 0 THEN 0
          ELSE LEAST(
            1,
            GREATEST(
              0,
              review_totals."completedReviews"::numeric / review_totals."totalReviews"::numeric
            )
          )
        END
      END
    `;

    const sortFragments: Prisma.Sql[] = [];
    const directionSql =
      sortOrder === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`;

    switch (sortBy) {
      case 'challengeName':
        sortFragments.push(Prisma.sql`c.name ${directionSql} NULLS LAST`);
        break;
      case 'phase':
        sortFragments.push(Prisma.sql`cp.name ${directionSql} NULLS LAST`);
        break;
      case 'phaseEndDate':
        sortFragments.push(
          Prisma.sql`${phaseEndExpression} ${directionSql} NULLS LAST`,
        );
        break;
      case 'timeLeft':
        sortFragments.push(
          Prisma.sql`${timeLeftExpression} ${directionSql} NULLS LAST`,
        );
        break;
      case 'reviewProgress':
        sortFragments.push(
          Prisma.sql`${reviewProgressExpression} ${directionSql} NULLS LAST`,
        );
        break;
      case 'challengeEndDate':
        sortFragments.push(Prisma.sql`c."endDate" ${directionSql} NULLS LAST`);
        break;
      default:
        break;
    }

    const fallbackOrderFragments = [
      Prisma.sql`c."createdAt" DESC NULLS LAST`,
      Prisma.sql`c.name ASC`,
    ];
    const orderFragments = sortFragments.length
      ? [...sortFragments, ...fallbackOrderFragments]
      : fallbackOrderFragments;
    const orderClause = joinSqlFragments(orderFragments, Prisma.sql`, `);

    const withClause = cteFragments.length
      ? Prisma.sql`WITH ${joinSqlFragments(cteFragments, Prisma.sql`, `)} `
      : Prisma.sql``;

    const countQuery = Prisma.sql`
      ${withClause}
      SELECT COUNT(*) AS "total"
      FROM challenges."Challenge" c
      ${countJoinClause}
      WHERE ${countWhereClause}
    `;

    const countQueryDetails = countQuery.inspect();
    this.logger.debug({
      message: 'Executing challenge count query',
      sql: countQueryDetails.sql,
      parameters: countQueryDetails.values,
    });

    const countResult =
      await this.challengePrisma.$queryRaw<{ total: bigint }[]>(countQuery);
    const totalCountBigInt = countResult?.[0]?.total ?? 0n;
    const totalCount = Number(totalCountBigInt);
    const totalPages = totalCount ? Math.ceil(totalCount / perPage) : 0;

    if (!totalCount) {
      return {
        data: [],
        meta: {
          page,
          perPage,
          totalCount: 0,
          totalPages: 0,
        },
      };
    }

    const rowQuery = Prisma.sql`
      ${withClause}
      SELECT
        c.id AS "challengeId",
        c.name AS "challengeName",
        c."typeId" AS "challengeTypeId",
        ct.name AS "challengeTypeName",
        cp.name AS "currentPhaseName",
        cr."hasAIReview" as "hasAIReview",
        cp."scheduledEndDate" AS "currentPhaseScheduledEnd",
        cp."actualEndDate" AS "currentPhaseActualEnd",
        rr.name AS "resourceRoleName",
        c."endDate" AS "challengeEndDate",
        review_totals."totalReviews" AS "totalReviews",
        review_totals."completedReviews" AS "completedReviews",
        cw.winners AS "winners",
        deliverable_reviews."hasIncompleteReviews" AS "hasIncompleteReviews",
        deliverable_reviews."incompletePhaseName" AS "incompletePhaseName",
        COALESCE(pending_appeals."pendingAppealCount" > 0, FALSE) AS "hasPendingAppealResponses",
        appeals_response_phase."isAppealsResponsePhaseOpen" AS "isAppealsResponsePhaseOpen",
        appeals_response_phase."appealsResponsePhaseName" AS "appealsResponsePhaseName",
        c.status AS "status"
      FROM challenges."Challenge" c
      ${joinClause}
      WHERE ${rowWhereClause}
      ORDER BY ${orderClause}
      LIMIT ${perPage}
      OFFSET ${offset}
    `;

    const challengeQueryDetails = rowQuery.inspect();
    this.logger.debug({
      message: 'Executing challenge summary query',
      sql: challengeQueryDetails.sql,
      parameters: challengeQueryDetails.values,
    });

    const challengeRows =
      await this.challengePrisma.$queryRaw<ChallengeSummaryRow[]>(rowQuery);

    if (!challengeRows.length) {
      return {
        data: [],
        meta: {
          page,
          perPage,
          totalCount,
          totalPages,
        },
      };
    }

    const now = Date.now();
    const adminRoleLabel = adminUser ? 'Admin' : null;
    const winnerUserIds = new Set<number>();

    const data = challengeRows.map((row) => {
      const phaseEnd =
        row.currentPhaseActualEnd ?? row.currentPhaseScheduledEnd;
      let timeLeftSeconds = 0;
      if (phaseEnd) {
        const diff = phaseEnd.getTime() - now;
        timeLeftSeconds = Math.round(diff / 1000);
      }

      const totalReviews =
        typeof row.totalReviews === 'bigint' ? Number(row.totalReviews) : 0;
      const completedReviews =
        typeof row.completedReviews === 'bigint'
          ? Number(row.completedReviews)
          : 0;
      const reviewProgress = totalReviews
        ? Math.min(1, Math.max(0, completedReviews / totalReviews))
        : 0;
      let winners: MyReviewWinnerDto[] | null = null;

      const isActiveChallenge = row.status === 'ACTIVE';
      const hasIncompleteReviews =
        isActiveChallenge && row.hasIncompleteReviews === true;
      const hasPendingAppealResponses =
        isActiveChallenge &&
        row.hasPendingAppealResponses === true &&
        row.isAppealsResponsePhaseOpen === true;

      let deliverableDue = false;
      let deliverableDuePhaseName: string | null = null;

      if (hasIncompleteReviews) {
        deliverableDue = true;
        deliverableDuePhaseName =
          row.incompletePhaseName ?? row.currentPhaseName ?? null;
      } else if (hasPendingAppealResponses) {
        deliverableDue = true;
        deliverableDuePhaseName =
          row.appealsResponsePhaseName ??
          row.currentPhaseName ??
          'Appeals Response';
      }

      if (Array.isArray(row.winners)) {
        const parsed = row.winners
          .map((winner) => this.toWinnerDto(winner))
          .filter((winner): winner is MyReviewWinnerDto => Boolean(winner));
        winners = parsed.length ? parsed : null;
        if (winners) {
          winners.forEach((winner) => winnerUserIds.add(winner.userId));
        }
      }

      return {
        challengeId: row.challengeId,
        challengeName: row.challengeName,
        challengeTypeId: row.challengeTypeId,
        challengeTypeName: row.challengeTypeName,
        hasAIReview: row.hasAIReview,
        challengeEndDate: row.challengeEndDate
          ? row.challengeEndDate.toISOString()
          : null,
        currentPhaseName: row.currentPhaseName,
        currentPhaseEndDate: phaseEnd ? phaseEnd.toISOString() : null,
        timeLeftInCurrentPhase: timeLeftSeconds,
        resourceRoleName: row.resourceRoleName ?? adminRoleLabel,
        reviewProgress,
        winners,
        deliverableDue,
        deliverableDuePhaseName,
        status: row.status,
      };
    });

    if (winnerUserIds.size) {
      try {
        const userIdList = Array.from(winnerUserIds);
        const members = await this.memberPrisma.member.findMany({
          where: {
            userId: {
              in: userIdList.map((id) => BigInt(id)),
            },
          },
          select: {
            userId: true,
            maxRating: {
              select: {
                rating: true,
              },
            },
          },
        });

        const ratingByUserId = new Map<number, number | null>();
        members.forEach((member) => {
          const parsedUserId = Number(member.userId);
          const rating = member.maxRating?.rating ?? null;
          ratingByUserId.set(parsedUserId, rating);
        });

        data.forEach((item) => {
          if (!item.winners) {
            return;
          }

          item.winners = item.winners.map((winner) => ({
            ...winner,
            maxRating: ratingByUserId.get(winner.userId) ?? null,
          }));
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? `Failed to enrich winners with member ratings: ${error.message}`
            : 'Failed to enrich winners with member ratings';
        this.logger.error(message);
      }
    }

    return {
      data,
      meta: {
        page,
        perPage,
        totalCount,
        totalPages,
      },
    };
  }

  private toWinnerDto(value: Prisma.JsonValue): MyReviewWinnerDto | null {
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      return null;
    }

    const candidate = value as Record<string, unknown>;
    const rawUserId = candidate.userId;
    const rawPlacement = candidate.placement;
    const handle = candidate.handle;
    const type = candidate.type;

    const userId =
      typeof rawUserId === 'number'
        ? rawUserId
        : typeof rawUserId === 'string' && rawUserId.trim().length
          ? Number(rawUserId)
          : null;
    const placement =
      typeof rawPlacement === 'number'
        ? rawPlacement
        : typeof rawPlacement === 'string' && rawPlacement.trim().length
          ? Number(rawPlacement)
          : null;

    if (
      userId === null ||
      !Number.isFinite(userId) ||
      placement === null ||
      !Number.isFinite(placement) ||
      typeof handle !== 'string' ||
      typeof type !== 'string'
    ) {
      return null;
    }

    return {
      userId,
      handle,
      placement,
      type,
      maxRating: null,
    };
  }
}
