import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/modules/global/prisma.service';
import { LoggerService } from 'src/shared/modules/global/logger.service';
import { ResourcePrismaService } from 'src/shared/modules/global/resource-prisma.service';
import { JwtUser, isAdmin } from 'src/shared/modules/global/jwt.service';
import {
  ListAiReviewDecisionQueryDto,
  AiReviewDecisionResponseDto,
  AiReviewDecisionStatus,
} from '../../dto/aiReviewDecision.dto';
import {
  AiReviewDecisionEscalationResponseDto,
  AiReviewDecisionEscalationStatus,
} from '../../dto/aiReviewEscalation.dto';
import { Prisma } from '@prisma/client';
import { ChallengeApiService } from 'src/shared/modules/global/challenge.service';
import { ChallengeStatus } from 'src/shared/enums/challengeStatus.enum';

const DECISION_INCLUDE = {
  config: {
    select: { id: true, challengeId: true, version: true },
  },
  submission: {
    select: { id: true, challengeId: true, memberId: true },
  },
  escalations: {
    orderBy: { createdAt: 'desc' as const },
  },
} as const;

@Injectable()
export class AiReviewDecisionService {
  private readonly logger: LoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly resourcePrisma: ResourcePrismaService,
    private readonly challengeApiService: ChallengeApiService,
  ) {
    this.logger = LoggerService.forRoot('AiReviewDecisionService');
  }

  private async validateCallerHasResourceForChallenge(
    challengeId: string,
    authUser: JwtUser,
  ): Promise<void> {
    if (authUser.isMachine || isAdmin(authUser)) {
      return;
    }
    const memberId = authUser.userId?.toString()?.trim();
    if (!memberId) {
      throw new ForbiddenException('Cannot determine user identity.');
    }
    const resource = await this.resourcePrisma.resource.findFirst({
      where: { challengeId, memberId },
      select: { id: true },
    });
    if (!resource) {
      throw new ForbiddenException(
        'You must be assigned to this challenge to view its AI review decisions.',
      );
    }
  }

  /**
   * Returns true if the member has Observer, Approver, or Manager resource role for the challenge (via resource DB).
   * Such members can view AI review decisions for any submission on the challenge, even when not completed or not their own.
   */
  private async hasObserverApproverOrManagerForChallenge(
    challengeId: string,
    memberId: string,
  ): Promise<boolean> {
    const resource = await this.resourcePrisma.resource.findFirst({
      where: {
        challengeId,
        memberId,
        resourceRole: {
          nameLower: { in: ['observer', 'approver', 'manager'] },
        },
      },
      select: { id: true },
    });
    return !!resource;
  }

  private mapEscalation(e: {
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
      id: e.id,
      aiReviewDecisionId: e.aiReviewDecisionId,
      escalationNotes: e.escalationNotes,
      approverNotes: e.approverNotes,
      status: e.status as AiReviewDecisionEscalationStatus,
      createdAt: e.createdAt,
      createdBy: e.createdBy,
      updatedAt: e.updatedAt,
      updatedBy: e.updatedBy,
    };
  }

  private mapToResponse(row: {
    id: string;
    submissionId: string;
    configId: string;
    status: string;
    totalScore: unknown;
    submissionLocked: boolean;
    reason: string | null;
    breakdown: unknown;
    isFinal: boolean;
    finalizedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    config?: { id: string; challengeId: string; version: number };
    submission?: {
      id: string;
      challengeId: string | null;
      memberId: string | null;
    };
    escalations?: Array<{
      id: string;
      aiReviewDecisionId: string;
      escalationNotes: string | null;
      approverNotes: string | null;
      status: string;
      createdAt: Date;
      createdBy: string | null;
      updatedAt: Date;
      updatedBy: string | null;
    }>;
  }): AiReviewDecisionResponseDto {
    return {
      id: row.id,
      submissionId: row.submissionId,
      configId: row.configId,
      status: row.status as AiReviewDecisionStatus,
      totalScore: row.totalScore != null ? Number(row.totalScore) : null,
      submissionLocked: row.submissionLocked,
      reason: row.reason,
      breakdown: row.breakdown as Record<string, unknown> | null,
      isFinal: row.isFinal,
      finalizedAt: row.finalizedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      config: row.config as Record<string, unknown>,
      submission: row.submission as Record<string, unknown>,
      escalations: row.escalations?.map((e) => this.mapEscalation(e)) ?? [],
    };
  }

  async list(
    query: ListAiReviewDecisionQueryDto,
    authUser: JwtUser,
  ): Promise<AiReviewDecisionResponseDto[]> {
    const isAllowed = authUser.isMachine || isAdmin(authUser);
    let hasExtendedViewAccess = false;
    if (!isAllowed && !query.configId && !query.submissionId) {
      throw new BadRequestException(
        'For non-admin access, configId or submissionId is required to verify challenge access.',
      );
    }

    if (!isAllowed) {
      let challengeId: string | null = null;
      if (query.configId) {
        const config = await this.prisma.aiReviewConfig.findUnique({
          where: { id: query.configId },
          select: { challengeId: true },
        });
        if (!config) {
          throw new NotFoundException(
            `AI review config with id ${query.configId} not found.`,
          );
        }
        challengeId = config.challengeId;

        if (challengeId) {
          const memberId = authUser.userId?.toString()?.trim();
          if (memberId) {
            hasExtendedViewAccess =
              await this.hasObserverApproverOrManagerForChallenge(
                challengeId,
                memberId,
              );
          }

          const challenge =
            await this.challengeApiService.getChallengeDetail(challengeId);
          if (
            challenge.status !== ChallengeStatus.COMPLETED &&
            !hasExtendedViewAccess
          ) {
            throw new ForbiddenException(
              `You are not allowed to view this submission's AI review decisions.`,
            );
          }
        }
      } else if (query.submissionId) {
        const sub = await this.prisma.submission.findUnique({
          where: { id: query.submissionId },
          select: { challengeId: true, memberId: true },
        });
        if (!sub) {
          throw new NotFoundException(
            `Submission with id ${query.submissionId} not found.`,
          );
        }
        challengeId = sub.challengeId ?? null;

        if (challengeId) {
          const memberId = authUser.userId?.toString()?.trim();
          if (memberId) {
            hasExtendedViewAccess =
              await this.hasObserverApproverOrManagerForChallenge(
                challengeId,
                memberId,
              );
          }

          const challenge =
            await this.challengeApiService.getChallengeDetail(challengeId);
          if (
            challenge.status !== ChallengeStatus.COMPLETED &&
            sub.memberId !== authUser.userId?.toString() &&
            !hasExtendedViewAccess
          ) {
            throw new ForbiddenException(
              `You are not allowed to view this submission's AI review decisions.`,
            );
          }
        }
      }

      if (challengeId && !query.submissionId) {
        const memberId = authUser.userId?.toString()?.trim();
        if (memberId) {
          hasExtendedViewAccess =
            await this.hasObserverApproverOrManagerForChallenge(
              challengeId,
              memberId,
            );
        }
      }

      if (!challengeId) {
        throw new ForbiddenException(
          'You must be assigned to this challenge to view its AI review decisions.',
        );
      }
      // TODO: need to actually check use has one of: review, copilot, pm, tm
      await this.validateCallerHasResourceForChallenge(challengeId, authUser);
    }

    const where: Prisma.aiReviewDecisionWhereInput = {};
    if (query.submissionId) where.submissionId = query.submissionId;
    if (query.configId) where.configId = query.configId;
    if (query.status)
      where.status =
        query.status as unknown as Prisma.EnumAiReviewDecisionStatusFilter;

    if (!isAllowed) {
      const memberId = authUser.userId?.toString()?.trim();
      if (memberId && !hasExtendedViewAccess) {
        where.submission = { memberId };
      }
    }

    const decisions = await this.prisma.aiReviewDecision.findMany({
      where,
      include: DECISION_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });

    return decisions.map((d) => this.mapToResponse(d));
  }

  async getById(
    id: string,
    authUser: JwtUser,
  ): Promise<AiReviewDecisionResponseDto> {
    const decision = await this.prisma.aiReviewDecision.findUnique({
      where: { id },
      include: DECISION_INCLUDE,
    });
    if (!decision) {
      this.logger.error(`AI review decision with id ${id} not found.`);
      throw new NotFoundException(
        `AI review decision with id ${id} not found.`,
      );
    }

    const challengeId =
      decision.config?.challengeId ?? decision.submission?.challengeId ?? null;
    if (challengeId) {
      await this.validateCallerHasResourceForChallenge(challengeId, authUser);
    }

    return this.mapToResponse(decision);
  }
}
