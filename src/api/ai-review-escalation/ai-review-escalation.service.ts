import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/modules/global/prisma.service';
import { LoggerService } from 'src/shared/modules/global/logger.service';
import { ResourcePrismaService } from 'src/shared/modules/global/resource-prisma.service';
import {
  ChallengeApiService,
  ChallengeData,
} from 'src/shared/modules/global/challenge.service';
import { ChallengePrismaService } from 'src/shared/modules/global/challenge-prisma.service';
import { JwtUser, isAdmin } from 'src/shared/modules/global/jwt.service';
import {
  EventBusSendEmailPayload,
  EventBusService,
} from 'src/shared/modules/global/eventBus.service';
import { MemberService } from 'src/shared/modules/global/member.service';
import { CommonConfig } from 'src/shared/config/common.config';
import {
  CreateAiReviewEscalationDto,
  UpdateAiReviewEscalationDto,
  AiReviewDecisionEscalationResponseDto,
  AiReviewDecisionEscalationStatus,
  ListAiReviewEscalationQueryDto,
  AiReviewDecisionEscalationDecisionResponseDto,
} from '../../dto/aiReviewEscalation.dto';
import {
  AiReviewDecisionStatus,
  AiReviewDecisionEscalationStatus as PrismaAiReviewDecisionEscalationStatus,
  Prisma,
  ReviewStatus,
} from '@prisma/client';

const MANUAL_OVERRIDE_PHASE_ROLE_MAP: Record<string, string[]> = {
  Review: ['reviewer'],
  'Iterative Review': ['iterative reviewer'],
  Screening: ['screener'],
  'Checkpoint Screening': ['checkpoint screener'],
};

interface NotificationRecipient {
  email: string;
  handle: string;
  userId: string;
}

interface ManualOverrideChallengePhaseRow {
  id: string;
  phaseId: string;
  name: string;
  isOpen: boolean | null;
  scheduledStartDate: Date | null;
  scheduledEndDate: Date | null;
  actualStartDate: Date | null;
  actualEndDate: Date | null;
}

interface ManualOverrideReviewerConfigRow {
  phaseId: string;
  scorecardId: string;
}

interface PendingReviewRow {
  id: string;
  resourceId: string;
  submissionId: string | null;
  scorecardId: string;
}

