import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CreateReviewApplicationDto,
  ReviewApplicationResponseDto,
  ReviewApplicationRoleOpportunityTypeMap,
  ReviewApplicationStatus,
} from 'src/dto/reviewApplication.dto';
import { CommonConfig } from 'src/shared/config/common.config';
import { ChallengeApiService } from 'src/shared/modules/global/challenge.service';
import { ChallengePrismaService } from 'src/shared/modules/global/challenge-prisma.service';
import {
  EventBusSendEmailPayload,
  EventBusService,
} from 'src/shared/modules/global/eventBus.service';
import { JwtUser } from 'src/shared/modules/global/jwt.service';
import { MemberService } from 'src/shared/modules/global/member.service';
import { PrismaService } from 'src/shared/modules/global/prisma.service';
import { PrismaErrorService } from 'src/shared/modules/global/prisma-error.service';

const RECENT_REVIEW_WINDOW_DAYS = 60;

interface ReviewerMetricsRow {
  memberId: string;
  openReviews: bigint;
  latestCompletedReviews: bigint;
}

@Injectable()
export class ReviewApplicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly challengeService: ChallengeApiService,
    private readonly challengePrisma: ChallengePrismaService,
    private readonly memberService: MemberService,
    private readonly eventBusService: EventBusService,
    private readonly prismaErrorService: PrismaErrorService,
  ) {}

  /**
   * Create review application
   * @param authUser auth user
   * @param dto create data
   * @returns response dto
   */
  async create(
    authUser: JwtUser,
    dto: CreateReviewApplicationDto,
  ): Promise<ReviewApplicationResponseDto> {
    const userId = String(authUser.userId);
    const handle = authUser.handle as string;

    try {
      // make sure review opportunity exists
      const opportunity = await this.prisma.reviewOpportunity.findUnique({
        where: { id: dto.opportunityId },
      });
      if (!opportunity || !opportunity.id) {
        throw new BadRequestException(
          `Review opportunity with ID ${dto.opportunityId} doesn't exist`,
        );
      }
      // make sure application role matches
      if (
        ReviewApplicationRoleOpportunityTypeMap[dto.role] !== opportunity.type
      ) {
        throw new BadRequestException(
          `Review application role ${dto.role} doesn't match opportunity type ${opportunity.type}`,
        );
      }
      // check existing
      const existing = await this.prisma.reviewApplication.findMany({
        where: {
          userId,
          opportunityId: dto.opportunityId,
          role: dto.role,
        },
      });
      if (existing && existing.length > 0) {
        throw new ConflictException(
          `User ${userId} has already submitted an application for opportunity ${dto.opportunityId} with role ${dto.role}`,
        );
      }
      const entity = await this.prisma.reviewApplication.create({
        data: {
          role: dto.role,
          opportunityId: dto.opportunityId,
          status: ReviewApplicationStatus.PENDING,
          userId,
          handle,
        },
      });
      return this.buildResponse(entity);
    } catch (error) {
      // Re-throw business logic exceptions as-is
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException
      ) {
        throw error;
      }

      const errorResponse = this.prismaErrorService.handleError(
        error,
        `creating review application for user ${userId} and opportunity ${dto.opportunityId}`,
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  /**
   * Get all pending review applications.
   * @returns All pending applications
   */
  async listPending(): Promise<ReviewApplicationResponseDto[]> {
    try {
      const entityList = await this.prisma.reviewApplication.findMany({
        where: { status: ReviewApplicationStatus.PENDING },
      });
      return entityList.map((e) => this.buildResponse(e));
    } catch (error) {
      const errorResponse = this.prismaErrorService.handleError(
        error,
        'fetching pending review applications',
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  /**
   * Get all review applications of specific user
   * @param userId user id
   * @returns all applications of this user
   */
  async listByUser(userId: string): Promise<ReviewApplicationResponseDto[]> {
    try {
      const entityList = await this.prisma.reviewApplication.findMany({
        where: { userId },
      });
      return entityList.map((e) => this.buildResponse(e));
    } catch (error) {
      const errorResponse = this.prismaErrorService.handleError(
        error,
        `fetching review applications for user ${userId}`,
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  /**
   * Get all review applications of a review opportunity
   * @param opportunityId opportunity id
   * @returns all applications
   */
  async listByOpportunity(
    opportunityId: string,
  ): Promise<ReviewApplicationResponseDto[]> {
    try {
      const entityList = await this.prisma.reviewApplication.findMany({
        where: { opportunityId },
      });
      if (!entityList.length) {
        return [];
      }

      const userIds = Array.from(
        new Set(
          entityList
            .map((entity) =>
              entity.userId != null ? String(entity.userId) : undefined,
            )
            .filter((id): id is string => Boolean(id)),
        ),
      );

      const reviewerMetrics = await this.getReviewerMetrics(userIds);

      return entityList.map((entity) =>
        this.buildResponse(entity, reviewerMetrics.get(String(entity.userId))),
      );
    } catch (error) {
      const errorResponse = this.prismaErrorService.handleError(
        error,
        `fetching review applications for opportunity ${opportunityId}`,
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  private async getReviewerMetrics(
    userIds: string[],
  ): Promise<
    Map<string, { openReviews: number; latestCompletedReviews: number }>
  > {
    const metrics = new Map<
      string,
      { openReviews: number; latestCompletedReviews: number }
    >();

    const normalizedIds = Array.from(
      new Set(
        userIds
          .map((id) => id?.trim())
          .filter((id): id is string => Boolean(id && id.length > 0)),
      ),
    );

    if (!normalizedIds.length) {
      return metrics;
    }

    const memberIdList = Prisma.join(
      normalizedIds.map((id) => Prisma.sql`${id}`),
    );
    const recentThreshold = new Date();
    recentThreshold.setDate(
      recentThreshold.getDate() - RECENT_REVIEW_WINDOW_DAYS,
    );

    const metricsQuery = Prisma.sql`
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
    `;

    const rows =
      await this.challengePrisma.$queryRaw<ReviewerMetricsRow[]>(metricsQuery);

    rows.forEach((row) => {
      metrics.set(row.memberId, {
        openReviews: Number(row.openReviews),
        latestCompletedReviews: Number(row.latestCompletedReviews),
      });
    });

    normalizedIds
      .filter((id) => !metrics.has(id))
      .forEach((id) =>
        metrics.set(id, { openReviews: 0, latestCompletedReviews: 0 }),
      );

    return metrics;
  }

  /**
   * Approve a review application.
   * @param id review application id
   */
  async approve(id: string): Promise<void> {
    try {
      const entity = await this.checkExists(id);

      await this.prisma.reviewApplication.update({
        where: { id },
        data: {
          status: ReviewApplicationStatus.APPROVED,
        },
      });
      // send email
      await this.sendEmails([entity], ReviewApplicationStatus.APPROVED);
    } catch (error) {
      // Re-throw NotFoundException from checkExists as-is
      if (error instanceof NotFoundException) {
        throw error;
      }

      const errorResponse = this.prismaErrorService.handleError(
        error,
        `approving review application ${id}`,
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  /**
   * Reject a review application.
   * @param id review application id
   */
  async reject(id: string): Promise<void> {
    try {
      const entity = await this.checkExists(id);

      await this.prisma.reviewApplication.update({
        where: { id },
        data: {
          status: ReviewApplicationStatus.REJECTED,
        },
      });
      // send email
      await this.sendEmails([entity], ReviewApplicationStatus.REJECTED);
    } catch (error) {
      // Re-throw NotFoundException from checkExists as-is
      if (error instanceof NotFoundException) {
        throw error;
      }

      const errorResponse = this.prismaErrorService.handleError(
        error,
        `rejecting review application ${id}`,
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  /**
   * Reject all pending applications of specific opportunity
   * @param opportunityId opportunity id
   */
  async rejectAllPending(opportunityId: string): Promise<void> {
    try {
      // select all pending
      const entityList = await this.prisma.reviewApplication.findMany({
        where: { opportunityId, status: ReviewApplicationStatus.PENDING },
        include: { opportunity: true },
      });
      if (!entityList.length) {
        throw new NotFoundException(
          `Review opportunity with ID ${opportunityId} does not have any pending review applications to reject.`,
        );
      }
      // update all pending
      await this.prisma.reviewApplication.updateMany({
        where: { opportunityId, status: ReviewApplicationStatus.PENDING },
        data: {
          status: ReviewApplicationStatus.REJECTED,
        },
      });
      // send emails to these users
      await this.sendEmails(entityList, ReviewApplicationStatus.REJECTED);
    } catch (error) {
      // Re-throw NotFoundException from empty pending list as-is
      if (error instanceof NotFoundException) {
        throw error;
      }

      const errorResponse = this.prismaErrorService.handleError(
        error,
        `rejecting all pending applications for opportunity ${opportunityId}`,
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  /**
   * Get user approved review application list within date range.
   * @param userId user id
   * @param range date range in days. 60 days default.
   * @returns application list
   */
  async getHistory(userId: string, range: number = 60) {
    try {
      // calculate begin date
      const beginDate = new Date();
      beginDate.setDate(beginDate.getDate() - range);
      const entityList = await this.prisma.reviewApplication.findMany({
        where: {
          userId,
          status: ReviewApplicationStatus.APPROVED,
          createdAt: {
            gte: beginDate,
          },
        },
      });
      return entityList.map((e) => this.buildResponse(e));
    } catch (error) {
      const errorResponse = this.prismaErrorService.handleError(
        error,
        `fetching review application history for user ${userId} within ${range} days`,
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  /**
   * Send emails to appliers
   * @param entityList review application entity list
   * @param status application status
   */
  private async sendEmails(
    entityList: any[],
    status: ReviewApplicationStatus,
  ): Promise<void> {
    // All review application has same review opportunity and same challenge id.
    const challengeId = entityList[0].opportunity.challengeId;
    // get member id list
    const userIds: string[] = entityList.map((e: any) => e.userId as string);
    // Get challenge data and member emails.
    const [challengeData, memberInfoList] = await Promise.all([
      this.challengeService.getChallengeDetail(challengeId),
      this.memberService.getUserEmails(userIds),
    ]);
    // Get sendgrid template id
    const sendgridTemplateId =
      status === ReviewApplicationStatus.APPROVED
        ? CommonConfig.sendgridConfig.acceptEmailTemplate
        : CommonConfig.sendgridConfig.rejectEmailTemplate;
    // build userId -> email map
    const userEmailMap = new Map();
    memberInfoList.forEach((e) => userEmailMap.set(e.userId, e.email));
    // prepare challenge data
    const challengeName = challengeData.name;
    const challengeUrl =
      CommonConfig.apis.onlineReviewUrlBase + challengeData.legacyId;
    // build event bus message payload
    const eventBusPayloads: EventBusSendEmailPayload[] = [];
    for (const entity of entityList) {
      const payload: EventBusSendEmailPayload = new EventBusSendEmailPayload();
      payload.sendgrid_template_id = sendgridTemplateId;
      payload.recipients = [userEmailMap.get(entity.userId)];
      payload.data = {
        handle: entity.handle,
        reviewPhaseStart: entity.startDate,
        challengeUrl,
        challengeName,
      };
      eventBusPayloads.push(payload);
    }
    // send all emails
    await Promise.all(
      eventBusPayloads.map((e) => this.eventBusService.sendEmail(e)),
    );
  }

  /**
   * Make sure review application exists.
   * @param id review application id
   * @returns entity if exists
   */
  private async checkExists(id: string) {
    try {
      const entity = await this.prisma.reviewApplication.findUnique({
        where: { id },
        include: { opportunity: true },
      });
      if (!entity || !entity.id) {
        throw new NotFoundException(
          `Review application with ID ${id} not found. Please verify the application ID is correct.`,
        );
      }
      return entity;
    } catch (error) {
      // Re-throw NotFoundException as-is
      if (error instanceof NotFoundException) {
        throw error;
      }

      const errorResponse = this.prismaErrorService.handleError(
        error,
        `checking existence of review application ${id}`,
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  /**
   * Convert prisma entity to response dto.
   * @param entity prisma entity
   * @returns response dto
   */
  private buildResponse(
    entity,
    metrics?: {
      openReviews?: number;
      latestCompletedReviews?: number;
    },
  ): ReviewApplicationResponseDto {
    const ret = new ReviewApplicationResponseDto();
    ret.id = entity.id;
    ret.userId = entity.userId;
    ret.handle = entity.handle;
    ret.opportunityId = entity.opportunityId;
    ret.role = entity.role;
    ret.status = entity.status;
    ret.applicationDate = entity.createdAt;
    ret.openReviews = metrics?.openReviews ?? 0;
    ret.latestCompletedReviews = metrics?.latestCompletedReviews ?? 0;
    return ret;
  }
}
