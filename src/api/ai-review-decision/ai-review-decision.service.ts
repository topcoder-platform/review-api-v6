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
  PatchAiReviewDecisionDto,
} from '../../dto/aiReviewDecision.dto';
import {
  AiReviewDecisionEscalationResponseDto,
  AiReviewDecisionEscalationStatus,
} from '../../dto/aiReviewEscalation.dto';
import { Prisma } from '@prisma/client';
import { ChallengeApiService } from 'src/shared/modules/global/challenge.service';
import { ChallengeStatus } from 'src/shared/enums/challengeStatus.enum';
import { UserRole } from 'src/shared/enums/userRole.enum';

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

type AiReviewDecisionEscalationRecord = {
  id: string;
  aiReviewDecisionId: string;
  escalationNotes: string | null;
  approverNotes: string | null;
  status: string;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
};

type AiReviewDecisionRecord = {
  id: string;
  submissionId: string;
  configId: string;
  status: string;
  totalScore: Prisma.Decimal | number | string | null;
  submissionLocked: boolean;
  reason: string | null;
  breakdown: Prisma.JsonValue | null;
  isFinal: boolean;
  finalizedAt: Date | null;
  managerComment: string | null;
  createdAt: Date;
  updatedAt: Date;
  config?: { id: string; challengeId: string; version: number };
  submission?: {
    id: string;
    challengeId: string | null;
    memberId: string | null;
  };
  escalations?: AiReviewDecisionEscalationRecord[];
};

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
        `You must be assigned to this challenge to view its AI review decisions.`,
      );
    }
  }

  /**
   * Returns true if the member has Observer, Approver, or Manager resource role for the challenge (via resource DB).
   * Such members can view AI review decisions for any submission on the challenge, even when not completed or not their own.
   */
  private async hasExtendedViewAccessForChallenge(
    challengeId: string,
    memberId: string,
    allowedRoles: string[] = [
      'observer',
      'approver',
      'manager',
      'copilot',
      'checkpoint reviewer',
      'checkpoint screener',
      'iterative reviewer',
      'reviewer',
      'screener',
    ],
  ): Promise<boolean> {
    const resource = await this.resourcePrisma.resource.findFirst({
      where: {
        challengeId,
        memberId,
        resourceRole: {
          nameLower: { in: allowedRoles },
        },
      },
      select: { id: true },
    });
    return !!resource;
  }

  private mapEscalation(
    e: AiReviewDecisionEscalationRecord,
  ): AiReviewDecisionEscalationResponseDto {
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

  private mapToResponse(
    row: AiReviewDecisionRecord,
  ): AiReviewDecisionResponseDto {
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
      managerComment: row.managerComment ?? null,
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
    if (!isAllowed && !query.configId && !query.submissionId) {
      throw new BadRequestException(
        'For non-admin access, configId or submissionId is required to verify challenge access.',
      );
    }

    const memberId = authUser.userId?.toString()?.trim();

    if (!memberId) {
      throw new ForbiddenException('Cannot determine user identity.');
    }
    const where: Prisma.aiReviewDecisionWhereInput = {};
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
        const challenge =
          await this.challengeApiService.getChallengeDetail(challengeId);
        const isExtendedViewAccess =
          await this.hasExtendedViewAccessForChallenge(challengeId, memberId);
        if (
          challenge.status !== ChallengeStatus.COMPLETED &&
          !isExtendedViewAccess
        ) {
          where.submission = { memberId };
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
          const hasExtendedViewAccess =
            await this.hasExtendedViewAccessForChallenge(challengeId, memberId);
          const challenge =
            await this.challengeApiService.getChallengeDetail(challengeId);
          if (
            challenge.status !== ChallengeStatus.COMPLETED &&
            sub.memberId !== memberId &&
            !hasExtendedViewAccess
          ) {
            throw new ForbiddenException(
              `You are not allowed to view this submission's AI review decisions.`,
            );
          }

          if (
            challenge.status !== ChallengeStatus.COMPLETED &&
            !hasExtendedViewAccess
          ) {
            where.submission = { memberId };
          }
        }
      }

      if (!challengeId) {
        throw new ForbiddenException(
          'You must be assigned to this challenge to view its AI review decisions.',
        );
      }

      await this.validateCallerHasResourceForChallenge(challengeId, authUser);
    }

    if (query.submissionId) where.submissionId = query.submissionId;
    if (query.configId) where.configId = query.configId;
    if (query.status)
      where.status =
        query.status as unknown as Prisma.EnumAiReviewDecisionStatusFilter;

    const decisions = (await this.prisma.aiReviewDecision.findMany({
      where,
      include: DECISION_INCLUDE,
      orderBy: { createdAt: 'desc' },
    })) as AiReviewDecisionRecord[];

    return decisions.map((d) => this.mapToResponse(d));
  }

  private async validateChallengeAccess(
    challengeId: string,
    userId: string,
    submissionMemberId: string,
  ): Promise<void> {
    const hasExtendedViewAccess = await this.hasExtendedViewAccessForChallenge(
      challengeId,
      userId,
    );
    const challenge =
      await this.challengeApiService.getChallengeDetail(challengeId);
    if (
      challenge.status !== ChallengeStatus.COMPLETED &&
      !hasExtendedViewAccess &&
      submissionMemberId !== userId
    ) {
      throw new ForbiddenException(
        "You are not allowed to view this submission's AI review decisions.",
      );
    }
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

    const isAllowed = authUser.isMachine || isAdmin(authUser);
    if (!isAllowed && authUser.userId && decision.submission?.memberId) {
      await this.validateChallengeAccess(
        challengeId,
        authUser.userId.toString().trim(),
        decision.submission.memberId,
      );
    }

    return this.mapToResponse(decision);
  }

  async patch(
    id: string,
    dto: PatchAiReviewDecisionDto,
    authUser: JwtUser,
  ): Promise<AiReviewDecisionResponseDto> {
    // Only Admin or Copilot role may update AI review decisions
    const isPrivileged =
      authUser.isMachine ||
      isAdmin(authUser) ||
      authUser.roles?.includes(UserRole.Copilot);
    if (!isPrivileged) {
      throw new ForbiddenException(
        'Only Admins and Copilots may update AI review decisions.',
      );
    }

    const decision = await this.prisma.aiReviewDecision.findUnique({
      where: { id },
      include: DECISION_INCLUDE,
    });
    if (!decision) {
      throw new NotFoundException(
        `AI review decision with id ${id} not found.`,
      );
    }

    // Build update payload
    const updateData: Prisma.aiReviewDecisionUpdateInput = {};
    const runUpdates: Array<{ runId: string; managerScore: number }> = [];

    if (dto.managerComment !== undefined) {
      updateData.managerComment = dto.managerComment;
    }

    if (dto.workflowOverrides?.length) {
      // Merge manager overrides into breakdown JSON
      const currentBreakdown =
        (decision.breakdown as Record<string, unknown> | null) ?? {};
      const workflows = Array.isArray(
        (currentBreakdown as { workflows?: unknown }).workflows,
      )
        ? ([
            ...(currentBreakdown as { workflows: unknown[] }).workflows,
          ] as Array<Record<string, unknown>>)
        : [];

      const runUpdates: Array<{
        runId: string;
        managerScore: number;
      }> = [];

      for (const override of dto.workflowOverrides) {
        const idx = workflows.findIndex(
          (w) => w['workflowId'] === override.workflowId,
        );
        if (idx === -1) continue;
        if (override.managerScore !== undefined) {
          workflows[idx] = {
            ...workflows[idx],
            managerScore: override.managerScore,
          };

          let runId: string | null = null;
          if (typeof workflows[idx]['runId'] === 'string') {
            runId = workflows[idx]['runId'];
          }
          if (runId && override.managerScore !== null) {
            runUpdates.push({
              runId,
              managerScore: override.managerScore,
            });
          }
        }
        if (override.workflowComment !== undefined) {
          workflows[idx] = {
            ...workflows[idx],
            managerComment: override.workflowComment,
          };
        }
      }

      updateData.breakdown = {
        ...currentBreakdown,
        workflows: workflows as unknown as Prisma.InputJsonObject,
      };

      // Recalculate totalScore from workflows using managerScore ?? runScore
      const newTotal = workflows.reduce((sum, w) => {
        const score =
          w['managerScore'] != null
            ? Number(w['managerScore'])
            : w['runScore'] != null
              ? Number(w['runScore'])
              : 0;
        const weight =
          w['weightPercent'] != null ? Number(w['weightPercent']) : 0;
        return sum + (score * weight) / 100;
      }, 0);

      updateData.totalScore = new Prisma.Decimal(newTotal.toFixed(2));
      updateData.status = 'HUMAN_OVERRIDE';
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedDecision = await tx.aiReviewDecision.update({
        where: { id },
        data: updateData,
        include: DECISION_INCLUDE,
      });

      for (const runUpdate of runUpdates) {
        const existingRun = await tx.aiWorkflowRun.findUnique({
          where: { id: runUpdate.runId },
          select: { score: true, initialScore: true },
        });

        if (!existingRun) {
          continue;
        }

        const aiWorkflowRunUpdate: Prisma.aiWorkflowRunUpdateInput = {
          score: runUpdate.managerScore,
        };

        if (
          existingRun.initialScore === null &&
          existingRun.score !== null &&
          existingRun.score !== runUpdate.managerScore
        ) {
          aiWorkflowRunUpdate.initialScore = existingRun.score;
        }

        await tx.aiWorkflowRun.update({
          where: { id: runUpdate.runId },
          data: aiWorkflowRunUpdate,
        });
      }

      return updatedDecision;
    });

    return this.mapToResponse(updated as AiReviewDecisionRecord);
  }
}