function mapEscalationToResponse(row: {
  id: string;
  aiReviewDecisionId: string;
  escalationNotes: string | null;
  approverNotes: string | null;
  status: string;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}): AiReviewDecisionEscalationResponseDto {
  return {
    id: row.id,
    aiReviewDecisionId: row.aiReviewDecisionId,
    escalationNotes: row.escalationNotes,
    approverNotes: row.approverNotes,
    status: row.status as AiReviewDecisionEscalationResponseDto['status'],
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

type AiReviewDecisionEscalationRecord = Parameters<
  typeof mapEscalationToResponse
>[0];

type AiReviewDecisionEscalationDecisionRecord = {
  id: string;
  submissionId: string;
  status: string;
  submissionLocked: boolean;
  config?: { challengeId: string };
  submission?: { id: string; challengeId: string | null };
  escalations: AiReviewDecisionEscalationRecord[];
};

@Injectable()
export class AiReviewEscalationService {
  private readonly logger: LoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly resourcePrisma: ResourcePrismaService,
    private readonly challengeApiService: ChallengeApiService,
    private readonly challengePrisma: ChallengePrismaService,
    private readonly eventBusService: EventBusService,
    private readonly memberService: MemberService,
  ) {
    this.logger = LoggerService.forRoot('AiReviewEscalationService');
  }

  private isChallengePhaseCurrentlyOpen(
    phase: {
      isOpen: boolean | null;
      scheduledStartDate: Date | null;
      scheduledEndDate: Date | null;
      actualStartDate: Date | null;
      actualEndDate: Date | null;
    },
    referenceDate = new Date(),
  ): boolean {
    if (phase.isOpen) {
      return true;
    }

    const start = phase.actualStartDate ?? phase.scheduledStartDate;
    if (!start || referenceDate < start) {
      return false;
    }

    if (phase.actualStartDate && !phase.actualEndDate) {
      return true;
    }

    const end = phase.actualEndDate ?? phase.scheduledEndDate;
    if (!end) {
      return true;
    }

    return referenceDate < end;
  }

  private async buildPendingReviewsForUnlockedSubmission(
    challengeId: string,
    submissionId: string,
    userId: string,
  ): Promise<Prisma.reviewCreateManyInput[]> {
    const manualOverridePhaseNames = Object.keys(
      MANUAL_OVERRIDE_PHASE_ROLE_MAP,
    );

    const challengePhases = await this.challengePrisma.$queryRaw<
      ManualOverrideChallengePhaseRow[]
    >(Prisma.sql`
      SELECT
        id,
        "phaseId",
        name,
        "isOpen",
        "scheduledStartDate",
        "scheduledEndDate",
        "actualStartDate",
        "actualEndDate"
      FROM "ChallengePhase"
      WHERE "challengeId" = ${challengeId}
        AND name IN (${Prisma.join(
          manualOverridePhaseNames.map((phaseName) => Prisma.sql`${phaseName}`),
        )})
    `);

    const openChallengePhases = challengePhases.filter((phase) =>
      this.isChallengePhaseCurrentlyOpen(phase),
    );

    if (openChallengePhases.length === 0) {
      this.logger.warn(
        `No open manual review phases found for unlocked submission ${submissionId} on challenge ${challengeId}`,
      );
      return [];
    }

    const reviewerConfigs = await this.challengePrisma.$queryRaw<
      ManualOverrideReviewerConfigRow[]
    >(Prisma.sql`
      SELECT "phaseId", "scorecardId"
      FROM "ChallengeReviewer"
      WHERE "challengeId" = ${challengeId}
        AND "isMemberReview" = true
        AND "phaseId" IN (${Prisma.join(
          openChallengePhases.map((phase) => Prisma.sql`${phase.phaseId}`),
        )})
    `);

    const scorecardIdsByTemplatePhaseId = new Map<string, Set<string>>();
    for (const config of reviewerConfigs) {
      const scorecardId = String(config.scorecardId || '').trim();
      if (!scorecardId) {
        continue;
      }

      const phaseScorecards =
        scorecardIdsByTemplatePhaseId.get(config.phaseId) ?? new Set<string>();
      phaseScorecards.add(scorecardId);
      scorecardIdsByTemplatePhaseId.set(config.phaseId, phaseScorecards);
    }

    const pendingReviewMap = new Map<string, Prisma.reviewCreateManyInput>();

    for (const phase of openChallengePhases) {
      const roleNames = MANUAL_OVERRIDE_PHASE_ROLE_MAP[phase.name] ?? [];
      if (roleNames.length === 0) {
        continue;
      }

      const scorecardIds = Array.from(
        scorecardIdsByTemplatePhaseId.get(phase.phaseId) ?? [],
      );
      if (scorecardIds.length === 0) {
        this.logger.warn(
          `No member review scorecard configured for phase ${phase.name} on challenge ${challengeId}`,
        );
        continue;
      }

      const reviewerResources = await this.resourcePrisma.resource.findMany({
        where: {
          challengeId,
          resourceRole: {
            nameLower: { in: roleNames },
          },
        },
        select: { id: true },
      });

      if (reviewerResources.length === 0) {
        this.logger.warn(
          `No reviewer resources found for phase ${phase.name} on challenge ${challengeId}`,
        );
        continue;
      }

      for (const resource of reviewerResources) {
        for (const scorecardId of scorecardIds) {
          const key = `${resource.id}:${submissionId}:${scorecardId}`;
          if (pendingReviewMap.has(key)) {
            continue;
          }

          pendingReviewMap.set(key, {
            resourceId: resource.id,
            phaseId: phase.id,
            submissionId,
            scorecardId,
            committed: false,
            status: ReviewStatus.PENDING,
            createdBy: userId,
            updatedBy: userId,
          });
        }
      }
    }

    if (pendingReviewMap.size === 0) {
      return [];
    }

    const pendingReviewEntries = Array.from(pendingReviewMap.values());
    const existingReviews = await this.prisma.review.findMany({
      where: {
        submissionId,
        OR: pendingReviewEntries.map((entry) => ({
          resourceId: entry.resourceId,
          scorecardId: entry.scorecardId,
        })),
      },
      select: {
        resourceId: true,
        scorecardId: true,
      },
    });

    const existingKeys = new Set(
      existingReviews.map(
        (review) =>
          `${review.resourceId}:${submissionId}:${review.scorecardId}`,
      ),
    );

    return pendingReviewEntries.filter(
      (entry) =>
        !existingKeys.has(
          `${entry.resourceId}:${submissionId}:${entry.scorecardId}`,
        ),
    );
  }

  private async notifyCopilotsOfNewEscalation(
    challengeId: string,
    submissionId: string,
    escalation: AiReviewDecisionEscalationResponseDto,
    authUser: JwtUser,
    requesterId: string,
  ): Promise<void> {
    const copilotResources = await this.resourcePrisma.resource.findMany({
      where: {
        challengeId: challengeId,
        memberId: { not: requesterId },
        resourceRole: { nameLower: { contains: 'copilot' } },
      },
      select: { memberId: true },
    });

    const recipientIds = Array.from(
      new Set(copilotResources.map((resource) => String(resource.memberId))),
    );

    if (recipientIds.length === 0) {
      this.logger.warn(
        `No copilot recipients found for AI review escalation on challenge ${challengeId}`,
      );
      return;
    }

    const lookupIds = Array.from(new Set([...recipientIds, requesterId]));
    const memberInfos = await this.memberService.getUserEmails(lookupIds);
    const memberInfoById = new Map(
      memberInfos.map((info) => [String(info.userId), info]),
    );

    const recipients = Array.from(
      new Set(
        recipientIds
          .map((memberId) => memberInfoById.get(memberId)?.email)
          .filter((email): email is string => Boolean(email)),
      ),
    );

    if (recipients.length === 0) {
      this.logger.warn(
        `No copilot email addresses found for AI review escalation on challenge ${challengeId}`,
      );
      return;
    }

    const requesterEmail = memberInfoById.get(requesterId)?.email;
    const challenge =
      await this.challengeApiService.getChallengeDetail(challengeId);

    // Get the first copilot's handle for the email template
    const firstCopilotId = recipientIds[0];
    const copilotHandle = memberInfoById.get(firstCopilotId)?.handle || '';

    const payload = new EventBusSendEmailPayload();
    payload.sendgrid_template_id =
      CommonConfig.sendgridConfig.aiReviewEscalationsEmailTemplate;
    payload.recipients = recipients;
    payload.data = {
      subject: `Escalation Requested: Submission #${submissionId} - AI Review Appeal`,
      message: `
Hi, ${copilotHandle} !<br />
A reviewer has initiated an escalation for Submission #${submissionId} in <strong>${challenge.name}</strong>.
They are requesting a manual override or secondary look at the AI Review results.
      `,
      actionLabel: `View Submission & Escalation Details`,
      actionUrl: `${CommonConfig.ui.reviewUIUrl}/active-challenges/${challengeId}/challenge-details`,
    };

    if (requesterEmail) {
      payload.replyTo = requesterEmail;
    }

    await this.eventBusService.sendEmail(payload);
  }

  private async notifyReviewersOfSubmissionUnlocked(
    challengeId: string,
    submissionId: string,
    pendingReviews: PendingReviewRow[],
    payloadData: (
      challenge: ChallengeData,
      recipient: NotificationRecipient,
      review?: PendingReviewRow,
    ) => EventBusSendEmailPayload['data'],
  ) {
    const reviewerResources = await this.getReviewersForChallenge(challengeId);
    const resourceIdsByMemberId = new Map<string, string[]>();
    for (const resource of reviewerResources) {
      const memberId = String(resource.memberId);
      const resourceId = String(resource.id);
      const resourceIds = resourceIdsByMemberId.get(memberId) ?? [];
      resourceIds.push(resourceId);
      resourceIdsByMemberId.set(memberId, resourceIds);
    }

    const recipientIds = Array.from(
      new Set(reviewerResources.map((resource) => String(resource.memberId))),
    );

    if (recipientIds.length === 0) {
      this.logger.warn(
        `No reviewer recipients found for manual override on challenge ${challengeId}`,
      );
      return;
    }

    const lookupIds = Array.from(new Set([...recipientIds]));
    const memberInfos = await this.memberService.getUserEmails(lookupIds);
    const memberInfoById = new Map(
      memberInfos.map((info) => [String(info.userId), info]),
    );

    const recipients = Array.from(
      new Set(
        recipientIds
          .map((memberId) => memberInfoById.get(memberId))
          .filter((recipient): boolean => Boolean(recipient?.email)),
      ),
    ) as NotificationRecipient[];

    if (recipients.length === 0) {
      this.logger.warn(
        `No reviewer email addresses found for manual override on challenge ${challengeId}`,
      );
      return;
    }

    const challenge =
      await this.challengeApiService.getChallengeDetail(challengeId);

    await Promise.all(
      recipients.map(async (recipient) => {
        const recipientResourceIds =
          resourceIdsByMemberId.get(`${recipient.userId}`) ?? [];
        const review = pendingReviews.find((reviewEntry) =>
          recipientResourceIds.includes(reviewEntry.resourceId),
        );

        const payload = new EventBusSendEmailPayload();
        payload.sendgrid_template_id =
          CommonConfig.sendgridConfig.aiReviewEscalationsEmailTemplate;
        payload.recipients = [recipient.email];
        payload.data = payloadData(challenge, recipient, review);

        await this.eventBusService.sendEmail(payload);
      }),
    );
  }

  private async notifyReviewersOfEscalationApproved(
    challengeId: string,
    submissionId: string,
    pendingReviews: PendingReviewRow[],
  ): Promise<void> {
    const challenge =
      await this.challengeApiService.getChallengeDetail(challengeId);

    // Get review end date
    const isDesignTrack = challenge.track === 'Design';
    const reviewPhaseNames = isDesignTrack
      ? ['Review', 'Iterative Review', 'Checkpoint Screening']
      : ['Review', 'Iterative Review'];
    const reviewPhase = challenge.phases?.find((p) =>
      reviewPhaseNames.includes(p.name),
    );
    const reviewEndDate = reviewPhase
      ? new Date(reviewPhase.scheduledEndTime as string).toLocaleString()
      : 'TBD';

    await this.notifyReviewersOfSubmissionUnlocked(
      challengeId,
      submissionId,
      pendingReviews,
      (_, recipient, review) => {
        return {
          subject: `Escalation Approved: Submission #${submissionId} Ready for Review`,
          message: `
            Hi ${recipient.handle}!<br />
            <br />
            An escalation request for Submission #${submissionId} in <strong>${challenge.name}</strong> has been approved by the Copilot.<br />
            <br />
            <strong>Action Required:</strong><br />
            As the manual override is now active, please proceed with your full review of this submission.<br />
            <br />
            Deadline for Completion: ${reviewEndDate}<br />
        `,
          actionLabel: `Complete Manual Review Now`,
          actionUrl: `${CommonConfig.ui.reviewUIUrl}/active-challenges/${challengeId}/reviews/${submissionId}?reviewId=${review?.id}`,
        };
      },
    );
  }

  private async notifyReviewersOfManualOverride(
    challengeId: string,
    submissionId: string,
    pendingReviews: PendingReviewRow[],
  ): Promise<void> {
    await this.notifyReviewersOfSubmissionUnlocked(
      challengeId,
      submissionId,
      pendingReviews,
      (challenge, recipient, review) => {
        return {
          subject: `Manual Override: Submission #${submissionId} Ready for Review`,
          message: `
            Hi ${recipient.handle}!<br />
            <br />
            A manual override has been applied by a Copilot/Admin for Submission #${submissionId} in <strong>${challenge.name}</strong>.<br />
            <br />
            The AI Review results for this submission have been bypassed administratively. As a result, this submission is now open and requires your manual evaluation.<br />
            <br />
            <strong>Action Required:</strong><br />
            Please access the review App and complete the scorecard for this submission to ensure the project timeline remains on track.<br /><br />
        `,
          actionLabel: `Open Scorecard & Start Review`,
          actionUrl: `${CommonConfig.ui.reviewUIUrl}/active-challenges/${challengeId}/reviews/${submissionId}?reviewId=${review?.id}`,
        };
      },
    );
  }

  private async loadSavedPendingReviews(
    submissionId: string,
    pendingReviewInputs: Prisma.reviewCreateManyInput[],
  ): Promise<PendingReviewRow[]> {
    if (pendingReviewInputs.length === 0) {
      return [];
    }

    return this.prisma.review.findMany({
      where: {
        submissionId,
        OR: pendingReviewInputs.map((entry) => ({
          resourceId: entry.resourceId,
          scorecardId: entry.scorecardId,
        })),
      },
      select: {
        id: true,
        resourceId: true,
        submissionId: true,
        scorecardId: true,
      },
    });
  }

  async list(
    query: ListAiReviewEscalationQueryDto,
    authUser: JwtUser,
  ): Promise<AiReviewDecisionEscalationDecisionResponseDto[]> {
    if (
      !query.challengeId &&
      !query.submissionId &&
      !query.aiReviewDecisionId
    ) {
      throw new BadRequestException(
        'At least one of challengeId, submissionId, or aiReviewDecisionId is required.',
      );
    }

    const isAdminUser = authUser.isMachine || isAdmin(authUser);
    let resolvedChallengeId: string | null = query.challengeId ?? null;

    if (!isAdminUser) {
      if (!resolvedChallengeId && query.submissionId) {
        const submission = await this.prisma.submission.findUnique({
          where: { id: query.submissionId },
          select: { challengeId: true },
        });
        if (!submission) {
          throw new NotFoundException(
            `Submission with id ${query.submissionId} not found.`,
          );
        }
        resolvedChallengeId = submission.challengeId ?? null;
      }

      if (!resolvedChallengeId && query.aiReviewDecisionId) {
        const decision = await this.prisma.aiReviewDecision.findUnique({
          where: { id: query.aiReviewDecisionId },
          include: {
            config: { select: { challengeId: true } },
            submission: { select: { challengeId: true } },
          },
        });
        if (!decision) {
          throw new NotFoundException(
            `AI review decision with id ${query.aiReviewDecisionId} not found.`,
          );
        }
        resolvedChallengeId =
          decision.config?.challengeId ??
          decision.submission?.challengeId ??
          null;
      }

      if (!resolvedChallengeId) {
        throw new ForbiddenException(
          'Cannot determine challenge for this escalation query.',
        );
      }

      const userId = authUser.userId?.toString()?.trim();
      if (!userId) {
        throw new ForbiddenException('Cannot determine user identity.');
      }

      await this.validateCallerHasResourceForChallenge(
        resolvedChallengeId,
        userId,
      );
    }

    const where: Prisma.aiReviewDecisionWhereInput = {
      ...(query.aiReviewDecisionId ? { id: query.aiReviewDecisionId } : {}),
      ...(query.submissionId ? { submissionId: query.submissionId } : {}),
      ...(query.submissionLocked !== undefined
        ? { submissionLocked: query.submissionLocked }
        : {}),
      ...(query.challengeId
        ? {
            OR: [
              { config: { challengeId: query.challengeId } },
              { submission: { challengeId: query.challengeId } },
            ],
          }
        : {}),
    };

    const decisions = (await this.prisma.aiReviewDecision.findMany({
      where,
      include: {
        config: { select: { challengeId: true } },
        submission: { select: { id: true, challengeId: true } },
        escalations: {
          ...(query.status
            ? {
                where: {
                  status:
                    query.status as unknown as PrismaAiReviewDecisionEscalationStatus,
                },
              }
            : {}),
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    })) as AiReviewDecisionEscalationDecisionRecord[];

    return decisions
      .filter((decision) =>
        query.status ? decision.escalations.length > 0 : true,
      )
      .map((decision) => ({
        aiReviewDecisionId: decision.id,
        submissionId: decision.submissionId,
        challengeId:
          decision.config?.challengeId ??
          decision.submission?.challengeId ??
          null,
        decisionStatus: decision.status,
        submissionLocked: decision.submissionLocked,
        escalations: decision.escalations.map((escalation) =>
          mapEscalationToResponse(escalation),
        ),
      }));
  }

  private async validateCallerHasResourceForChallenge(
    challengeId: string,
    memberId: string,
  ): Promise<void> {
    const resource = await this.resourcePrisma.resource.findFirst({
      where: {
        challengeId,
        memberId,
        resourceRole: {
          OR: [
            { nameLower: { contains: 'copilot' } },
            { nameLower: { contains: 'reviewer' } },
            { nameLower: { contains: 'checkpoint reviewer' } },
            { nameLower: { contains: 'iterative reviewer' } },
            { nameLower: { contains: 'screener' } },
          ],
        },
      },
      select: { id: true },
    });
    if (!resource) {
      throw new ForbiddenException(
        'You must be assigned to this challenge as Copilot, a Reviewer (e.g. Reviewer, Iterative Reviewer, Checkpoint Reviewer), or a Screener (e.g. Screener, Checkpoint Screener) to request or perform an AI review override.',
      );
    }
  }

  private async isUserCopilotForChallenge(
    challengeId: string,
    memberId: string,
  ): Promise<boolean> {
    const resource = await this.resourcePrisma.resource.findFirst({
      where: {
        challengeId,
        memberId,
        resourceRole: { nameLower: { contains: 'copilot' } },
      },
      select: { id: true },
    });
    return !!resource;
  }

  private async isUserReviewerForChallenge(
    challengeId: string,
    memberId: string,
  ): Promise<boolean> {
    const resource = await this.resourcePrisma.resource.findFirst({
      where: {
        challengeId,
        memberId,
        resourceRole: {
          OR: [
            { nameLower: { contains: 'reviewer' } },
            { nameLower: { contains: 'iterative reviewer' } },
            { nameLower: { contains: 'checkpoint reviewer' } },
          ],
        },
      },
      select: { id: true },
    });
    return !!resource;
  }

  private async isUserScreenerForChallenge(
    challengeId: string,
    memberId: string,
  ): Promise<boolean> {
    const resource = await this.resourcePrisma.resource.findFirst({
      where: {
        challengeId,
        memberId,
        resourceRole: { nameLower: { contains: 'screener' } },
      },
      select: { id: true },
    });
    return !!resource;
  }

  private async getReviewersForChallenge(
    challengeId: string,
  ): Promise<{ id: string; memberId: string }[]> {
    return await this.resourcePrisma.resource.findMany({
      where: {
        challengeId,
        resourceRole: {
          OR: [
            { nameLower: { contains: 'reviewer' } },
            { nameLower: { contains: 'iterative reviewer' } },
            { nameLower: { contains: 'checkpoint reviewer' } },
          ],
        },
      },
      select: { id: true, memberId: true },
    });
  }

  private async ensureNoApprovedEscalationExists(
    aiReviewDecisionId: string,
  ): Promise<void> {
    const approvedEscalation =
      await this.prisma.aiReviewDecisionEscalation.findFirst({
        where: {
          aiReviewDecisionId,
          status: PrismaAiReviewDecisionEscalationStatus.APPROVED,
        },
        select: { id: true },
      });

    if (approvedEscalation) {
      throw new BadRequestException(
        'This AI review decision already has an approved escalation. No further escalation or unlock actions are allowed.',
      );
    }
  }

  private async createPendingEscalationForRole(
    aiReviewDecisionId: string,
    dto: CreateAiReviewEscalationDto,
    userId: string,
    challengeId: string,
    allowedPhases: string[],
    phaseErrorMessage: string,
    missingNotesErrorMessage: string,
  ): Promise<AiReviewDecisionEscalationResponseDto> {
    const phaseOpen = await this.challengeApiService.isPhaseOpen(
      challengeId,
      allowedPhases,
    );
    if (!phaseOpen) {
      throw new ForbiddenException(phaseErrorMessage);
    }

    const escalationNotes = (dto.escalationNotes ?? '').trim();
    if (!escalationNotes) {
      throw new BadRequestException(missingNotesErrorMessage);
    }

    const escalation = await this.prisma.aiReviewDecisionEscalation.create({
      data: {
        aiReviewDecisionId,
        escalationNotes,
        approverNotes: (dto.approverNotes ?? '').trim() || null,
        status: PrismaAiReviewDecisionEscalationStatus.PENDING_APPROVAL,
        createdBy: userId,
        updatedBy: userId,
      },
    });

    return mapEscalationToResponse(escalation);
  }

  private async createDirectUnlockEscalation(
    aiReviewDecisionId: string,
    dto: CreateAiReviewEscalationDto,
    challengeId: string,
    submissionId: string,
    userId: string,
  ): Promise<AiReviewDecisionEscalationResponseDto> {
    await this.validatePhaseOpen(challengeId);
    const approverNotes = (dto.approverNotes ?? '').trim();
    if (!approverNotes) {
      throw new BadRequestException(
        'approverNotes is required when creating an escalation as Admin or Copilot.',
      );
    }

    const pendingReviewInputs =
      await this.buildPendingReviewsForUnlockedSubmission(
        challengeId,
        submissionId,
        userId,
      );

    const escalation = await this.prisma.$transaction(
      async (tx): Promise<AiReviewDecisionEscalationRecord> => {
        const createdEscalation = await tx.aiReviewDecisionEscalation.create({
          data: {
            aiReviewDecisionId,
            escalationNotes: (dto.escalationNotes ?? '').trim() || null,
            approverNotes,
            status: PrismaAiReviewDecisionEscalationStatus.APPROVED,
            createdBy: userId,
            updatedBy: userId,
          },
        });

        await tx.aiReviewDecision.update({
          where: { id: aiReviewDecisionId },
          data: {
            status: AiReviewDecisionStatus.HUMAN_OVERRIDE,
            submissionLocked: false,
            updatedAt: new Date(),
          },
        });

        if (pendingReviewInputs.length > 0) {
          await tx.review.createMany({
            data: pendingReviewInputs,
            skipDuplicates: true,
          });
        }

        return createdEscalation as AiReviewDecisionEscalationRecord;
      },
    );

    const escalationResponse = mapEscalationToResponse(escalation);
    const savedPendingReviews = await this.loadSavedPendingReviews(
      submissionId,
      pendingReviewInputs,
    );

    try {
      await this.notifyReviewersOfManualOverride(
        challengeId,
        submissionId,
        savedPendingReviews,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to send manual override notification for decision ${aiReviewDecisionId}: ${message}`,
      );
    }

    return escalationResponse;
  }

  async create(
    aiReviewDecisionId: string,
    dto: CreateAiReviewEscalationDto,
    authUser: JwtUser,
  ): Promise<AiReviewDecisionEscalationResponseDto> {
    const decision = await this.prisma.aiReviewDecision.findUnique({
      where: { id: aiReviewDecisionId },
      include: {
        config: { select: { id: true, challengeId: true } },
        submission: { select: { id: true, challengeId: true } },
      },
    });

    if (!decision) {
      throw new NotFoundException(
        `AI review decision with id ${aiReviewDecisionId} not found.`,
      );
    }

    const challengeId =
      decision.config?.challengeId ?? decision.submission?.challengeId ?? null;
    if (!challengeId) {
      throw new BadRequestException(
        'Cannot determine challenge for this AI review decision.',
      );
    }

    if (decision.status === AiReviewDecisionStatus.PASSED) {
      throw new BadRequestException(
        'Override is not allowed for a passing AI review decision.',
      );
    }

    await this.ensureNoApprovedEscalationExists(aiReviewDecisionId);

    const userId = authUser.userId?.toString()?.trim() ?? null;
    if (!userId) {
      throw new ForbiddenException('Cannot determine user identity.');
    }

    let escalationResponse: AiReviewDecisionEscalationResponseDto;

    if (isAdmin(authUser)) {
      escalationResponse = await this.createDirectUnlockEscalation(
        aiReviewDecisionId,
        dto,
        challengeId,
        decision.submissionId,
        userId,
      );
    } else {
      await this.validateCallerHasResourceForChallenge(challengeId, userId);

      const isCopilot = await this.isUserCopilotForChallenge(
        challengeId,
        userId,
      );
      if (isCopilot) {
        escalationResponse = await this.createDirectUnlockEscalation(
          aiReviewDecisionId,
          dto,
          challengeId,
          decision.submissionId,
          userId,
        );
      } else {
        const isReviewer = await this.isUserReviewerForChallenge(
          challengeId,
          userId,
        );
        if (isReviewer) {
          const existingEscalationByReviewer =
            await this.prisma.aiReviewDecisionEscalation.findFirst({
              where: {
                createdBy: userId,
                aiReviewDecision: {
                  submissionId: decision.submissionId,
                },
              },
              select: { id: true },
            });

          if (existingEscalationByReviewer) {
            throw new BadRequestException(
              'Only one escalation request per reviewer is allowed for a submission.',
            );
          }

          const escalationNotes = (dto.escalationNotes ?? '').trim();
          if (!escalationNotes) {
            throw new BadRequestException(
              'escalationNotes is required when creating an escalation as a Reviewer (reason/evidence).',
            );
          }

          escalationResponse = await this.createPendingEscalationForRole(
            aiReviewDecisionId,
            dto,
            userId,
            challengeId,
            ['Review', 'Iterative Review'],
            'Override is only allowed when the challenge is in Review or Iterative Review phase.',
            'escalationNotes is required when creating an escalation as a Reviewer (reason/evidence).',
          );
        } else {
          const isScreener = await this.isUserScreenerForChallenge(
            challengeId,
            userId,
          );
          if (isScreener) {
            escalationResponse = await this.createPendingEscalationForRole(
              aiReviewDecisionId,
              dto,
              userId,
              challengeId,
              ['Screening', 'Checkpoint Screening'],
              'Override is only allowed when the challenge is in Screening or Checkpoint Screening phase.',
              'escalationNotes is required when creating an escalation as a Screener (reason/evidence).',
            );
          } else {
            throw new ForbiddenException(
              'Only Admin, or a Copilot, Reviewer, or Screener assigned to this challenge, can create an AI review escalation.',
            );
          }
        }
      }
    }

    if (
      escalationResponse.status ===
      AiReviewDecisionEscalationStatus.PENDING_APPROVAL
    ) {
      try {
        await this.notifyCopilotsOfNewEscalation(
          challengeId,
          decision.submissionId,
          escalationResponse,
          authUser,
          userId,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Failed to send AI review escalation notification for decision ${aiReviewDecisionId}: ${message}`,
        );
      }
    }

    return escalationResponse;
  }

  private async validatePhaseOpen(challengeId: string): Promise<void> {
    const challenge =
      await this.challengeApiService.getChallengeDetail(challengeId);
    const isDesignTrack = challenge.track === 'Design';
    const isPhaseOpen = await this.challengeApiService.isPhaseOpen(
      challengeId,
      isDesignTrack
        ? ['Screening', 'Checkpoint Screening', 'Review', 'Iterative Review']
        : ['Review', 'Iterative Review'],
    );
    if (!isPhaseOpen) {
      const message = isDesignTrack
        ? 'Override is only allowed when the challenge is in Screening, Checkpoint Screening, Review, or Iterative Review phase.'
        : 'Override is only allowed when the challenge is in Review or Iterative Review phase.';
      throw new ForbiddenException(message);
    }
  }

  async update(
    aiReviewDecisionId: string,
    escalationId: string,
    dto: UpdateAiReviewEscalationDto,
    authUser: JwtUser,
  ): Promise<AiReviewDecisionEscalationResponseDto> {
    const escalation = await this.prisma.aiReviewDecisionEscalation.findUnique({
      where: { id: escalationId },
      include: {
        aiReviewDecision: {
          select: {
            id: true,
            status: true,
            submissionLocked: true,
            config: { select: { challengeId: true } },
            submission: { select: { id: true, challengeId: true } },
          },
        },
      },
    });

    if (!escalation || escalation.aiReviewDecisionId !== aiReviewDecisionId) {
      throw new NotFoundException(
        `Escalation with id ${escalationId} not found for this decision.`,
      );
    }

    const decision = escalation.aiReviewDecision as {
      config?: { challengeId: string };
      submission?: { challengeId: string | null };
    };
    const challengeId =
      decision.config?.challengeId ?? decision.submission?.challengeId ?? null;

    if (!challengeId) {
      throw new BadRequestException(
        'Cannot determine challenge for this AI review decision.',
      );
    }

    const userId = authUser.userId?.toString()?.trim();

    if (!userId) {
      throw new ForbiddenException('Cannot determine user identity.');
    }

    const isAdminUser = isAdmin(authUser);
    const isCopilot = await this.isUserCopilotForChallenge(challengeId, userId);
    if (!isAdminUser && !isCopilot) {
      throw new ForbiddenException(
        'Only Admin or a Copilot assigned to this challenge can update an escalation.',
      );
    }

    await this.validatePhaseOpen(challengeId);

    if (
      escalation.status !==
      PrismaAiReviewDecisionEscalationStatus.PENDING_APPROVAL
    ) {
      throw new BadRequestException(
        'Only PENDING_APPROVAL escalations can be updated.',
      );
    }

    if (dto.status === AiReviewDecisionEscalationStatus.APPROVED) {
      const submissionId = escalation.aiReviewDecision.submission?.id || '';
      const pendingReviewInputs =
        await this.buildPendingReviewsForUnlockedSubmission(
          challengeId,
          submissionId,
          userId,
        );

      const updatedEscalation = await this.prisma.$transaction(
        async (tx): Promise<AiReviewDecisionEscalationRecord> => {
          const updated = await tx.aiReviewDecisionEscalation.update({
            where: { id: escalationId },
            data: {
              approverNotes: dto.approverNotes.trim(),
              status: PrismaAiReviewDecisionEscalationStatus.APPROVED,
              updatedBy: userId,
            },
          });

          await tx.aiReviewDecision.update({
            where: { id: aiReviewDecisionId },
            data: {
              status: AiReviewDecisionStatus.HUMAN_OVERRIDE,
              submissionLocked: false,
              updatedAt: new Date(),
            },
          });

          if (pendingReviewInputs.length > 0) {
            await tx.review.createMany({
              data: pendingReviewInputs,
              skipDuplicates: true,
            });
          }

          return updated as AiReviewDecisionEscalationRecord;
        },
      );
      const response = mapEscalationToResponse(updatedEscalation);
      const savedPendingReviews = await this.loadSavedPendingReviews(
        submissionId,
        pendingReviewInputs,
      );

      try {
        await this.notifyReviewersOfEscalationApproved(
          challengeId,
          submissionId,
          savedPendingReviews,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Failed to send escalation approval notification for escalation ${escalationId}: ${message}`,
        );
      }

      return response;
    }

    const updated = await this.prisma.aiReviewDecisionEscalation.update({
      where: { id: escalationId },
      data: {
        approverNotes: dto.approverNotes.trim(),
        status: PrismaAiReviewDecisionEscalationStatus.REJECTED,
        updatedBy: userId,
      },
    });
    return mapEscalationToResponse(updated);
  }
}
