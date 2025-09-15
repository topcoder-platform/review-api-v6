import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  CreateReviewApplicationDto,
  ReviewApplicationResponseDto,
  ReviewApplicationRoleOpportunityTypeMap,
  ReviewApplicationStatus,
} from 'src/dto/reviewApplication.dto';
import { CommonConfig } from 'src/shared/config/common.config';
import { ChallengeApiService } from 'src/shared/modules/global/challenge.service';
import {
  EventBusSendEmailPayload,
  EventBusService,
} from 'src/shared/modules/global/eventBus.service';
import { JwtUser } from 'src/shared/modules/global/jwt.service';
import { MemberService } from 'src/shared/modules/global/member.service';
import { PrismaService } from 'src/shared/modules/global/prisma.service';
import { PrismaErrorService } from 'src/shared/modules/global/prisma-error.service';

@Injectable()
export class ReviewApplicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly challengeService: ChallengeApiService,
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
          createdBy: userId,
          updatedBy: userId,
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
      return entityList.map((e) => this.buildResponse(e));
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

  /**
   * Approve a review application.
   * @param authUser auth user
   * @param id review application id
   */
  async approve(authUser: JwtUser, id: string): Promise<void> {
    try {
      const entity = await this.checkExists(id);
      await this.prisma.reviewApplication.update({
        where: { id },
        data: {
          status: ReviewApplicationStatus.APPROVED,
          updatedBy: authUser.userId ?? '',
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
   * @param authUser auth user
   * @param id review application id
   */
  async reject(authUser: JwtUser, id: string): Promise<void> {
    try {
      const entity = await this.checkExists(id);
      await this.prisma.reviewApplication.update({
        where: { id },
        data: {
          status: ReviewApplicationStatus.REJECTED,
          updatedBy: authUser.userId ?? '',
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
   * @param authUser auth user
   * @param opportunityId opportunity id
   */
  async rejectAllPending(
    authUser: JwtUser,
    opportunityId: string,
  ): Promise<void> {
    try {
      // select all pending
      const entityList = await this.prisma.reviewApplication.findMany({
        where: { opportunityId, status: ReviewApplicationStatus.PENDING },
        include: { opportunity: true },
      });
      // update all pending
      await this.prisma.reviewApplication.updateMany({
        where: { opportunityId, status: ReviewApplicationStatus.PENDING },
        data: {
          status: ReviewApplicationStatus.REJECTED,
          updatedBy: authUser.userId ?? '',
        },
      });
      // send emails to these users
      await this.sendEmails(entityList, ReviewApplicationStatus.REJECTED);
    } catch (error) {
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
  private buildResponse(entity): ReviewApplicationResponseDto {
    const ret = new ReviewApplicationResponseDto();
    ret.id = entity.id;
    ret.userId = entity.userId;
    ret.handle = entity.handle;
    ret.opportunityId = entity.opportunityId;
    ret.role = entity.role;
    ret.status = entity.status;
    ret.applicationDate = entity.createdAt;
    return ret;
  }
}
