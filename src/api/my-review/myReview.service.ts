import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ChallengePrismaService } from 'src/shared/modules/global/challenge-prisma.service';
import { JwtUser, isAdmin } from 'src/shared/modules/global/jwt.service';
import { PrismaService } from 'src/shared/modules/global/prisma.service';
import { MyReviewFilterDto, MyReviewSummaryDto } from 'src/dto/my-review.dto';
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
}

interface ReviewProgressRow {
  challengeId: string;
  totalReviews: bigint;
  completedReviews: bigint;
}

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
    private readonly prisma: PrismaService,
  ) {}

  async getMyReviews(
    authUser: JwtUser,
    filters: MyReviewFilterDto,
  ): Promise<MyReviewSummaryDto[]> {
    if (!authUser || (!authUser.userId && !isAdmin(authUser))) {
      throw new UnauthorizedException('User information is required');
    }

    const adminUser = isAdmin(authUser);
    const normalizedUserId = authUser.userId ? String(authUser.userId) : null;

    this.logger.log(
      `Fetching active challenges for user ${normalizedUserId ?? 'admin'} with filters ${JSON.stringify(filters)}`,
    );

    const challengeTypeId = filters.challengeTypeId?.trim();
    const challengeTypeName = filters.challengeTypeName?.trim();

    const whereFragments: Prisma.Sql[] = [Prisma.sql`c.status = 'ACTIVE'`];

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

    const rowQuery = Prisma.sql`
      SELECT
        c.id AS "challengeId",
        c.name AS "challengeName",
        c."typeId" AS "challengeTypeId",
        ct.name AS "challengeTypeName",
        cp.name AS "currentPhaseName",
        cp."scheduledEndDate" AS "currentPhaseScheduledEnd",
        cp."actualEndDate" AS "currentPhaseActualEnd",
        rr.name AS "resourceRoleName"
      FROM challenges."Challenge" c
      ${joinClause}
      WHERE ${whereClause}
      ORDER BY c.name ASC
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
      return [];
    }

    const challengeIds = Array.from(
      new Set(challengeRows.map((row) => row.challengeId)),
    );

    const progressRows = await this.fetchReviewProgress(challengeIds);
    const progressByChallenge = new Map(
      progressRows.map((row) => [row.challengeId, row]),
    );

    const now = Date.now();
    const adminRoleLabel = adminUser ? 'Admin' : null;

    return challengeRows.map((row) => {
      const phaseEnd =
        row.currentPhaseActualEnd ?? row.currentPhaseScheduledEnd;
      let timeLeftSeconds = 0;
      if (phaseEnd) {
        const diff = phaseEnd.getTime() - now;
        timeLeftSeconds = diff > 0 ? Math.round(diff / 1000) : 0;
      }

      const progress = progressByChallenge.get(row.challengeId);
      const totalReviews = progress ? Number(progress.totalReviews) : 0;
      const completedReviews = progress ? Number(progress.completedReviews) : 0;
      const reviewProgress = totalReviews
        ? Math.min(1, Math.max(0, completedReviews / totalReviews))
        : 0;

      return {
        challengeId: row.challengeId,
        challengeName: row.challengeName,
        challengeTypeId: row.challengeTypeId,
        challengeTypeName: row.challengeTypeName,
        currentPhaseName: row.currentPhaseName,
        currentPhaseEndDate: phaseEnd ? phaseEnd.toISOString() : null,
        timeLeftInCurrentPhase: timeLeftSeconds,
        resourceRoleName: row.resourceRoleName ?? adminRoleLabel,
        reviewProgress,
      };
    });
  }

  private async fetchReviewProgress(
    challengeIds: string[],
  ): Promise<ReviewProgressRow[]> {
    if (!challengeIds.length) {
      return [];
    }

    const idFragments = challengeIds.map((id) => Prisma.sql`${id}`);
    const inClause = joinSqlFragments(idFragments, Prisma.sql`, `);

    const progressQuery = Prisma.sql`
      SELECT
        s."challengeId" AS "challengeId",
        COUNT(*)::bigint AS "totalReviews",
        SUM(CASE WHEN r.status = 'COMPLETED' THEN 1 ELSE 0 END)::bigint AS "completedReviews"
      FROM reviews.review r
      INNER JOIN "submission" s ON s.id = r."submissionId"
      WHERE s."challengeId" IN (${inClause})
      GROUP BY s."challengeId"
    `;

    const progressQueryDetails = progressQuery.inspect();
    this.logger.debug({
      message: 'Executing review progress query',
      sql: progressQueryDetails.sql,
      parameters: progressQueryDetails.values,
    });

    return this.prisma.$queryRaw<ReviewProgressRow[]>(progressQuery);
  }
}
