import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/modules/global/prisma.service';
import { LoggerService } from 'src/shared/modules/global/logger.service';
import { ResourcePrismaService } from 'src/shared/modules/global/resource-prisma.service';
import { ChallengeApiService } from 'src/shared/modules/global/challenge.service';
import { JwtUser, isAdmin } from 'src/shared/modules/global/jwt.service';
import {
  CreateAiReviewEscalationDto,
  UpdateAiReviewEscalationDto,
  AiReviewDecisionEscalationResponseDto,
  AiReviewDecisionEscalationStatus,
} from '../../dto/aiReviewEscalation.dto';
import { AiReviewDecisionStatus } from '@prisma/client';

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
    status: row.status as AiReviewDecisionEscalationStatus,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

@Injectable()
export class AiReviewEscalationService {
  private readonly logger: LoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly resourcePrisma: ResourcePrismaService,
    private readonly challengeApiService: ChallengeApiService,
  ) {
    this.logger = LoggerService.forRoot('AiReviewEscalationService');
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
          ],
        },
      },
      select: { id: true },
    });
    if (!resource) {
      throw new ForbiddenException(
        'You must be assigned to this challenge as Copilot or a Reviewer (e.g. Reviewer, Iterative Reviewer, Checkpoint Reviewer, Screener) to request or perform an AI review override.',
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

    const reviewPhaseOpen = await this.challengeApiService.isPhaseOpen(
      challengeId,
      ['Review', 'Iterative Review'],
    );
    if (!reviewPhaseOpen) {
      throw new ForbiddenException(
        'Override is only allowed when the challenge is in Review or Iterative Review phase.',
      );
    }

    if (decision.status === AiReviewDecisionStatus.PASSED) {
      throw new BadRequestException(
        'Override is not allowed for a passing AI review decision.',
      );
    }

    const userId = authUser.userId?.toString()?.trim() ?? null;
    if (!userId) {
      throw new ForbiddenException('Cannot determine user identity.');
    }

    if (isAdmin(authUser)) {
      const approverNotes = (dto.approverNotes ?? '').trim();
      if (!approverNotes) {
        throw new BadRequestException(
          'approverNotes is required when creating an escalation as Admin or Copilot.',
        );
      }

      const [escalation] = await this.prisma.$transaction([
        this.prisma.aiReviewDecisionEscalation.create({
          data: {
            aiReviewDecisionId,
            escalationNotes: (dto.escalationNotes ?? '').trim() || null,
            approverNotes,
            status: AiReviewDecisionEscalationStatus.APPROVED,
            createdBy: userId,
            updatedBy: userId,
          },
        }),
        this.prisma.aiReviewDecision.update({
          where: { id: aiReviewDecisionId },
          data: {
            status: AiReviewDecisionStatus.HUMAN_OVERRIDE,
            submissionLocked: false,
            updatedAt: new Date(),
          },
        }),
      ]);

      return mapEscalationToResponse(escalation);
    }

    await this.validateCallerHasResourceForChallenge(challengeId, userId);

    const isCopilot = await this.isUserCopilotForChallenge(challengeId, userId);
    if (isCopilot) {
      const approverNotes = (dto.approverNotes ?? '').trim();
      if (!approverNotes) {
        throw new BadRequestException(
          'approverNotes is required when creating an escalation as Copilot.',
        );
      }

      const [escalation] = await this.prisma.$transaction([
        this.prisma.aiReviewDecisionEscalation.create({
          data: {
            aiReviewDecisionId,
            escalationNotes: (dto.escalationNotes ?? '').trim() || null,
            approverNotes,
            status: AiReviewDecisionEscalationStatus.APPROVED,
            createdBy: userId,
            updatedBy: userId,
          },
        }),
        this.prisma.aiReviewDecision.update({
          where: { id: aiReviewDecisionId },
          data: {
            status: AiReviewDecisionStatus.HUMAN_OVERRIDE,
            submissionLocked: false,
            updatedAt: new Date(),
          },
        }),
      ]);

      return mapEscalationToResponse(escalation);
    }

    const isReviewer = await this.isUserReviewerForChallenge(challengeId, userId);
    if (isReviewer) {
      const escalationNotes = (dto.escalationNotes ?? '').trim();
      if (!escalationNotes) {
        throw new BadRequestException(
          'escalationNotes is required when creating an escalation as a Reviewer (reason/evidence).',
        );
      }

      const escalation = await this.prisma.aiReviewDecisionEscalation.create({
        data: {
          aiReviewDecisionId,
          escalationNotes,
          approverNotes: (dto.approverNotes ?? '').trim() || null,
          status: AiReviewDecisionEscalationStatus.PENDING_APPROVAL,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      return mapEscalationToResponse(escalation);
    }

    throw new ForbiddenException(
      'Only Admin, or a Copilot/Reviewer assigned to this challenge, can create an AI review escalation.',
    );
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
            submission: { select: { challengeId: true } },
          },
        },
      },
    });

    if (!escalation || escalation.aiReviewDecisionId !== aiReviewDecisionId) {
      throw new NotFoundException(
        `Escalation with id ${escalationId} not found for this decision.`,
      );
    }

    if (escalation.status !== AiReviewDecisionEscalationStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        'Only PENDING_APPROVAL escalations can be updated.',
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

    if (dto.status === AiReviewDecisionEscalationStatus.APPROVED) {
      const updated = await this.prisma.$transaction([
        this.prisma.aiReviewDecisionEscalation.update({
          where: { id: escalationId },
          data: {
            approverNotes: dto.approverNotes.trim(),
            status: AiReviewDecisionEscalationStatus.APPROVED,
            updatedBy: userId,
          },
        }),
        this.prisma.aiReviewDecision.update({
          where: { id: aiReviewDecisionId },
          data: {
            status: AiReviewDecisionStatus.HUMAN_OVERRIDE,
            submissionLocked: false,
            updatedAt: new Date(),
          },
        }),
      ]);
      return mapEscalationToResponse(updated[0]);
    }

    const updated = await this.prisma.aiReviewDecisionEscalation.update({
      where: { id: escalationId },
      data: {
        approverNotes: dto.approverNotes.trim(),
        status: AiReviewDecisionEscalationStatus.REJECTED,
        updatedBy: userId,
      },
    });
    return mapEscalationToResponse(updated);
  }
}
