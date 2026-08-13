import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  Prisma,
  ReviewOpportunityStatus,
  ReviewOpportunityType,
} from '@prisma/client';
import {
  CreateReviewApplicationDto,
  QueryMyReviewApplicationDto,
  ReviewApplicationListMetadataDto,
  ReviewApplicationResponseDto,
  ReviewApplicationRole,
  ReviewApplicationStatus,
  getReviewApplicationRoles,
} from 'src/dto/reviewApplication.dto';
import { CommonConfig } from 'src/shared/config/common.config';
import { ChallengeApiService } from 'src/shared/modules/global/challenge.service';
import { ChallengePrismaService } from 'src/shared/modules/global/challenge-prisma.service';
import { ResourcePrismaService } from 'src/shared/modules/global/resource-prisma.service';
import {
  EventBusSendEmailPayload,
  EventBusService,
} from 'src/shared/modules/global/eventBus.service';
import { JwtUser } from 'src/shared/modules/global/jwt.service';
import { MemberService } from 'src/shared/modules/global/member.service';
import { PrismaService } from 'src/shared/modules/global/prisma.service';
import { PrismaErrorService } from 'src/shared/modules/global/prisma-error.service';
import { ChallengeStatus } from 'src/shared/enums/challengeStatus.enum';
import {
  RECENT_REVIEW_WINDOW_DAYS,
  resolveReviewerMetrics,
} from 'src/shared/modules/global/reviewer-metrics.util';

const RESOURCE_CREATED_TOPIC = 'challenge.action.resource.create';

interface RecentReviewAssignmentRow {
  memberId: string;
  challengeId: string;
  challengeName: string;
  assignedAt: Date;
}

interface RecentReviewAssignment {
  challengeId: string;
  challengeName: string;
  challengeUrl: string;
}

interface F2FIterativeReviewerConfigRow {
  shouldUseIterativeReviewerRole: boolean;
}

interface ReviewerResourceEventRecord {
  id: string;
  challengeId: string;
  memberId: string;
  memberHandle: string;
  roleId: string;
  createdAt?: Date | string | null;
  createdBy?: string | null;
  updatedAt?: Date | string | null;
  updatedBy?: string | null;
  phaseChangeNotifications?: boolean | null;
}

