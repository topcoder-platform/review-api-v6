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
  currentPhaseName: string | null;
  currentPhaseScheduledEnd: Date | null;
  currentPhaseActualEnd: Date | null;
  resourceRoleName: string | null;
  challengeEndDate: Date | null;
  totalReviews: bigint | null;
  completedReviews: bigint | null;
  winners: Prisma.JsonValue | null;
  status: string;
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
    const challengeTypeName = filters.challengeTypeName?.trim();

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
      const statusFragments = PAST_CHALLENGE_STATUSES.map(
        (status) => Prisma.sql`${status}::"ChallengeStatusEnum"`,
      );
      const statusList = joinSqlFragments(statusFragments, Prisma.sql`, `);
      whereFragments.push(Prisma.sql`c.status IN (${statusList})`);
    } else {
      whereFragments.push(Prisma.sql`c.status = 'ACTIVE'`);
    }

    const joins: Prisma.Sql[] = [];

    if (!adminUser) {
      if (!normalizedUserId) {
        throw new UnauthorizedException(
          'Unable to resolve user identifier for challenge lookup',
        );
      }

      joins.push(
        Prisma.sql`
          LEFT JOIN resources."Resource" r
            ON r."challengeId" = c.id
           AND r."memberId" = ${normalizedUserId}
          LEFT JOIN resources."ResourceRole" rr
            ON rr.id = r."roleId"
        `,
      );

      whereFragments.push(Prisma.sql`r."challengeId" IS NOT NULL`);
    } else {
      joins.push(
        Prisma.sql`
          LEFT JOIN resources."Resource" r
            ON r."challengeId" = c.id
           AND ${normalizedUserId} IS NOT NULL AND r."memberId" = ${normalizedUserId}
          LEFT JOIN resources."ResourceRole" rr
            ON rr.id = r."roleId"
        `,
      );
    }

    joins.push(
      Prisma.sql`
        LEFT JOIN challenges."ChallengeType" ct ON ct.id = c."typeId"
      `,
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
      Prisma.sql`
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*)::bigint AS "totalReviews",
            COALESCE(
              SUM(CASE WHEN rv.status = 'COMPLETED' THEN 1 ELSE 0 END),
              0
            )::bigint AS "completedReviews"
          FROM reviews.review rv
          INNER JOIN resources."Resource" rr
            ON rr.id = rv."resourceId"
          WHERE rr."challengeId" = c.id
        ) rp ON TRUE
      `,
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

    if (challengeTypeId) {
      whereFragments.push(Prisma.sql`c."typeId" = ${challengeTypeId}`);
    }

    if (challengeTypeName) {
      whereFragments.push(
        Prisma.sql`LOWER(ct.name) = LOWER(${challengeTypeName})`,
      );
    }

    const joinClause = joinSqlFragments(joins, Prisma.sql``);
    const whereClause = joinSqlFragments(whereFragments, Prisma.sql` AND `);

    const phaseEndExpression = Prisma.sql`
      COALESCE(cp."actualEndDate", cp."scheduledEndDate")
    `;
    const timeLeftExpression = Prisma.sql`
      GREATEST(EXTRACT(EPOCH FROM (${phaseEndExpression} - NOW())), 0)
    `;
    const reviewProgressExpression = Prisma.sql`
      CASE
        WHEN rp."totalReviews" IS NULL OR rp."totalReviews" = 0 THEN 0
        ELSE LEAST(
          1,
          GREATEST(
            0,
            rp."completedReviews"::numeric / rp."totalReviews"::numeric
          )
        )
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

    const countQuery = Prisma.sql`
      SELECT COUNT(DISTINCT c.id) AS "total"
      FROM challenges."Challenge" c
      ${joinClause}
      WHERE ${whereClause}
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
      SELECT
        c.id AS "challengeId",
        c.name AS "challengeName",
        c."typeId" AS "challengeTypeId",
        ct.name AS "challengeTypeName",
        cp.name AS "currentPhaseName",
        cp."scheduledEndDate" AS "currentPhaseScheduledEnd",
        cp."actualEndDate" AS "currentPhaseActualEnd",
        rr.name AS "resourceRoleName",
        c."endDate" AS "challengeEndDate",
        rp."totalReviews" AS "totalReviews",
        rp."completedReviews" AS "completedReviews",
        cw.winners AS "winners",
        c.status AS "status"
      FROM challenges."Challenge" c
      ${joinClause}
      WHERE ${whereClause}
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
        timeLeftSeconds = diff > 0 ? Math.round(diff / 1000) : 0;
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
        challengeEndDate: row.challengeEndDate
          ? row.challengeEndDate.toISOString()
          : null,
        currentPhaseName: row.currentPhaseName,
        currentPhaseEndDate: phaseEnd ? phaseEnd.toISOString() : null,
        timeLeftInCurrentPhase: timeLeftSeconds,
        resourceRoleName: row.resourceRoleName ?? adminRoleLabel,
        reviewProgress,
        winners,
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