@Injectable()
export class ReviewApplicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly challengeService: ChallengeApiService,
    private readonly challengePrisma: ChallengePrismaService,
    private readonly resourcePrisma: ResourcePrismaService,
    private readonly memberService: MemberService,
    private readonly eventBusService: EventBusService,
    private readonly prismaErrorService: PrismaErrorService,
  ) {}

  /**
   * Creates a review application after enforcing challenge visibility,
   * opportunity state, role compatibility, capacity, and uniqueness.
   * The database uniqueness constraint remains authoritative when concurrent
   * requests both pass the optimistic duplicate pre-check.
   *
   * @param authUser - Authenticated reviewer.
   * @param dto - Opportunity and requested review role.
   * @returns Created pending review application.
   * @throws BadRequestException for an unknown opportunity or role mismatch.
   * @throws ConflictException for closed/full/inactive/duplicate applications.
   * @throws ForbiddenException when the challenge whitelist denies the caller.
   * @throws NotFoundException when the linked challenge no longer exists.
   * @throws InternalServerErrorException when a dependency fails unexpectedly.
   */
  async create(
    authUser: JwtUser,
    dto: CreateReviewApplicationDto,
  ): Promise<ReviewApplicationResponseDto> {
    const userId = String(authUser.userId);
    const handle = authUser.handle as string;
    const duplicateApplicationMessage = `User ${userId} has already submitted an application for opportunity ${dto.opportunityId} with role ${dto.role}`;

    try {
      // make sure review opportunity exists
      const opportunity = await this.prisma.reviewOpportunity.findUnique({
        where: { id: dto.opportunityId },
        include: {
          applications: {
            select: { status: true },
          },
        },
      });
      if (!opportunity || !opportunity.id) {
        throw new BadRequestException(
          `Review opportunity with ID ${dto.opportunityId} doesn't exist`,
        );
      }
      if (opportunity.status !== ReviewOpportunityStatus.OPEN) {
        throw new ConflictException({
          message: 'This review opportunity is no longer open.',
          code: 'REVIEW_OPPORTUNITY_CLOSED',
        });
      }
      const challenge = await this.challengeService.getChallengeDetailForUser(
        authUser,
        opportunity.challengeId,
      );
      if (challenge.status !== ChallengeStatus.ACTIVE) {
        throw new ConflictException({
          message:
            'Applications are closed because the challenge is not active.',
          code: 'REVIEW_OPPORTUNITY_CHALLENGE_NOT_ACTIVE',
        });
      }
      const approvedCount = opportunity.applications.filter(
        (application) =>
          application.status === ReviewApplicationStatus.APPROVED,
      ).length;
      if (approvedCount >= opportunity.openPositions) {
        throw new ConflictException({
          message: 'All reviewer positions have been filled.',
          code: 'REVIEW_OPPORTUNITY_FULL',
        });
      }
      // make sure application role matches
      if (!getReviewApplicationRoles(opportunity.type).includes(dto.role)) {
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
        throw new ConflictException(duplicateApplicationMessage);
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
      // The application insert is the only write in this block. A P2002 here
      // is the composite opportunity/member/role constraint closing a race in
      // which concurrent requests both passed the duplicate pre-check.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(duplicateApplicationMessage);
      }

      // Re-throw business logic exceptions as-is
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException ||
        error instanceof ForbiddenException ||
        error instanceof NotFoundException
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
   * Lists one member's review applications with database filtering, ordering,
   * and an explicit total for the Opportunities UI.
   *
   * @param userId - Authenticated member ID.
   * @param dto - Application status, role, opportunity, and page filters.
   * @returns Filtered application page and pagination metadata.
   * @throws InternalServerErrorException when the database query fails.
   */
  async listByUserPaginated(
    userId: string,
    dto: QueryMyReviewApplicationDto,
  ): Promise<{
    items: ReviewApplicationResponseDto[];
    metadata: ReviewApplicationListMetadataDto;
  }> {
    try {
      const where: Prisma.reviewApplicationWhereInput = {
        userId,
        ...(dto.statuses?.length
          ? { status: { in: dto.statuses as any } }
          : {}),
        ...(dto.roles?.length ? { role: { in: dto.roles as any } } : {}),
        ...(dto.opportunityId ? { opportunityId: dto.opportunityId } : {}),
      };
      const page = dto.page ?? 1;
      const perPage = dto.perPage ?? 10;
      const [entities, total] = await this.prisma.$transaction([
        this.prisma.reviewApplication.findMany({
          where,
          orderBy: [{ createdAt: dto.sortOrder ?? 'desc' }, { id: 'asc' }],
          skip: (page - 1) * perPage,
          take: perPage,
        }),
        this.prisma.reviewApplication.count({ where }),
      ]);
      return {
        items: entities.map((entity) => this.buildResponse(entity)),
        metadata: {
          total,
          page,
          perPage,
          totalPages: total > 0 ? Math.ceil(total / perPage) : 0,
        },
      };
    } catch (error) {
      const errorResponse = this.prismaErrorService.handleError(
        error,
        `fetching paginated review applications for user ${userId}`,
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  /**
   * Lists the public applicant panel for an opportunity only after enforcing
   * the linked challenge's canonical whitelist, group, and task visibility.
   * Applicant assignment metrics are resolved in one batched query.
   *
   * @param opportunityId - Review opportunity identifier.
   * @param authUser - Optional caller used by the challenge visibility gate.
   * @returns Applications for a caller-visible opportunity.
   * @throws NotFoundException when the opportunity does not exist or its
   * linked challenge is hidden; both cases use the same response contract.
   * @throws InternalServerErrorException when application or metric storage fails.
   */
  async listByOpportunity(
    opportunityId: string,
    authUser?: JwtUser,
  ): Promise<ReviewApplicationResponseDto[]> {
    try {
      const unavailableResponse = {
        message: 'Review opportunity was not found.',
        code: 'REVIEW_OPPORTUNITY_NOT_FOUND',
      };
      const opportunity = await this.prisma.reviewOpportunity.findUnique({
        where: { id: opportunityId },
        select: { challengeId: true },
      });
      if (!opportunity) {
        throw new NotFoundException(unavailableResponse);
      }
      try {
        await this.challengeService.ensureChallengeWhitelistAccess(
          authUser,
          opportunity.challengeId,
        );
      } catch (error) {
        if (error instanceof ForbiddenException) {
          throw new NotFoundException(unavailableResponse);
        }
        throw error;
      }

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

      const reviewerMetrics = await resolveReviewerMetrics(
        this.challengePrisma,
        userIds,
      );

      return entityList.map((entity) =>
        this.buildResponse(entity, reviewerMetrics.get(String(entity.userId))),
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
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
   * Get reviewer challenge assignments created in the last 60 days.
   * @param userIds reviewer member ids
   * @returns user assignment map keyed by member id
   */
  private async getRecentReviewAssignments(
    userIds: string[],
  ): Promise<Map<string, RecentReviewAssignment[]>> {
    const assignments = new Map<string, RecentReviewAssignment[]>();

    const normalizedIds = Array.from(
      new Set(
        userIds
          .map((id) => id?.trim())
          .filter((id): id is string => Boolean(id && id.length > 0)),
      ),
    );

    if (!normalizedIds.length) {
      return assignments;
    }

    const memberIdList = Prisma.join(
      normalizedIds.map((id) => Prisma.sql`${id}`),
    );
    const recentThreshold = new Date();
    recentThreshold.setDate(
      recentThreshold.getDate() - RECENT_REVIEW_WINDOW_DAYS,
    );

    const assignmentQuery = Prisma.sql`
      SELECT
        r."memberId" AS "memberId",
        c.id AS "challengeId",
        c.name AS "challengeName",
        MAX(r."createdAt") AS "assignedAt"
      FROM resources."Resource" r
      INNER JOIN challenges."Challenge" c
        ON c.id = r."challengeId"
      INNER JOIN resources."ResourceRole" rr
        ON rr.id = r."roleId"
      WHERE r."memberId" IN (${memberIdList})
        AND LOWER(rr.name) LIKE '%reviewer%'
        AND r."createdAt" >= ${recentThreshold}
      GROUP BY r."memberId", c.id, c.name
      ORDER BY r."memberId", "assignedAt" DESC, c.id ASC
    `;

    const rows =
      await this.challengePrisma.$queryRaw<RecentReviewAssignmentRow[]>(
        assignmentQuery,
      );

    rows.forEach((row) => {
      const memberId = String(row.memberId);
      const existing = assignments.get(memberId) ?? [];

      existing.push({
        challengeId: row.challengeId,
        challengeName: row.challengeName,
        challengeUrl: this.buildChallengeUrl(row.challengeId),
      });

      assignments.set(memberId, existing);
    });

    normalizedIds
      .filter((id) => !assignments.has(id))
      .forEach((id) => assignments.set(id, []));

    return assignments;
  }

  /**
   * Approves a review application, ensures the reviewer resource exists on the
   * challenge, publishes the resource-created event consumed by autopilot, and
   * sends the approval email.
   * @param id Review application id to approve.
   * @returns Resolves after the application is approved and notifications are sent.
   * @throws NotFoundException when the application does not exist.
   * @throws InternalServerErrorException when resource creation, event publishing,
   * application update, or notification sending fails.
   */
  async approve(id: string): Promise<void> {
    try {
      const entity = await this.checkExists(id);

      // Assign reviewer resource on the challenge before marking approved
      const challengeId = entity.opportunity.challengeId;
      const memberId = String(entity.userId);
      const handle = entity.handle ?? '';

      const roleName = await this.getResourceRoleNameForApproval(entity);

      // Resolve role id directly from the Resource DB
      const role = await this.resourcePrisma.resourceRole.findFirst({
        where: { name: roleName },
      });
      if (!role) {
        throw new BadRequestException(
          `Resource role '${roleName}' not found in resource database`,
        );
      }

      // Check if member already has this reviewer role on the challenge
      const existingRole = await this.resourcePrisma.resource.findFirst({
        where: {
          challengeId,
          memberId,
          roleId: role.id,
        },
      });

      let reviewerResource = existingRole;

      if (!reviewerResource) {
        // Create reviewer resource directly in Resource DB
        reviewerResource = await this.resourcePrisma.resource.create({
          data: {
            challengeId,
            memberId,
            memberHandle: handle,
            roleId: role.id,
            createdBy: 'review-api',
          },
        });
      }

      await this.publishResourceCreatedEvent(reviewerResource, role.name);

      // Update application status and send email
      await this.prisma.reviewApplication.update({
        where: { id },
        data: {
          status: ReviewApplicationStatus.APPROVED,
        },
      });
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
   * Publishes the resource-created event that resource-api normally emits so
   * autopilot can react to reviewer assignments created by review-api.
   * @param resource Reviewer resource record that was created or already existed.
   * @param roleName Resource role name resolved for the approved application.
   * @returns Resolves after the event bus accepts the message.
   * @throws Error from EventBusService when event publication fails.
   *
   * Used by approve() after ensuring the reviewer resource exists.
   */
  private async publishResourceCreatedEvent(
    resource: ReviewerResourceEventRecord,
    roleName: string,
  ): Promise<void> {
    const created =
      resource.createdAt instanceof Date
        ? resource.createdAt.toISOString()
        : resource.createdAt || new Date().toISOString();
    const updated =
      resource.updatedAt instanceof Date
        ? resource.updatedAt.toISOString()
        : resource.updatedAt || undefined;

    await this.eventBusService.publish(RESOURCE_CREATED_TOPIC, {
      id: resource.id,
      challengeId: resource.challengeId,
      memberId: resource.memberId,
      memberHandle: resource.memberHandle,
      roleId: resource.roleId,
      phaseChangeNotifications: resource.phaseChangeNotifications !== false,
      created,
      createdBy: resource.createdBy ?? 'review-api',
      updated,
      updatedBy: resource.updatedBy ?? undefined,
      roleName,
    });
  }

  /**
   * Determine the resource role name used when approving an application.
   * First2Finish reviewer openings are backed by the Iterative Review phase,
   * so regular-looking legacy opportunities for those configs must still
   * assign the Iterative Reviewer resource role.
   *
   * @param entity review application with its linked opportunity
   * @returns resource role name to assign on the challenge
   */
  private async getResourceRoleNameForApproval(entity: {
    role: ReviewApplicationRole | string;
    opportunity: {
      challengeId: string;
      type: ReviewOpportunityType;
    };
  }): Promise<string> {
    const applicationRole = entity.role as ReviewApplicationRole;

    if (
      entity.opportunity.type === ReviewOpportunityType.REGULAR_REVIEW &&
      applicationRole === ReviewApplicationRole.REVIEWER &&
      (await this.hasF2FIterativeReviewerConfig(entity.opportunity.challengeId))
    ) {
      return 'Iterative Reviewer';
    }

    return this.getResourceRoleName(entity.opportunity.type, applicationRole);
  }

  /**
   * Check whether a challenge has an open member-reviewer config attached to
   * the Iterative Review phase on a First2Finish challenge.
   *
   * @param challengeId challenge id from the review opportunity
   * @returns true when approval should assign the Iterative Reviewer role
   */
  private async hasF2FIterativeReviewerConfig(
    challengeId: string,
  ): Promise<boolean> {
    const rows = await this.challengePrisma.$queryRaw<
      F2FIterativeReviewerConfigRow[]
    >(Prisma.sql`
      SELECT EXISTS (
        SELECT 1
        FROM "Challenge" c
        INNER JOIN "ChallengeType" ct
          ON ct.id = c."typeId"
        INNER JOIN "ChallengeReviewer" cr
          ON cr."challengeId" = c.id
        INNER JOIN "ChallengePhase" cp
          ON cp."challengeId" = c.id
          AND (cp.id = cr."phaseId" OR cp."phaseId" = cr."phaseId")
        WHERE c.id = ${challengeId}
          AND (
            LOWER(ct.name) = 'first2finish'
            OR LOWER(ct.abbreviation) = 'f2f'
          )
          AND LOWER(REPLACE(cp.name, ' ', '')) = 'iterativereview'
          AND cr."isMemberReview" IS TRUE
          AND cr."shouldOpenOpportunity" IS NOT FALSE
      ) AS "shouldUseIterativeReviewerRole"
    `);

    return rows[0]?.shouldUseIterativeReviewerRole === true;
  }

  /**
   * Determine the resource role name based on opportunity type with fallback on specific application role.
   */
  private getResourceRoleName(
    opportunityType: ReviewOpportunityType,
    applicationRole: ReviewApplicationRole,
  ): string {
    switch (opportunityType) {
      case ReviewOpportunityType.REGULAR_REVIEW:
        return 'Reviewer';
      case ReviewOpportunityType.ITERATIVE_REVIEW:
        return 'Iterative Reviewer';
      default:
        return this.mapApplicationRoleToResourceRoleName(applicationRole);
    }
  }

  /**
   * Map ReviewApplicationRole to corresponding resource role name.
   */
  private mapApplicationRoleToResourceRoleName(
    role: ReviewApplicationRole,
  ): string {
    switch (role) {
      case ReviewApplicationRole.REVIEWER:
        return 'Reviewer';
      case ReviewApplicationRole.ITERATIVE_REVIEWER:
        return 'Iterative Reviewer';
      case ReviewApplicationRole.SPECIFICATION_REVIEWER:
        return 'Specification Reviewer';
      case ReviewApplicationRole.ACCURACY_REVIEWER:
        return 'Accuracy Reviewer';
      case ReviewApplicationRole.STRESS_REVIEWER:
        return 'Stress Reviewer';
      case ReviewApplicationRole.FAILURE_REVIEWER:
      case ReviewApplicationRole.PRIMARY_FAILURE_REVIEWER:
        return 'Failure Reviewer';
      case ReviewApplicationRole.PRIMARY_REVIEWER:
      case ReviewApplicationRole.SECONDARY_REVIEWER:
        // Default to generic Reviewer role for primary/secondary
        return 'Reviewer';
      default:
        return 'Reviewer';
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
    const [challengeData, memberInfoList, recentAssignmentsByUser] =
      await Promise.all([
        this.challengeService.getChallengeDetail(challengeId),
        this.memberService.getUserEmails(userIds),
        this.getRecentReviewAssignments(userIds),
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
    const challengeUrl = this.buildChallengeUrl(challengeData.id);
    // build event bus message payload
    const eventBusPayloads: EventBusSendEmailPayload[] = [];
    for (const entity of entityList) {
      const payload: EventBusSendEmailPayload = new EventBusSendEmailPayload();
      payload.sendgrid_template_id = sendgridTemplateId;
      payload.recipients = [userEmailMap.get(entity.userId)];
      const pastReviewAssignments =
        recentAssignmentsByUser.get(String(entity.userId)) ?? [];
      payload.data = {
        handle: entity.handle,
        reviewPhaseStart: entity.startDate,
        challengeUrl,
        challengeName,
        pastReviewAssignments,
        hasPastReviewAssignments: pastReviewAssignments.length > 0,
        pastReviewAssignmentsWindowDays: RECENT_REVIEW_WINDOW_DAYS,
      };
      eventBusPayloads.push(payload);
    }
    // send all emails
    await Promise.all(
      eventBusPayloads.map((e) => this.eventBusService.sendEmail(e)),
    );
  }

  private buildChallengeUrl(challengeId: string): string {
    return `${CommonConfig.apis.onlineReviewUrlBase}${challengeId}/challenge-details`;
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
