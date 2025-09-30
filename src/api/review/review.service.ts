import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ForbiddenException,
  HttpException,
} from '@nestjs/common';
import {
  ReviewItemRequestDto,
  ReviewItemResponseDto,
  ReviewPatchRequestDto,
  ReviewProgressResponseDto,
  ReviewPutRequestDto,
  ReviewRequestDto,
  ReviewResponseDto,
  ReviewStatus,
  mapReviewItemRequestForUpdate,
  mapReviewItemRequestToDto,
  mapReviewRequestToDto,
} from 'src/dto/review.dto';
import { Prisma } from '@prisma/client';
import { PaginatedResponse, PaginationDto } from 'src/dto/pagination.dto';
import { PrismaService } from 'src/shared/modules/global/prisma.service';
import { PrismaErrorService } from 'src/shared/modules/global/prisma-error.service';
import { ResourceApiService } from 'src/shared/modules/global/resource.service';
import { ResourcePrismaService } from 'src/shared/modules/global/resource-prisma.service';
import { ChallengeApiService } from 'src/shared/modules/global/challenge.service';
import { MemberPrismaService } from 'src/shared/modules/global/member-prisma.service';
import { LoggerService } from 'src/shared/modules/global/logger.service';
import { JwtUser, isAdmin } from 'src/shared/modules/global/jwt.service';
import { EventBusService } from 'src/shared/modules/global/eventBus.service';
import { CommonConfig } from 'src/shared/config/common.config';
import { ChallengeStatus } from 'src/shared/enums/challengeStatus.enum';
import { UserRole } from 'src/shared/enums/userRole.enum';
import { ResourceInfo } from 'src/shared/models/ResourceInfo.model';

const REVIEW_ITEM_COMMENTS_INCLUDE = {
  reviewItemComments: {
    include: {
      appeal: {
        include: {
          appealResponse: true,
        },
      },
    },
  },
} as const;

type ReviewItemAccessMode = 'machine' | 'admin' | 'reviewer-owner' | 'copilot';

interface ReviewItemAccessResult {
  mode: ReviewItemAccessMode;
  hasReviewerRole: boolean;
  hasCopilotRole: boolean;
  ownsReview: boolean;
}

@Injectable()
export class ReviewService {
  private readonly logger: LoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaErrorService: PrismaErrorService,
    private readonly resourceApiService: ResourceApiService,
    private readonly resourcePrisma: ResourcePrismaService,
    private readonly memberPrisma: MemberPrismaService,
    private readonly challengeApiService: ChallengeApiService,
    private readonly eventBusService: EventBusService,
  ) {
    this.logger = LoggerService.forRoot('ReviewService');
  }

  /**
   * Compute initial and final scores for a review, based on its scorecard and answers.
   * - YES_NO: YES -> 100, NO -> 0
   * - SCALE/TEST_CASE: linear map from [scaleMin, scaleMax] to [0, 100]
   * Aggregation: question-weight within section, section-weight within group, group-weight across groups.
   */
  private async computeScoresFromItems(
    scorecardId: string,
    items: Array<{
      scorecardQuestionId: string;
      initialAnswer?: string | null;
      finalAnswer?: string | null;
    }>,
  ): Promise<{ initialScore: number | null; finalScore: number | null }> {
    try {
      const scorecard = await this.prisma.scorecard.findUnique({
        where: { id: scorecardId },
        include: {
          scorecardGroups: {
            include: {
              sections: {
                include: {
                  questions: true,
                },
              },
            },
          },
        },
      });

      if (!scorecard) {
        this.logger.warn(
          `[computeScoresFromItems] Scorecard ${scorecardId} not found. Returning null scores.`,
        );
        return { initialScore: null, finalScore: null };
      }

      // Build a quick lookup for answers by questionId
      const answersByQuestion = new Map(
        items.map((i) => [i.scorecardQuestionId, i]),
      );

      // Normalize weights to avoid issues if they don't sum to exactly 100
      const totalGroupWeight = scorecard.scorecardGroups.reduce(
        (sum, g) => sum + (g.weight || 0),
        0,
      );

      const computeQuestionScore = (
        type: string,
        scaleMin: number | null | undefined,
        scaleMax: number | null | undefined,
        answer: string | null | undefined,
      ): number => {
        if (answer === undefined || answer === null) return 0;
        const t = String(type).toUpperCase();
        if (t === 'YES_NO') {
          return String(answer).toUpperCase() === 'YES' ? 100 : 0;
        }
        if (t === 'SCALE' || t === 'TEST_CASE') {
          const min = typeof scaleMin === 'number' ? scaleMin : 0;
          const max = typeof scaleMax === 'number' ? scaleMax : 0;
          const val = Number(answer);
          if (!isFinite(val)) return 0;
          if (max === min) return 0;
          const norm = ((val - min) / (max - min)) * 100;
          return Math.min(100, Math.max(0, norm));
        }
        // Default for unknown types
        return 0;
      };

      let initialTotal = 0;
      let finalTotal = 0;

      for (const group of scorecard.scorecardGroups) {
        const groupWeightNorm = totalGroupWeight
          ? (group.weight || 0) / totalGroupWeight
          : 1 / Math.max(1, scorecard.scorecardGroups.length);

        const totalSectionWeight = group.sections.reduce(
          (s, sec) => s + (sec.weight || 0),
          0,
        );

        let groupInitial = 0;
        let groupFinal = 0;

        for (const section of group.sections) {
          const sectionWeightNorm = totalSectionWeight
            ? (section.weight || 0) / totalSectionWeight
            : 1 / Math.max(1, group.sections.length);

          const totalQuestionWeight = section.questions.reduce(
            (s, q) => s + (q.weight || 0),
            0,
          );

          let sectionInitial = 0;
          let sectionFinal = 0;

          for (const q of section.questions) {
            const questionWeightNorm = totalQuestionWeight
              ? (q.weight || 0) / totalQuestionWeight
              : 1 / Math.max(1, section.questions.length);

            const ans = answersByQuestion.get(q.id);
            const qi = computeQuestionScore(
              q.type,
              q.scaleMin ?? null,
              q.scaleMax ?? null,
              ans?.initialAnswer ?? null,
            );
            const qf = computeQuestionScore(
              q.type,
              q.scaleMin ?? null,
              q.scaleMax ?? null,
              ans?.finalAnswer ?? ans?.initialAnswer ?? null,
            );

            sectionInitial += qi * questionWeightNorm;
            sectionFinal += qf * questionWeightNorm;
          }

          groupInitial += sectionInitial * sectionWeightNorm;
          groupFinal += sectionFinal * sectionWeightNorm;
        }

        initialTotal += groupInitial * groupWeightNorm;
        finalTotal += groupFinal * groupWeightNorm;
      }

      // Round to 2 decimals for readability
      const round2 = (n: number) => Math.round(n * 100) / 100;
      return {
        initialScore: round2(initialTotal),
        finalScore: round2(finalTotal),
      };
    } catch (e) {
      this.logger.error(
        '[computeScoresFromItems] Failed to compute scores. Returning nulls.',
        e,
      );
      return { initialScore: null, finalScore: null };
    }
  }

  private async recomputeAndUpdateReviewScores(reviewId: string): Promise<{
    initialScore: number | null;
    finalScore: number | null;
  } | null> {
    try {
      const review = await this.prisma.review.findUnique({
        where: { id: reviewId },
        select: {
          id: true,
          scorecardId: true,
          initialScore: true,
          finalScore: true,
        },
      });
      if (!review?.scorecardId) {
        return {
          initialScore: review?.initialScore ?? null,
          finalScore: review?.finalScore ?? null,
        };
      }

      const items = await this.prisma.reviewItem.findMany({
        where: { reviewId },
        select: {
          scorecardQuestionId: true,
          initialAnswer: true,
          finalAnswer: true,
        },
      });

      const scores = await this.computeScoresFromItems(
        review.scorecardId,
        items,
      );
      const needsUpdate =
        scores.initialScore !== review.initialScore ||
        scores.finalScore !== review.finalScore;

      if (needsUpdate) {
        await this.prisma.review.update({
          where: { id: reviewId },
          data: {
            initialScore: scores.initialScore,
            finalScore: scores.finalScore,
          },
        });
        this.logger.debug(
          `[recomputeAndUpdateReviewScores] Updated scores for review ${reviewId}: ${JSON.stringify(scores)}`,
        );
      } else {
        this.logger.debug(
          `[recomputeAndUpdateReviewScores] Scores unchanged for review ${reviewId}.`,
        );
      }

      return scores;
    } catch (e) {
      this.logger.error(
        `[recomputeAndUpdateReviewScores] Failed for review ${reviewId}`,
        e,
      );
      return null;
    }
  }

  private shouldRecordManagerAudit(
    authUser: JwtUser | undefined,
    hasCopilotRole: boolean,
  ): boolean {
    if (!authUser) {
      return false;
    }

    if (authUser.isMachine) {
      return true;
    }

    if (isAdmin(authUser)) {
      return true;
    }

    return hasCopilotRole;
  }

  private getAuditActorId(authUser: JwtUser | undefined): string {
    if (!authUser) {
      return 'unknown';
    }

    const candidateId = authUser.userId ?? authUser.handle;

    if (candidateId && String(candidateId).trim().length > 0) {
      return String(candidateId).trim();
    }

    if (authUser.isMachine) {
      return 'System';
    }

    return 'unknown';
  }

  private areAuditValuesEqual(a: unknown, b: unknown): boolean {
    if (a === b) {
      return true;
    }

    if (a instanceof Date && b instanceof Date) {
      return a.toISOString() === b.toISOString();
    }

    if (
      (typeof a === 'object' && a !== null) ||
      (typeof b === 'object' && b !== null)
    ) {
      try {
        return JSON.stringify(a) === JSON.stringify(b);
      } catch {
        return false;
      }
    }

    return false;
  }

  private formatAuditValue(value: unknown): string {
    if (value === null) {
      return 'null';
    }
    if (value === undefined) {
      return 'undefined';
    }
    if (value instanceof Date) {
      return value.toISOString();
    }

    const valueType = typeof value;

    switch (valueType) {
      case 'string':
        return value as string;
      case 'number':
        return (value as number).toString();
      case 'boolean':
        return (value as boolean).toString();
      case 'bigint':
        return (value as bigint).toString();
      case 'symbol': {
        const symbolValue = value as symbol;
        return symbolValue.description !== undefined
          ? `Symbol(${symbolValue.description})`
          : symbolValue.toString();
      }
      case 'function': {
        const fn = value as (...args: unknown[]) => unknown;
        return `[Function ${fn.name || 'anonymous'}]`;
      }
      case 'object':
        try {
          return JSON.stringify(value);
        } catch {
          const constructorName =
            (value as { constructor?: { name?: string } })?.constructor?.name ??
            'Object';
          return `[Unserializable ${constructorName}]`;
        }
      default:
        return '[Unknown]';
    }
  }

  private describeAuditChange(
    field: string,
    previous: unknown,
    next: unknown,
  ): string | null {
    if (this.areAuditValuesEqual(previous, next)) {
      return null;
    }
    return `${field}: ${this.formatAuditValue(previous)} -> ${this.formatAuditValue(next)}`;
  }

  private collectReviewItemAuditChanges(
    beforeItems: Array<{
      scorecardQuestionId: string;
      initialAnswer: string;
      finalAnswer: string | null;
      managerComment: string | null;
    }> = [],
    afterItems: Array<{
      scorecardQuestionId: string;
      initialAnswer: string;
      finalAnswer: string | null;
      managerComment: string | null;
    }> = [],
  ): string[] {
    const diffs: string[] = [];
    const beforeMap = new Map(
      beforeItems.map((item) => [item.scorecardQuestionId, item]),
    );
    const afterMap = new Map(
      afterItems.map((item) => [item.scorecardQuestionId, item]),
    );
    const questionIds = new Set([...beforeMap.keys(), ...afterMap.keys()]);

    const trackedFields: Array<
      'initialAnswer' | 'finalAnswer' | 'managerComment'
    > = ['initialAnswer', 'finalAnswer', 'managerComment'];

    questionIds.forEach((questionId) => {
      const before = beforeMap.get(questionId);
      const after = afterMap.get(questionId);

      trackedFields.forEach((field) => {
        const previous = before ? before[field] : undefined;
        const next = after ? after[field] : undefined;
        const change = this.describeAuditChange(
          `reviewItem[scorecardQuestionId=${questionId}].${field}`,
          previous,
          next,
        );
        if (change) {
          diffs.push(change);
        }
      });
    });

    return diffs;
  }

  private collectReviewAuditChanges(
    before: {
      status?: string | null;
      committed?: boolean | null;
      finalScore?: number | null;
      initialScore?: number | null;
      reviewDate?: Date | string | null;
      metadata?: unknown;
      typeId?: string | null;
      scorecardId?: string | null;
      reviewItems?: Array<{
        scorecardQuestionId: string;
        initialAnswer: string;
        finalAnswer: string | null;
        managerComment: string | null;
      }>;
    },
    after: {
      status?: string | null;
      committed?: boolean | null;
      finalScore?: number | null;
      initialScore?: number | null;
      reviewDate?: Date | string | null;
      metadata?: unknown;
      typeId?: string | null;
      scorecardId?: string | null;
      reviewItems?: Array<{
        scorecardQuestionId: string;
        initialAnswer: string;
        finalAnswer: string | null;
        managerComment: string | null;
      }>;
    },
  ): string[] {
    const trackedFields: Array<
      | 'status'
      | 'committed'
      | 'finalScore'
      | 'initialScore'
      | 'reviewDate'
      | 'metadata'
      | 'typeId'
      | 'scorecardId'
    > = [
      'status',
      'committed',
      'finalScore',
      'initialScore',
      'reviewDate',
      'metadata',
      'typeId',
      'scorecardId',
    ];

    const diffs: string[] = [];

    trackedFields.forEach((field) => {
      const change = this.describeAuditChange(
        field,
        before[field],
        after[field],
      );
      if (change) {
        diffs.push(change);
      }
    });

    const itemDiffs = this.collectReviewItemAuditChanges(
      before.reviewItems ?? [],
      after.reviewItems ?? [],
    );
    diffs.push(...itemDiffs);

    return diffs;
  }

  private async recordReviewAuditEntry(params: {
    actorId: string;
    reviewId: string;
    submissionId?: string | null;
    challengeId?: string | null;
    descriptions: string[];
  }): Promise<void> {
    const { actorId, reviewId, submissionId, challengeId, descriptions } =
      params;

    if (!descriptions.length || !actorId || !reviewId) {
      return;
    }

    try {
      await this.prisma.reviewAudit.create({
        data: {
          actorId,
          reviewId,
          submissionId: submissionId ?? undefined,
          challengeId: challengeId ?? undefined,
          description: descriptions.join('; '),
        },
      });
    } catch (error) {
      this.logger.error(
        `[recordReviewAuditEntry] Failed to persist audit entry for review ${reviewId}`,
        error,
      );
    }
  }

  private async publishReviewCompletedEvent(reviewId: string): Promise<void> {
    try {
      const review = await this.prisma.review.findUnique({
        where: { id: reviewId },
        select: {
          id: true,
          submissionId: true,
          scorecardId: true,
          resourceId: true,
          phaseId: true,
          status: true,
          reviewDate: true,
          initialScore: true,
          updatedAt: true,
          submission: {
            select: {
              challengeId: true,
              memberId: true,
            },
          },
        },
      });

      if (!review) {
        this.logger.warn(
          `[publishReviewCompletedEvent] Review ${reviewId} not found while preparing completion event.`,
        );
        return;
      }

      if (review.status !== ReviewStatus.COMPLETED) {
        this.logger.debug(
          `[publishReviewCompletedEvent] Review ${reviewId} status is ${review.status}; skipping completion event.`,
        );
        return;
      }

      const challengeId = review.submission?.challengeId ?? null;
      const submissionId = review.submissionId ?? null;
      let reviewerMemberId: string | null = null;
      let reviewerHandle: string | null = null;
      const submitterMemberId = review.submission?.memberId ?? null;
      let submitterHandle: string | null = null;

      if (challengeId) {
        try {
          const resources = await this.resourceApiService.getResources({
            challengeId,
          });
          const reviewerResource = resources?.find(
            (resource) => resource.id === review.resourceId,
          );
          if (reviewerResource) {
            reviewerMemberId = reviewerResource.memberId ?? null;
            reviewerHandle = reviewerResource.memberHandle ?? null;
          }

          if (submitterMemberId) {
            const submitterResource =
              resources?.find(
                (resource) =>
                  resource.memberId === submitterMemberId &&
                  resource.roleId === CommonConfig.roles.submitterRoleId,
              ) ??
              resources?.find(
                (resource) => resource.memberId === submitterMemberId,
              );

            if (submitterResource) {
              submitterHandle = submitterResource.memberHandle ?? null;
            }
          }
        } catch (error) {
          this.logger.warn(
            `[publishReviewCompletedEvent] Failed to load resources for challenge ${challengeId}: ${(error as Error)?.message}`,
          );
        }
      }

      const completionDate = review.reviewDate ?? review.updatedAt ?? null;
      const completedAt = completionDate ? completionDate.toISOString() : null;

      const payload = {
        challengeId,
        submissionId,
        phaseId: review.phaseId ?? null,
        reviewId: review.id,
        scorecardId: review.scorecardId,
        reviewerResourceId: review.resourceId,
        reviewerHandle,
        reviewerMemberId,
        submitterHandle,
        submitterMemberId,
        completedAt,
        initialScore: review.initialScore ?? null,
      };

      await this.eventBusService.publish('review.action.completed', payload);
      this.logger.log(
        `[publishReviewCompletedEvent] Published review completion for review ${review.id} on challenge ${challengeId}`,
      );
    } catch (error) {
      this.logger.error(
        `[publishReviewCompletedEvent] Failed to publish completion event for review ${reviewId}`,
        error,
      );
      throw error;
    }
  }

  private async ensureReviewItemChangeAccess(
    authUser: JwtUser | undefined,
    review: {
      id: string;
      resourceId?: string | null;
      submission?: { challengeId?: string | null } | null;
    },
    context: {
      action: 'create' | 'update' | 'delete';
      itemId?: string;
    },
  ): Promise<ReviewItemAccessResult> {
    const requester = authUser ?? ({ isMachine: false } as JwtUser);

    if (requester.isMachine) {
      return {
        mode: 'machine',
        hasReviewerRole: false,
        hasCopilotRole: false,
        ownsReview: false,
      };
    }

    if (isAdmin(requester)) {
      return {
        mode: 'admin',
        hasReviewerRole: false,
        hasCopilotRole: false,
        ownsReview: false,
      };
    }

    const normalizedRoles = Array.isArray(requester.roles)
      ? requester.roles.map((role) => String(role).trim().toLowerCase())
      : [];

    const hasReviewerRole = normalizedRoles.includes(
      String(UserRole.Reviewer).trim().toLowerCase(),
    );

    const hasCopilotRole = normalizedRoles.includes(
      String(UserRole.Copilot).trim().toLowerCase(),
    );

    const actionVerb =
      context.action === 'create'
        ? 'create'
        : context.action === 'delete'
          ? 'delete'
          : 'update';

    if (!hasReviewerRole && !hasCopilotRole) {
      throw new ForbiddenException({
        message: `You do not have permission to ${actionVerb} this review item.`,
        code: `REVIEW_ITEM_${context.action.toUpperCase()}_FORBIDDEN_ROLE`,
        details: {
          reviewId: review.id,
          itemId: context.itemId,
          requesterRoles: requester.roles,
        },
      });
    }

    const requesterMemberId = String(requester.userId ?? '').trim();

    if (!requesterMemberId) {
      throw new ForbiddenException({
        message:
          'Authenticated user information is missing the user identifier required for authorization checks.',
        code: `REVIEW_ITEM_${context.action.toUpperCase()}_FORBIDDEN_MISSING_MEMBER_ID`,
        details: {
          reviewId: review.id,
          itemId: context.itemId,
        },
      });
    }

    const challengeId = review.submission?.challengeId ?? undefined;

    let requesterResources: ResourceInfo[] = [];
    try {
      requesterResources =
        await this.resourceApiService.getMemberResourcesRoles(
          challengeId,
          requesterMemberId,
        );
    } catch (error) {
      this.logger.error(
        `[ensureReviewItemChangeAccess] Failed to verify roles for member ${requesterMemberId} on challenge ${challengeId ?? 'unknown'} during ${context.action}`,
        error,
      );
      throw new ForbiddenException({
        message:
          'Unable to verify ownership of the review for the authenticated user.',
        code: `REVIEW_ITEM_${context.action.toUpperCase()}_FORBIDDEN_OWNERSHIP_UNVERIFIED`,
        details: {
          reviewId: review.id,
          itemId: context.itemId,
          challengeId,
          requester: requesterMemberId,
        },
      });
    }

    let ownsReview = false;
    let mode: ReviewItemAccessMode | null = null;

    if (hasReviewerRole) {
      const normalizedReviewResourceId = String(review.resourceId ?? '').trim();
      ownsReview = requesterResources?.some((resource) => {
        const resourceId = String(resource.id ?? '').trim();
        const resourceMemberId = String(resource.memberId ?? '').trim();
        return (
          resourceId === normalizedReviewResourceId &&
          resourceMemberId === requesterMemberId
        );
      });

      if (!ownsReview) {
        throw new ForbiddenException({
          message: `Only the reviewer who owns this review may ${actionVerb} its review items.`,
          code: `REVIEW_ITEM_${context.action.toUpperCase()}_FORBIDDEN_NOT_OWNER`,
          details: {
            reviewId: review.id,
            itemId: context.itemId,
            challengeId,
            requester: requesterMemberId,
            reviewResourceId: review.resourceId,
          },
        });
      }

      if (ownsReview) {
        mode = 'reviewer-owner';
      }
    }

    if (hasCopilotRole && !ownsReview) {
      const hasCopilotAccess = requesterResources?.some((resource) => {
        const normalizedRoleName = (resource.roleName || '').toLowerCase();
        const matchesRole = normalizedRoleName.includes('copilot');
        const matchesChallenge = challengeId
          ? resource.challengeId === challengeId
          : false;
        return matchesRole && matchesChallenge;
      });

      if (!hasCopilotAccess) {
        throw new ForbiddenException({
          message: `Only a copilot assigned to this challenge may ${actionVerb} its review items.`,
          code: `REVIEW_ITEM_${context.action.toUpperCase()}_FORBIDDEN_NOT_COPILOT`,
          details: {
            reviewId: review.id,
            itemId: context.itemId,
            challengeId,
            requester: requesterMemberId,
          },
        });
      }

      mode = 'copilot';
    }

    if (!mode) {
      mode = ownsReview ? 'reviewer-owner' : 'copilot';
    }

    return {
      mode,
      hasReviewerRole,
      hasCopilotRole,
      ownsReview,
    };
  }
  private async ensureReviewDeleteAccess(
    authUser: JwtUser | undefined,
    review: {
      id: string;
      submission?: { challengeId?: string | null } | null;
    },
  ) {
    const requester = authUser ?? ({ isMachine: false } as JwtUser);

    if (requester.isMachine || isAdmin(requester)) {
      return;
    }

    const normalizedRoles = Array.isArray(requester.roles)
      ? requester.roles.map((role) => String(role).trim().toLowerCase())
      : [];

    const hasCopilotRole = normalizedRoles.includes(
      String(UserRole.Copilot).trim().toLowerCase(),
    );

    if (!hasCopilotRole) {
      throw new ForbiddenException({
        message: 'You do not have permission to delete this review.',
        code: 'REVIEW_DELETE_FORBIDDEN_ROLE',
        details: {
          reviewId: review.id,
          requesterRoles: requester.roles,
        },
      });
    }

    const requesterMemberId = String(requester.userId ?? '');

    if (!requesterMemberId) {
      throw new ForbiddenException({
        message:
          'Authenticated user information is missing the user identifier required for authorization checks.',
        code: 'REVIEW_DELETE_FORBIDDEN_MISSING_MEMBER_ID',
        details: {
          reviewId: review.id,
        },
      });
    }

    const challengeId = review.submission?.challengeId ?? undefined;

    if (!challengeId) {
      throw new ForbiddenException({
        message:
          'Unable to determine the challenge associated with this review for authorization checks.',
        code: 'REVIEW_DELETE_FORBIDDEN_MISSING_CHALLENGE',
        details: {
          reviewId: review.id,
        },
      });
    }

    let requesterResources: ResourceInfo[] = [];

    try {
      requesterResources =
        await this.resourceApiService.getMemberResourcesRoles(
          challengeId,
          requesterMemberId,
        );
    } catch (error) {
      this.logger.error(
        `[ensureReviewDeleteAccess] Failed to verify copilot roles for member ${requesterMemberId} on challenge ${challengeId} while deleting review ${review.id}`,
        error,
      );
      throw new ForbiddenException({
        message:
          'Unable to verify copilot assignment for the authenticated user.',
        code: 'REVIEW_DELETE_FORBIDDEN_OWNERSHIP_UNVERIFIED',
        details: {
          reviewId: review.id,
          challengeId,
          requester: requesterMemberId,
        },
      });
    }

    const hasCopilotAccess = requesterResources?.some((resource) => {
      const normalizedRoleName = (resource.roleName || '').toLowerCase();
      const matchesRole = normalizedRoleName.includes('copilot');
      const matchesChallenge = resource.challengeId === challengeId;
      return matchesRole && matchesChallenge;
    });

    if (!hasCopilotAccess) {
      throw new ForbiddenException({
        message:
          'Only a copilot assigned to this challenge may delete this review.',
        code: 'REVIEW_DELETE_FORBIDDEN_NOT_COPILOT',
        details: {
          reviewId: review.id,
          challengeId,
          requester: requesterMemberId,
        },
      });
    }
  }

  async createReview(
    authUser: JwtUser,
    body: ReviewRequestDto,
  ): Promise<ReviewResponseDto> {
    this.logger.log(`Creating review for submissionId: ${body.submissionId}`);
    try {
      const scorecard = await this.prisma.scorecard.findUnique({
        where: { id: body.scorecardId },
        select: { id: true },
      });

      if (!scorecard) {
        throw new NotFoundException({
          message: `Scorecard with ID ${body.scorecardId} was not found. Please verify the scorecardId and try again.`,
          code: 'SCORECARD_NOT_FOUND',
          details: { scorecardId: body.scorecardId },
        });
      }

      const submission = await this.prisma.submission.findUnique({
        where: { id: body.submissionId },
        select: { challengeId: true },
      });

      if (!submission) {
        throw new NotFoundException({
          message: `Submission with ID ${body.submissionId} was not found. Please verify the submissionId and try again.`,
          code: 'SUBMISSION_NOT_FOUND',
          details: { submissionId: body.submissionId },
        });
      }

      if (!submission.challengeId) {
        throw new BadRequestException({
          message: `Submission ${body.submissionId} does not have an associated challengeId`,
          code: 'MISSING_CHALLENGE_ID',
        });
      }

      const challengeId = submission.challengeId;

      await this.challengeApiService.validateReviewSubmission(challengeId);

      const challengeResources = await this.resourceApiService.getResources({
        challengeId,
      });

      const providedResourceId = body.resourceId
        ? String(body.resourceId).trim()
        : undefined;

      let resource: ResourceInfo | undefined;
      if (providedResourceId) {
        resource = challengeResources.find(
          (challengeResource) => challengeResource.id === providedResourceId,
        );

        if (!resource) {
          throw new NotFoundException({
            message: `Resource with ID ${providedResourceId} was not found for challenge ${challengeId}.`,
            code: 'RESOURCE_NOT_FOUND',
            details: {
              resourceId: providedResourceId,
              challengeId,
            },
          });
        }
      }

      const requesterMemberId = !authUser?.isMachine
        ? String(authUser?.userId ?? '').trim()
        : '';

      let memberResourcesWithRoles: ResourceInfo[] | undefined;

      const loadMemberResourcesIfNeeded = async () => {
        if (memberResourcesWithRoles || !requesterMemberId) {
          return;
        }
        try {
          memberResourcesWithRoles =
            await this.resourceApiService.getMemberResourcesRoles(
              challengeId,
              requesterMemberId,
            );
        } catch (error) {
          this.logger.error(
            '[createReview] Failed to load member resources when determining reviewer ownership',
            error,
          );
          throw new ForbiddenException({
            message:
              'Unable to verify ownership of the review for the authenticated user.',
            code: 'FORBIDDEN_CREATE_REVIEW',
            details: {
              challengeId,
              requester: requesterMemberId,
            },
          });
        }
      };

      if (!resource) {
        if (authUser?.isMachine) {
          throw new BadRequestException({
            message:
              'resourceId must be provided when creating reviews with machine credentials.',
            code: 'RESOURCE_ID_REQUIRED',
            details: {
              challengeId,
            },
          });
        }

        if (!requesterMemberId) {
          throw new ForbiddenException({
            message:
              'Authenticated user information is missing the user identifier required for authorization checks.',
            code: 'FORBIDDEN_CREATE_REVIEW',
            details: {
              challengeId,
            },
          });
        }

        await loadMemberResourcesIfNeeded();

        resource = memberResourcesWithRoles?.find((candidate) =>
          (candidate.roleName || '').toLowerCase().includes('reviewer'),
        );

        if (!resource) {
          if (isAdmin(authUser)) {
            throw new BadRequestException({
              message:
                'Unable to determine a reviewer resource for this request. Please provide a resourceId explicitly.',
              code: 'RESOURCE_NOT_FOUND',
              details: {
                challengeId,
                requester: requesterMemberId,
              },
            });
          }

          throw new ForbiddenException({
            message:
              'Only an admin or a registered reviewer for this challenge can create reviews',
            code: 'FORBIDDEN_CREATE_REVIEW',
            details: {
              challengeId,
              requester: requesterMemberId,
            },
          });
        }
      }

      const challenge =
        await this.challengeApiService.getChallengeDetail(challengeId);

      const challengePhases = challenge?.phases ?? [];
      const resolvePhaseId = (phase: (typeof challengePhases)[number]) =>
        String((phase as any)?.id ?? (phase as any)?.phaseId ?? '');

      const matchPhaseByName = (name: string) =>
        challengePhases.find((phase) => {
          const phaseName = (phase?.name ?? '').trim().toLowerCase();
          return phaseName === name;
        });

      const reviewPhase =
        matchPhaseByName('review') ?? matchPhaseByName('iterative review');

      if (!reviewPhase) {
        throw new BadRequestException({
          message: `Challenge ${challengeId} does not have a Review phase.`,
          code: 'REVIEW_PHASE_NOT_FOUND',
          details: {
            challengeId,
          },
        });
      }

      const reviewPhaseId = resolvePhaseId(reviewPhase);

      if (!reviewPhaseId) {
        throw new BadRequestException({
          message: `Review phase for challenge ${challengeId} is missing an identifier.`,
          code: 'REVIEW_PHASE_NOT_FOUND',
          details: {
            challengeId,
          },
        });
      }

      const resourcePhaseId = resource?.phaseId
        ? String(resource.phaseId)
        : undefined;
      if (resourcePhaseId && resourcePhaseId !== reviewPhaseId) {
        throw new BadRequestException({
          message: `Resource ${resource.id} is associated with phase ${resourcePhaseId}, which does not match the Review phase ${reviewPhaseId}.`,
          code: 'RESOURCE_PHASE_MISMATCH',
          details: {
            resourceId: resource.id,
            resourcePhaseId,
            expectedPhaseId: reviewPhaseId,
          },
        });
      }

      // Ensure downstream logic and persistence use the resolved reviewer resource.
      body.resourceId = resource.id;
      const reviewerResource = resource;

      const scorecardQuestionIds = Array.from(
        new Set(
          (body.reviewItems || [])
            .map((item) => item.scorecardQuestionId)
            .filter(Boolean),
        ),
      );

      if (scorecardQuestionIds.length) {
        const questions = await this.prisma.scorecardQuestion.findMany({
          where: {
            id: {
              in: scorecardQuestionIds,
            },
          },
          select: {
            id: true,
            section: {
              select: {
                group: {
                  select: {
                    scorecardId: true,
                  },
                },
              },
            },
          },
        });

        const foundIds = new Set(questions.map((question) => question.id));
        const missingQuestionIds = scorecardQuestionIds.filter(
          (id) => !foundIds.has(id),
        );

        if (missingQuestionIds.length) {
          throw new NotFoundException({
            message: `Scorecard questions not found: ${missingQuestionIds.join(', ')}`,
            code: 'SCORECARD_QUESTION_NOT_FOUND',
            details: { missingQuestionIds },
          });
        }

        const mismatchedQuestions = questions
          .filter(
            (question) =>
              question.section?.group?.scorecardId !== body.scorecardId,
          )
          .map((question) => question.id);

        if (mismatchedQuestions.length) {
          throw new BadRequestException({
            message: `Scorecard questions ${mismatchedQuestions.join(', ')} do not belong to scorecard ${body.scorecardId}.`,
            code: 'SCORECARD_QUESTION_MISMATCH',
            details: {
              mismatchedQuestionIds: mismatchedQuestions,
              scorecardId: body.scorecardId,
            },
          });
        }
      }

      // Authorization: for member tokens (non-M2M), require admin OR reviewer on the challenge
      if (!authUser?.isMachine) {
        if (!isAdmin(authUser)) {
          const uid = String(authUser?.userId ?? '');

          if (!uid) {
            throw new ForbiddenException({
              message:
                'Authenticated user information is missing the user identifier required for authorization checks.',
              code: 'FORBIDDEN_CREATE_REVIEW',
              details: {
                challengeId,
                resourceId: reviewerResource.id,
              },
            });
          }

          if (String(reviewerResource.memberId) !== uid) {
            throw new ForbiddenException({
              message:
                'The specified resource does not belong to the authenticated user.',
              code: 'RESOURCE_MEMBER_MISMATCH',
              details: {
                challengeId,
                resourceId: reviewerResource.id,
                requester: uid,
                resourceOwner: reviewerResource.memberId,
              },
            });
          }

          let isReviewer = false;
          try {
            await loadMemberResourcesIfNeeded();
            const resources = memberResourcesWithRoles ?? [];
            isReviewer = resources.some((r) =>
              (r.roleName || '').toLowerCase().includes('reviewer'),
            );
          } catch (e) {
            // If we cannot confirm reviewer status, deny access
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.debug(
              `Failed to verify reviewer status via Resource API: ${msg}`,
            );
            isReviewer = false;
          }

          if (!isReviewer) {
            throw new ForbiddenException({
              message:
                'Only an admin or a registered reviewer for this challenge can create reviews',
              code: 'FORBIDDEN_CREATE_REVIEW',
              details: {
                challengeId,
                requester: uid,
              },
            });
          }
        }
      }

      const prismaBody = mapReviewRequestToDto(body) as any;
      prismaBody.phaseId = reviewPhaseId;
      prismaBody.resourceId = reviewerResource.id;
      const createdReview = await this.prisma.review.create({
        data: prismaBody,
        include: {
          reviewItems: {
            include: REVIEW_ITEM_COMMENTS_INCLUDE,
          },
        },
      });

      const scores = await this.computeScoresFromItems(
        createdReview.scorecardId,
        (createdReview.reviewItems || []).map((ri) => ({
          scorecardQuestionId: ri.scorecardQuestionId,
          initialAnswer: ri.initialAnswer,
          finalAnswer: ri.finalAnswer,
        })),
      );
      console.log(`scores computed: ${JSON.stringify(scores)}`);
      const needsScorePersist =
        createdReview.initialScore !== scores.initialScore ||
        createdReview.finalScore !== scores.finalScore;

      let reviewToReturn = createdReview;

      if (needsScorePersist) {
        reviewToReturn = await this.prisma.review.update({
          where: { id: createdReview.id },
          data: {
            initialScore: scores.initialScore,
            finalScore: scores.finalScore,
          },
          include: {
            reviewItems: {
              include: REVIEW_ITEM_COMMENTS_INCLUDE,
            },
          },
        });
      }

      this.logger.log(`Review created with ID: ${reviewToReturn.id}`);
      if (reviewToReturn.status === ReviewStatus.COMPLETED) {
        await this.publishReviewCompletedEvent(reviewToReturn.id);
      }
      return {
        ...reviewToReturn,
        initialScore: scores.initialScore,
        finalScore: scores.finalScore,
      } as unknown as ReviewResponseDto;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      if (
        error?.message &&
        error.message.includes('Reviews cannot be submitted')
      ) {
        throw new BadRequestException({
          message: error.message,
          code: 'PHASE_VALIDATION_ERROR',
        });
      }

      const errorResponse = this.prismaErrorService.handleError(
        error,
        `creating review for submissionId: ${body.submissionId}`,
        body,
      );

      if (errorResponse.code === 'RECORD_NOT_FOUND') {
        throw new NotFoundException({
          message: errorResponse.message,
          code: errorResponse.code,
          details: errorResponse.details,
        });
      }

      if (errorResponse.code === 'VALIDATION_ERROR') {
        throw new BadRequestException({
          message: errorResponse.message,
          code: errorResponse.code,
          details: errorResponse.details,
        });
      }

      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  async createReviewItemComments(
    authUser: JwtUser | undefined,
    body: ReviewItemRequestDto,
  ): Promise<ReviewItemResponseDto> {
    this.logger.log(`Creating review item for review`);
    try {
      const mapped = mapReviewItemRequestToDto(body);
      if (!('review' in mapped) || !mapped.review) {
        throw new BadRequestException({
          message: 'reviewId is required when creating a review item',
          code: 'VALIDATION_ERROR',
        });
      }

      const reviewId = body.reviewId ?? mapped.review?.connect?.id;

      if (!reviewId) {
        throw new BadRequestException({
          message: 'reviewId is required when creating a review item',
          code: 'VALIDATION_ERROR',
        });
      }

      const review = await this.prisma.review.findUnique({
        where: { id: reviewId },
        select: {
          id: true,
          resourceId: true,
          scorecardId: true,
          submission: {
            select: {
              challengeId: true,
            },
          },
        },
      });

      if (!review) {
        throw new BadRequestException({
          message: `Review with ID ${reviewId} does not exist. Cannot create review items for a non-existent review.`,
          code: 'REVIEW_NOT_FOUND',
          details: { reviewId },
        });
      }

      await this.ensureReviewItemChangeAccess(
        authUser,
        {
          id: review.id,
          resourceId: review.resourceId,
          submission: review.submission,
        },
        {
          action: 'create',
        },
      );

      const question = await this.prisma.scorecardQuestion.findUnique({
        where: { id: body.scorecardQuestionId },
        select: {
          id: true,
          section: {
            select: {
              group: {
                select: { scorecardId: true },
              },
            },
          },
        },
      });

      if (!question) {
        throw new BadRequestException({
          message: `Scorecard question with ID ${body.scorecardQuestionId} was not found.`,
          code: 'SCORECARD_QUESTION_NOT_FOUND',
          details: { scorecardQuestionId: body.scorecardQuestionId },
        });
      }

      if (
        question.section?.group?.scorecardId &&
        review.scorecardId &&
        question.section.group.scorecardId !== review.scorecardId
      ) {
        throw new BadRequestException({
          message: `Scorecard question ${body.scorecardQuestionId} does not belong to review scorecard ${review.scorecardId}.`,
          code: 'SCORECARD_QUESTION_MISMATCH',
          details: {
            scorecardQuestionId: body.scorecardQuestionId,
            reviewScorecardId: review.scorecardId,
            questionScorecardId: question.section.group.scorecardId,
          },
        });
      }

      const data = await this.prisma.reviewItem.create({
        data: mapped as any,
        include: REVIEW_ITEM_COMMENTS_INCLUDE,
      });
      // Recalculate parent review scores
      if (data?.reviewId) {
        await this.recomputeAndUpdateReviewScores(data.reviewId);
      }
      this.logger.log(`Review item created with ID: ${data.id}`);
      return data as unknown as ReviewItemResponseDto;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      const errorResponse = this.prismaErrorService.handleError(
        error,
        `creating review item for reviewId: ${body.reviewId}`,
        body,
      );
      if (
        errorResponse.code === 'RECORD_NOT_FOUND' ||
        errorResponse.code === 'FOREIGN_KEY_CONSTRAINT_FAILED' ||
        errorResponse.code === 'VALIDATION_ERROR'
      ) {
        throw new BadRequestException({
          message: errorResponse.message,
          code: errorResponse.code,
          details: errorResponse.details,
        });
      }

      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  async updateReview(
    authUser: JwtUser,
    id: string,
    body: ReviewPatchRequestDto | ReviewPutRequestDto,
  ): Promise<ReviewResponseDto> {
    this.logger.log(`Updating review with ID: ${id}`);

    const immutableFields = ['resourceId', 'phaseId', 'submissionId'] as const;
    const forbiddenUpdates = immutableFields.filter(
      (field) => (body as Record<string, unknown>)[field] !== undefined,
    );

    if (forbiddenUpdates.length > 0) {
      throw new BadRequestException({
        message: `The following fields cannot be updated: ${forbiddenUpdates.join(
          ', ',
        )}.`,
        code: 'REVIEW_UPDATE_IMMUTABLE_FIELDS',
        details: { reviewId: id, fields: forbiddenUpdates },
      });
    }

    const existingReview = await this.prisma.review.findUnique({
      where: { id },
      include: {
        submission: {
          select: {
            challengeId: true,
          },
        },
        reviewItems: {
          select: {
            scorecardQuestionId: true,
            initialAnswer: true,
            finalAnswer: true,
            managerComment: true,
          },
        },
      },
    });

    if (!existingReview) {
      throw new NotFoundException({
        message: `Review with ID ${id} was not found. Please check the ID and try again.`,
        code: 'RECORD_NOT_FOUND',
        details: { reviewId: id },
      });
    }

    const requester = authUser ?? ({ isMachine: false } as JwtUser);
    const isPrivileged = isAdmin(requester);
    const challengeId = existingReview.submission?.challengeId;
    const isMemberRequester = !requester?.isMachine;
    const normalizedRoles = Array.isArray(requester.roles)
      ? requester.roles.map((role) => String(role).trim().toLowerCase())
      : [];
    const hasCopilotRole = normalizedRoles.includes(
      String(UserRole.Copilot).trim().toLowerCase(),
    );
    const shouldAudit = this.shouldRecordManagerAudit(
      requester,
      hasCopilotRole,
    );
    const auditActorId = shouldAudit ? this.getAuditActorId(requester) : null;
    const definedBodyKeys = Object.entries(body as Record<string, unknown>)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key);
    const isStatusOnlyUpdate =
      definedBodyKeys.length === 1 && definedBodyKeys[0] === 'status';

    if (isMemberRequester && !isPrivileged) {
      const requesterMemberId = String(requester?.userId ?? '');

      if (!requesterMemberId) {
        throw new ForbiddenException({
          message:
            'Authenticated user information is missing the user identifier required for authorization checks.',
          code: 'REVIEW_UPDATE_FORBIDDEN_MISSING_MEMBER_ID',
          details: {
            reviewId: id,
          },
        });
      }

      let requesterResources: ResourceInfo[] = [];
      try {
        requesterResources = await this.resourceApiService.getResources({
          memberId: requesterMemberId,
          ...(challengeId ? { challengeId } : {}),
        });
      } catch (error) {
        this.logger.error(
          `[updateReview] Failed to verify ownership for review ${id} and member ${requesterMemberId}`,
          error,
        );
        throw new ForbiddenException({
          message:
            'Unable to verify ownership of the review for the authenticated user.',
          code: 'REVIEW_UPDATE_FORBIDDEN_OWNERSHIP_UNVERIFIED',
          details: {
            reviewId: id,
            challengeId,
            requester: requesterMemberId,
          },
        });
      }

      const ownsReview = requesterResources?.some(
        (resource) => resource.id === existingReview.resourceId,
      );

      const allowCopilotStatusPatch =
        hasCopilotRole && isStatusOnlyUpdate && !ownsReview;

      if (!ownsReview) {
        if (allowCopilotStatusPatch) {
          if (!challengeId) {
            throw new ForbiddenException({
              message:
                'Unable to determine the challenge associated with this review for copilot authorization checks.',
              code: 'REVIEW_UPDATE_FORBIDDEN_COPILOT_MISSING_CHALLENGE',
              details: {
                reviewId: id,
                requester: requesterMemberId,
                reviewResourceId: existingReview.resourceId,
              },
            });
          }

          let copilotResources: ResourceInfo[] = [];
          try {
            copilotResources =
              await this.resourceApiService.getMemberResourcesRoles(
                challengeId,
                requesterMemberId,
              );
          } catch (error) {
            this.logger.error(
              `[updateReview] Failed to verify copilot assignment for member ${requesterMemberId} on challenge ${challengeId} while updating review ${id}`,
              error,
            );
            throw new ForbiddenException({
              message:
                'Unable to verify copilot assignment for the authenticated user.',
              code: 'REVIEW_UPDATE_FORBIDDEN_COPILOT_UNVERIFIED',
              details: {
                reviewId: id,
                challengeId,
                requester: requesterMemberId,
              },
            });
          }

          const hasCopilotAccess = copilotResources?.some((resource) => {
            const normalizedRoleName = (resource.roleName || '').toLowerCase();
            const matchesRole = normalizedRoleName.includes('copilot');
            const matchesChallenge = resource.challengeId === challengeId;
            return matchesRole && matchesChallenge;
          });

          if (!hasCopilotAccess) {
            throw new ForbiddenException({
              message:
                'Only a copilot assigned to this challenge may update the review status.',
              code: 'REVIEW_UPDATE_FORBIDDEN_NOT_COPILOT',
              details: {
                reviewId: id,
                challengeId,
                requester: requesterMemberId,
                reviewResourceId: existingReview.resourceId,
              },
            });
          }
        } else {
          throw new ForbiddenException({
            message:
              'Only the reviewer who owns this review or an admin may update it.',
            code: 'REVIEW_UPDATE_FORBIDDEN_NOT_OWNER',
            details: {
              reviewId: id,
              challengeId,
              requester: requesterMemberId,
              reviewResourceId: existingReview.resourceId,
            },
          });
        }
      }
    }

    if (!isPrivileged && challengeId) {
      let challenge;
      try {
        challenge =
          await this.challengeApiService.getChallengeDetail(challengeId);
      } catch (error) {
        this.logger.error(
          `[updateReview] Unable to fetch challenge ${challengeId} for review ${id}`,
          error,
        );
        throw new InternalServerErrorException({
          message: `Unable to verify the challenge status for challenge ${challengeId}. Please try again later.`,
          code: 'CHALLENGE_STATUS_UNAVAILABLE',
          details: { challengeId, reviewId: id },
        });
      }

      if (challenge.status === ChallengeStatus.COMPLETED) {
        throw new ForbiddenException({
          message:
            'Reviews for challenges in COMPLETED status cannot be updated.  Only an admin can update a review once the challenge is complete.',
          code: 'REVIEW_UPDATE_FORBIDDEN_CHALLENGE_COMPLETED',
          details: { reviewId: id, challengeId },
        });
      }
    }

    const incomingReviewItems =
      'reviewItems' in body ? (body.reviewItems ?? undefined) : undefined;

    const baseUpdateData = mapReviewRequestToDto(
      'reviewItems' in body
        ? ({ ...body, reviewItems: undefined } as ReviewPatchRequestDto)
        : (body as ReviewPatchRequestDto),
    );

    const reviewItemsUpdate =
      incomingReviewItems !== undefined
        ? {
            reviewItems: {
              deleteMany: {},
              create: incomingReviewItems.map((item) => {
                const {
                  reviewItemComments,
                  managerComment,
                  finalAnswer,
                  reviewId: _ignoredReviewId,
                  ...rest
                } = item ?? {};
                void _ignoredReviewId;

                const { scorecardQuestionId, initialAnswer } = rest as {
                  scorecardQuestionId: string;
                  initialAnswer: string;
                };

                const reviewItemCreate: Record<string, unknown> = {
                  scorecardQuestionId,
                  initialAnswer,
                };

                if (finalAnswer !== undefined) {
                  reviewItemCreate.finalAnswer = finalAnswer;
                }

                if (managerComment !== undefined) {
                  reviewItemCreate.managerComment = managerComment ?? null;
                }

                if (reviewItemComments?.length) {
                  reviewItemCreate.reviewItemComments = {
                    create: reviewItemComments.map((comment) => ({
                      content: comment.content,
                      type: comment.type,
                      sortOrder: comment.sortOrder ?? 0,
                      resourceId: existingReview.resourceId,
                    })),
                  };
                }

                return reviewItemCreate;
              }),
            },
          }
        : undefined;

    const updateData = {
      ...baseUpdateData,
      ...(reviewItemsUpdate ?? {}),
    } as Prisma.reviewUpdateInput;

    try {
      const data = await this.prisma.review.update({
        where: { id },
        data: updateData,
        include: {
          reviewItems: {
            include: REVIEW_ITEM_COMMENTS_INCLUDE,
          },
        },
      });
      // Recalculate scores based on current review items
      const recomputedScores = await this.recomputeAndUpdateReviewScores(id);
      if (
        existingReview.status !== ReviewStatus.COMPLETED &&
        data.status === ReviewStatus.COMPLETED
      ) {
        await this.publishReviewCompletedEvent(id);
      }
      const responsePayload = {
        ...data,
        ...(recomputedScores ?? {}),
      } as ReviewResponseDto;

      if (shouldAudit && auditActorId) {
        const beforeState = {
          status: existingReview.status ?? null,
          committed: existingReview.committed ?? null,
          finalScore: existingReview.finalScore ?? null,
          initialScore: existingReview.initialScore ?? null,
          reviewDate: existingReview.reviewDate ?? null,
          metadata: existingReview.metadata ?? null,
          typeId: existingReview.typeId ?? null,
          scorecardId: existingReview.scorecardId ?? null,
          reviewItems: (existingReview.reviewItems ?? []).map((item) => ({
            scorecardQuestionId: item.scorecardQuestionId,
            initialAnswer: item.initialAnswer,
            finalAnswer: item.finalAnswer ?? null,
            managerComment: item.managerComment ?? null,
          })),
        };

        const afterState = {
          status: responsePayload.status ?? null,
          committed: responsePayload.committed ?? null,
          finalScore: responsePayload.finalScore ?? null,
          initialScore: responsePayload.initialScore ?? null,
          reviewDate: responsePayload.reviewDate ?? null,
          metadata: responsePayload.metadata ?? null,
          typeId: responsePayload.typeId ?? null,
          scorecardId: responsePayload.scorecardId ?? null,
          reviewItems: (responsePayload.reviewItems ?? []).map((item) => ({
            scorecardQuestionId: item.scorecardQuestionId,
            initialAnswer: item.initialAnswer,
            finalAnswer: item.finalAnswer ?? null,
            managerComment: item.managerComment ?? null,
          })),
        };

        const auditDescriptions = this.collectReviewAuditChanges(
          beforeState,
          afterState,
        );

        await this.recordReviewAuditEntry({
          actorId: auditActorId,
          reviewId: id,
          submissionId: existingReview.submissionId ?? null,
          challengeId: challengeId ?? null,
          descriptions: auditDescriptions,
        });
      }
      this.logger.log(`Review updated successfully: ${id}`);
      return responsePayload;
    } catch (error) {
      const errorResponse = this.prismaErrorService.handleError(
        error,
        `updating review with ID: ${id}`,
      );

      if (errorResponse.code === 'RECORD_NOT_FOUND') {
        throw new NotFoundException({
          message: `Review with ID ${id} was not found. Please check the ID and try again.`,
          code: errorResponse.code,
          details: { reviewId: id },
        });
      }

      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  async updateReviewItem(
    authUser: JwtUser | undefined,
    itemId: string,
    body: ReviewItemRequestDto,
  ): Promise<ReviewItemResponseDto> {
    this.logger.log(`Updating review item with ID: ${itemId}`);
    try {
      const existingItem = await this.prisma.reviewItem.findUnique({
        where: { id: itemId },
        include: {
          review: {
            select: {
              id: true,
              resourceId: true,
              scorecardId: true,
              submissionId: true,
              submission: {
                select: {
                  challengeId: true,
                },
              },
            },
          },
        },
      });

      if (!existingItem || !existingItem.review) {
        throw new NotFoundException({
          message: `Review item with ID ${itemId} was not found. Please check the ID and try again.`,
          code: 'RECORD_NOT_FOUND',
          details: { itemId },
        });
      }

      const reviewId = existingItem.reviewId;
      const review = existingItem.review;

      if (!reviewId) {
        throw new NotFoundException({
          message: `Unable to determine the parent review for review item ${itemId}.`,
          code: 'REVIEW_NOT_FOUND',
          details: { itemId },
        });
      }

      const requester = authUser ?? ({ isMachine: false } as JwtUser);
      const normalizedRoles = Array.isArray(requester.roles)
        ? requester.roles.map((role) => String(role).trim().toLowerCase())
        : [];
      const hasCopilotRole = normalizedRoles.includes(
        String(UserRole.Copilot).trim().toLowerCase(),
      );
      const shouldAudit = this.shouldRecordManagerAudit(
        requester,
        hasCopilotRole,
      );
      const auditActorId = shouldAudit ? this.getAuditActorId(requester) : null;

      if (body.reviewId && body.reviewId !== reviewId) {
        throw new BadRequestException({
          message: `Review item ${itemId} belongs to review ${reviewId}. The provided reviewId ${body.reviewId} is invalid for this item.`,
          code: 'REVIEW_ITEM_REVIEW_MISMATCH',
          details: {
            itemId,
            expectedReviewId: reviewId,
            providedReviewId: body.reviewId,
          },
        });
      }

      const question = await this.prisma.scorecardQuestion.findUnique({
        where: { id: body.scorecardQuestionId },
        select: {
          id: true,
          section: {
            select: {
              group: {
                select: { scorecardId: true },
              },
            },
          },
        },
      });

      if (!question) {
        throw new BadRequestException({
          message: `Scorecard question with ID ${body.scorecardQuestionId} was not found.`,
          code: 'SCORECARD_QUESTION_NOT_FOUND',
          details: { scorecardQuestionId: body.scorecardQuestionId },
        });
      }

      if (
        review.scorecardId &&
        question.section?.group?.scorecardId &&
        review.scorecardId !== question.section.group.scorecardId
      ) {
        throw new BadRequestException({
          message: `Scorecard question ${body.scorecardQuestionId} does not belong to review scorecard ${review.scorecardId}.`,
          code: 'SCORECARD_QUESTION_MISMATCH',
          details: {
            scorecardQuestionId: body.scorecardQuestionId,
            reviewScorecardId: review.scorecardId,
            questionScorecardId: question.section.group.scorecardId,
          },
        });
      }

      const access = await this.ensureReviewItemChangeAccess(
        authUser,
        {
          id: review.id,
          resourceId: review.resourceId,
          submission: review.submission,
        },
        {
          action: 'update',
          itemId,
        },
      );

      if (access.mode === 'copilot') {
        const forbiddenFields: string[] = [];
        const existingManagerComment = existingItem.managerComment ?? null;

        if (
          body.managerComment !== undefined &&
          body.managerComment !== existingManagerComment
        ) {
          forbiddenFields.push('managerComment');
        }

        if (body.reviewItemComments !== undefined) {
          forbiddenFields.push('reviewItemComments');
        }

        if (
          body.initialAnswer !== undefined &&
          body.initialAnswer !== existingItem.initialAnswer
        ) {
          forbiddenFields.push('initialAnswer');
        }

        if (
          body.scorecardQuestionId &&
          body.scorecardQuestionId !== existingItem.scorecardQuestionId
        ) {
          forbiddenFields.push('scorecardQuestionId');
        }

        if (forbiddenFields.length > 0) {
          throw new ForbiddenException({
            message:
              'Copilot permissions allow updating only the score for this review item.',
            code: 'REVIEW_ITEM_UPDATE_FORBIDDEN_COPILOT_SCOPE',
            details: {
              reviewId: review.id,
              itemId,
              forbiddenFields,
            },
          });
        }
      }

      const mappedData = mapReviewItemRequestForUpdate(body);

      if (mappedData.reviewItemComments?.create) {
        mappedData.reviewItemComments.create =
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          mappedData.reviewItemComments.create.map((comment: any) => ({
            ...comment,
            resourceId: comment.resourceId || review.resourceId,
          }));
      }

      const data = await this.prisma.reviewItem.update({
        where: { id: itemId },
        data: mappedData,
        include: REVIEW_ITEM_COMMENTS_INCLUDE,
      });

      if (data?.reviewId) {
        await this.recomputeAndUpdateReviewScores(data.reviewId);
      }

      if (shouldAudit && auditActorId) {
        const beforeItems = [
          {
            scorecardQuestionId: existingItem.scorecardQuestionId,
            initialAnswer: existingItem.initialAnswer,
            finalAnswer: existingItem.finalAnswer ?? null,
            managerComment: existingItem.managerComment ?? null,
          },
        ];
        const afterItems = [
          {
            scorecardQuestionId: data.scorecardQuestionId,
            initialAnswer: data.initialAnswer,
            finalAnswer: data.finalAnswer ?? null,
            managerComment: data.managerComment ?? null,
          },
        ];

        const auditDescriptions = this.collectReviewItemAuditChanges(
          beforeItems,
          afterItems,
        );

        await this.recordReviewAuditEntry({
          actorId: auditActorId,
          reviewId: reviewId,
          submissionId: review.submissionId ?? null,
          challengeId: review.submission?.challengeId ?? null,
          descriptions: auditDescriptions,
        });
      }

      this.logger.log(`Review item updated successfully: ${itemId}`);
      return data as unknown as ReviewItemResponseDto;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      const errorResponse = this.prismaErrorService.handleError(
        error,
        `updating review item with ID: ${itemId}`,
      );

      if (errorResponse.code === 'RECORD_NOT_FOUND') {
        throw new NotFoundException({
          message: `Review item with ID ${itemId} was not found. Please check the ID and try again.`,
          code: errorResponse.code,
          details: { itemId },
        });
      }

      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  async getReviews(
    authUser: JwtUser,
    status?: ReviewStatus,
    challengeId?: string,
    submissionId?: string,
    paginationDto?: PaginationDto,
  ): Promise<PaginatedResponse<ReviewResponseDto>> {
    this.logger.log(
      `Getting reviews with filters - status: ${status}, challengeId: ${challengeId}, submissionId: ${submissionId}`,
    );

    const { page = 1, perPage = 10 } = paginationDto || {};
    const skip = (page - 1) * perPage;

    try {
      const reviewWhereClause: any = {};
      let challengeDetail: {
        status?: ChallengeStatus;
        phases?: Array<{ name?: string | null; isOpen?: boolean | null }>;
      } | null = null;
      let requesterIsChallengeResource = false;
      const reviewerResourceIdSet = new Set<string>();
      const submitterSubmissionIdSet = new Set<string>();
      let hasCopilotRoleForChallenge = false;
      let hasSubmitterRoleForChallenge = false;
      let submitterVisibilityState = {
        allowAny: false,
        allowOwn: false,
      };

      // Utility to merge an allowed set of submission IDs into where clause
      const restrictToSubmissionIds = (allowedIds: string[]) => {
        if (!allowedIds || allowedIds.length === 0) {
          // Force impossible condition to return empty result deterministically
          reviewWhereClause.submissionId = { in: ['__none__'] };
          return;
        }
        const existing = reviewWhereClause.submissionId;
        if (!existing) {
          reviewWhereClause.submissionId = { in: allowedIds };
        } else if (typeof existing === 'string') {
          // Keep only if included
          if (!allowedIds.includes(existing)) {
            reviewWhereClause.submissionId = { in: ['__none__'] };
          } else {
            reviewWhereClause.submissionId = existing;
          }
        } else if (existing.in && Array.isArray(existing.in)) {
          const intersect = existing.in.filter((id: string) =>
            allowedIds.includes(id),
          );
          reviewWhereClause.submissionId = {
            in: intersect.length ? intersect : ['__none__'],
          };
        } else {
          // Unknown shape; overwrite conservatively
          reviewWhereClause.submissionId = { in: allowedIds };
        }
      };

      const restrictToResourceIds = (allowedIds: string[]) => {
        if (!allowedIds || allowedIds.length === 0) {
          reviewWhereClause.resourceId = { in: ['__none__'] };
          return;
        }
        const existing = reviewWhereClause.resourceId;
        if (!existing) {
          reviewWhereClause.resourceId = { in: allowedIds };
        } else if (typeof existing === 'string') {
          if (!allowedIds.includes(existing)) {
            reviewWhereClause.resourceId = { in: ['__none__'] };
          } else {
            reviewWhereClause.resourceId = existing;
          }
        } else if (existing.in && Array.isArray(existing.in)) {
          const intersect = existing.in.filter((id: string) =>
            allowedIds.includes(id),
          );
          reviewWhereClause.resourceId = {
            in: intersect.length ? intersect : ['__none__'],
          };
        } else {
          reviewWhereClause.resourceId = { in: allowedIds };
        }
      };

      if (submissionId) {
        reviewWhereClause.submissionId = submissionId;
      }

      if (status) {
        reviewWhereClause.status = status;
      }

      if (challengeId) {
        this.logger.debug(`Fetching reviews by challengeId: ${challengeId}`);
        const submissions = await this.prisma.submission.findMany({
          where: { challengeId },
          select: { id: true },
        });

        const submissionIds = submissions.map((s) => s.id);

        if (submissionIds.length > 0) {
          reviewWhereClause.submissionId = { in: submissionIds };
        } else {
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
      }

      // Authorization filtering for non-admin member tokens
      if (!authUser?.isMachine && !isAdmin(authUser)) {
        const uid = String(authUser?.userId ?? '');

        // If a challengeId is specified, check role context for that challenge
        if (challengeId) {
          let normalized: ResourceInfo[] = [];
          try {
            const resources =
              await this.resourceApiService.getMemberResourcesRoles(
                challengeId,
                uid,
              );

            normalized = resources || [];
            requesterIsChallengeResource = normalized.length > 0;
            normalized
              .filter((r) =>
                (r.roleName || '').toLowerCase().includes('reviewer'),
              )
              .forEach((r) => reviewerResourceIdSet.add(r.id));
            hasCopilotRoleForChallenge = normalized.some((r) =>
              (r.roleName || '').toLowerCase().includes('copilot'),
            );
            hasSubmitterRoleForChallenge = normalized.some((r) => {
              const roleName = (r.roleName || '').toLowerCase();
              return (
                r.roleId === CommonConfig.roles.submitterRoleId ||
                roleName.includes('submitter')
              );
            });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.debug(
              `Failed to verify reviewer/copilot roles via Resource API: ${msg}`,
            );
          }

          if (hasCopilotRoleForChallenge) {
            // Copilots retain full visibility for the challenge
          } else if (reviewerResourceIdSet.size) {
            restrictToResourceIds(Array.from(reviewerResourceIdSet));
          } else {
            // Confirm the user has actually submitted to this challenge
            const mySubs = await this.prisma.submission.findMany({
              where: { challengeId, memberId: uid },
              select: { id: true },
            });
            if (mySubs.length === 0) {
              throw new ForbiddenException({
                message:
                  'You must be a submitter on this challenge to access reviews',
                code: 'FORBIDDEN_REVIEW_ACCESS',
                details: { challengeId, requester: uid },
              });
            }

            // Fetch challenge to determine phase-based visibility
            challengeDetail =
              await this.challengeApiService.getChallengeDetail(challengeId);
            const challenge = challengeDetail;
            const phases = challenge.phases || [];
            const appealsOpen = phases.some(
              (p) => p.name === 'Appeals' && p.isOpen,
            );
            const appealsResponseOpen = phases.some(
              (p) => p.name === 'Appeals Response' && p.isOpen,
            );
            const submissionPhaseClosed = phases.some(
              (p) =>
                (p.name || '').toLowerCase() === 'submission' &&
                p.isOpen === false,
            );
            const mySubmissionIds = mySubs.map((s) => s.id);
            mySubmissionIds.forEach((id) => submitterSubmissionIdSet.add(id));
            submitterVisibilityState =
              this.getSubmitterVisibilityForChallenge(challenge);

            if (!requesterIsChallengeResource && mySubs.length > 0) {
              requesterIsChallengeResource = true;
            }

            if (challenge.status === ChallengeStatus.COMPLETED) {
              // Allowed to see all reviews on this challenge
              // reviewWhereClause already limited to submissions on this challenge
            } else if (appealsOpen || appealsResponseOpen) {
              // Restrict to own reviews (own submissions only)
              restrictToSubmissionIds(mySubmissionIds);
            } else if (
              challenge.status === ChallengeStatus.ACTIVE &&
              submissionPhaseClosed &&
              hasSubmitterRoleForChallenge
            ) {
              // Submitters can access their own submissions once submission phase closes
              restrictToSubmissionIds(mySubmissionIds);
            } else {
              // No access for non-completed, non-appeals phases
              throw new ForbiddenException({
                message:
                  'Reviews are not accessible for this challenge at the current phase',
                code: 'FORBIDDEN_REVIEW_ACCESS',
                details: {
                  challengeId,
                  status: challenge.status,
                },
              });
            }
          }
        } else {
          // No specific challenge provided: restrict to allowed submissions across challenges
          if (!uid) {
            // Should not happen, but guard anyway
            restrictToSubmissionIds([]);
          } else {
            // Get all of the user's submissions (ids + challengeId)
            const mySubs = await this.prisma.submission.findMany({
              where: { memberId: uid },
              select: { id: true, challengeId: true },
            });

            if (mySubs.length === 0) {
              // They haven't submitted anywhere; no reviews are visible
              restrictToSubmissionIds([]);
            } else {
              const myChallengeIds = Array.from(
                new Set(
                  mySubs
                    .map((s) => s.challengeId)
                    .filter((cId): cId is string => !!cId),
                ),
              );

              // Fetch challenge details in bulk
              const challenges =
                await this.challengeApiService.getChallenges(myChallengeIds);
              const completedIds = challenges
                .filter((c) => c.status === ChallengeStatus.COMPLETED)
                .map((c) => c.id);
              const appealsAllowedIds = challenges
                .filter((c) => {
                  const phases = c.phases || [];
                  return phases.some(
                    (p) =>
                      (p.name === 'Appeals' || p.name === 'Appeals Response') &&
                      p.isOpen,
                  );
                })
                .map((c) => c.id);

              const allowed = new Set<string>();

              // For completed challenges, allow all submissions in those challenges
              if (completedIds.length) {
                const subs = await this.prisma.submission.findMany({
                  where: { challengeId: { in: completedIds } },
                  select: { id: true },
                });
                subs.forEach((s) => allowed.add(s.id));
              }

              // For appeals or appeals response, allow only the user's own submissions
              const myAllowedOwn = mySubs
                .filter((s) => appealsAllowedIds.includes(s.challengeId || ''))
                .map((s) => s.id);
              myAllowedOwn.forEach((id) => allowed.add(id));

              restrictToSubmissionIds(Array.from(allowed));
            }
          }
        }
      }

      if (challengeId && !challengeDetail) {
        try {
          challengeDetail =
            await this.challengeApiService.getChallengeDetail(challengeId);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.debug(
            `[getReviews] Unable to fetch challenge detail for submitter enrichment: ${message}`,
          );
        }
      }

      const shouldIncludeSubmitterMetadata =
        Boolean(challengeId) &&
        !!challengeDetail &&
        [
          ChallengeStatus.COMPLETED,
          ChallengeStatus.CANCELLED_FAILED_REVIEW,
        ].includes(challengeDetail.status as ChallengeStatus) &&
        (isAdmin(authUser) || requesterIsChallengeResource);

      this.logger.debug(`Fetching reviews with where clause:`);
      this.logger.debug(reviewWhereClause);

      const reviews = await this.prisma.review.findMany({
        where: reviewWhereClause,
        skip,
        take: perPage,
        include: {
          reviewItems: {
            include: REVIEW_ITEM_COMMENTS_INCLUDE,
          },
          submission: {
            select: { id: true, memberId: true, challengeId: true },
          },
        },
      });

      const reviewerProfilesByResource = new Map<
        string,
        { handle: string | null; maxRating: number | null }
      >();
      const submitterProfilesBySubmission = new Map<
        string,
        { handle: string | null; maxRating: number | null }
      >();

      if (reviews.length) {
        try {
          const resourceIds = Array.from(
            new Set(
              reviews
                .map((review) => String(review.resourceId ?? '').trim())
                .filter((id) => id.length),
            ),
          );

          if (resourceIds.length) {
            const resources = await this.resourcePrisma.resource.findMany({
              where: { id: { in: resourceIds } },
              select: { id: true, memberId: true },
            });

            const memberIds = Array.from(
              new Set(
                resources
                  .map((resource) => String(resource.memberId ?? '').trim())
                  .filter((id) => id.length),
              ),
            );

            const memberIdsAsBigInt: bigint[] = [];
            for (const id of memberIds) {
              try {
                memberIdsAsBigInt.push(BigInt(id));
              } catch (error) {
                this.logger.debug(
                  `[getReviews] Skipping reviewer memberId ${id}: unable to convert to BigInt. ${error}`,
                );
              }
            }

            const memberInfoById = new Map<
              string,
              { handle: string | null; maxRating: number | null }
            >();

            if (memberIdsAsBigInt.length) {
              const members = await this.memberPrisma.member.findMany({
                where: { userId: { in: memberIdsAsBigInt } },
                select: {
                  userId: true,
                  handle: true,
                  maxRating: { select: { rating: true } },
                },
              });

              members.forEach((member) => {
                memberInfoById.set(member.userId.toString(), {
                  handle: member.handle ?? null,
                  maxRating: member.maxRating?.rating ?? null,
                });
              });
            }

            resources.forEach((resource) => {
              const memberId = String(resource.memberId ?? '').trim();
              const profile = memberInfoById.get(memberId) ?? {
                handle: null,
                maxRating: null,
              };
              reviewerProfilesByResource.set(resource.id, profile);
            });
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `[getReviews] Failed to enrich reviewer metadata: ${message}`,
          );
        }
      }

      if (shouldIncludeSubmitterMetadata && reviews.length) {
        try {
          const submissionMembers = reviews
            .map((review) => ({
              submissionId: review.submissionId,
              memberId: String(review.submission?.memberId ?? '').trim(),
            }))
            .filter(
              (entry): entry is { submissionId: string; memberId: string } =>
                Boolean(entry.submissionId && entry.memberId),
            );

          const uniqueMemberIds = Array.from(
            new Set(submissionMembers.map((entry) => entry.memberId)),
          );

          if (uniqueMemberIds.length) {
            const challengeIdForResources =
              challengeId ?? reviews[0]?.submission?.challengeId ?? undefined;

            const submitterHandles = new Map<string, string | null>();

            if (challengeIdForResources) {
              const submitterResources =
                await this.resourcePrisma.resource.findMany({
                  where: {
                    challengeId: challengeIdForResources,
                    memberId: { in: uniqueMemberIds },
                  },
                  select: { memberId: true, memberHandle: true },
                });

              submitterResources.forEach((resource) => {
                const memberId = String(resource.memberId ?? '').trim();
                if (!memberId || submitterHandles.has(memberId)) {
                  return;
                }
                submitterHandles.set(memberId, resource.memberHandle ?? null);
              });
            }

            const memberIdsAsBigInt: bigint[] = [];
            for (const id of uniqueMemberIds) {
              try {
                memberIdsAsBigInt.push(BigInt(id));
              } catch (error) {
                this.logger.debug(
                  `[getReviews] Skipping submitter memberId ${id}: unable to convert to BigInt. ${error}`,
                );
              }
            }

            const submitterMemberInfoById = new Map<
              string,
              { handle: string | null; maxRating: number | null }
            >();

            if (memberIdsAsBigInt.length) {
              const submitterMembers = await this.memberPrisma.member.findMany({
                where: { userId: { in: memberIdsAsBigInt } },
                select: {
                  userId: true,
                  handle: true,
                  maxRating: { select: { rating: true } },
                },
              });

              submitterMembers.forEach((member) => {
                submitterMemberInfoById.set(member.userId.toString(), {
                  handle: member.handle ?? null,
                  maxRating: member.maxRating?.rating ?? null,
                });
              });
            }

            submissionMembers.forEach((entry) => {
              const profile = submitterMemberInfoById.get(entry.memberId);
              const handle =
                profile?.handle ?? submitterHandles.get(entry.memberId) ?? null;
              const maxRating = profile?.maxRating ?? null;
              submitterProfilesBySubmission.set(entry.submissionId, {
                handle,
                maxRating,
              });
            });
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `[getReviews] Failed to enrich submitter metadata: ${message}`,
          );
        }
      }

      const isPrivilegedRequester = authUser?.isMachine || isAdmin(authUser);

      const enrichedReviews = reviews.map((review) => {
        const reviewResourceId = String(review.resourceId ?? '');
        const reviewSubmissionId = String(review.submissionId ?? '');
        const isReviewerForReview = reviewerResourceIdSet.has(reviewResourceId);
        const isOwnSubmission =
          submitterSubmissionIdSet.has(reviewSubmissionId);
        const shouldMaskReviewDetails =
          !isPrivilegedRequester &&
          hasSubmitterRoleForChallenge &&
          submitterSubmissionIdSet.size > 0 &&
          !hasCopilotRoleForChallenge &&
          !isReviewerForReview &&
          isOwnSubmission &&
          !submitterVisibilityState.allowOwn;

        const sanitizedReview = {
          ...review,
          initialScore: shouldMaskReviewDetails ? null : review.initialScore,
          finalScore: shouldMaskReviewDetails ? null : review.finalScore,
          reviewItems: shouldMaskReviewDetails ? [] : review.reviewItems,
        };

        const profile = reviewerProfilesByResource.get(
          String(review.resourceId ?? ''),
        ) ?? {
          handle: null,
          maxRating: null,
        };
        const submissionKey = review.submissionId ?? '';
        const submitterProfile = shouldIncludeSubmitterMetadata
          ? (submitterProfilesBySubmission.get(submissionKey) ?? {
              handle: null,
              maxRating: null,
            })
          : undefined;
        const { submission: _submission, ...reviewData } = sanitizedReview;
        void _submission;
        const result = {
          ...(reviewData as ReviewResponseDto),
          reviewerHandle: profile.handle,
          reviewerMaxRating: profile.maxRating,
        } as ReviewResponseDto & {
          submitterHandle?: string | null;
          submitterMaxRating?: number | null;
        };
        if (shouldIncludeSubmitterMetadata) {
          result.submitterHandle = submitterProfile?.handle ?? null;
          result.submitterMaxRating = submitterProfile?.maxRating ?? null;
        }
        return result;
      });

      const totalCount = await this.prisma.review.count({
        where: reviewWhereClause,
      });

      this.logger.log(
        `Found ${reviews.length} reviews (page ${page} of ${Math.ceil(totalCount / perPage)})`,
      );

      return {
        data: enrichedReviews as ReviewResponseDto[],
        meta: {
          page,
          perPage,
          totalCount,
          totalPages: Math.ceil(totalCount / perPage),
        },
      };
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      const errorResponse = this.prismaErrorService.handleError(
        error,
        `fetching reviews with filters - status: ${status}, challengeId: ${challengeId}, submissionId: ${submissionId}`,
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  async getReview(
    authUser: JwtUser,
    reviewId: string,
  ): Promise<ReviewResponseDto> {
    this.logger.log(`Getting review with ID: ${reviewId}`);
    try {
      const data = await this.prisma.review.findUniqueOrThrow({
        where: { id: reviewId },
        include: {
          submission: {
            select: { id: true, challengeId: true, memberId: true },
          },
          reviewItems: {
            include: REVIEW_ITEM_COMMENTS_INCLUDE,
          },
        },
      });

      // Authorization for non-M2M, non-admin users
      if (!authUser?.isMachine && !isAdmin(authUser)) {
        const uid = String(authUser?.userId ?? '');
        const challengeId = data.submission?.challengeId;

        if (!challengeId) {
          throw new ForbiddenException({
            message:
              'Reviews without an associated challenge are not accessible to this user',
            code: 'FORBIDDEN_REVIEW_ACCESS',
            details: { reviewId },
          });
        }

        const challenge =
          await this.challengeApiService.getChallengeDetail(challengeId);

        let reviewerResources: ResourceInfo[] = [];
        let hasCopilotRole = false;
        try {
          const resources =
            await this.resourceApiService.getMemberResourcesRoles(
              challengeId,
              uid,
            );
          reviewerResources = resources.filter((r) => {
            const rn = (r.roleName || '').toLowerCase();
            return rn.includes('reviewer');
          });
          hasCopilotRole = resources.some((r) =>
            (r.roleName || '').toLowerCase().includes('copilot'),
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          this.logger.debug(
            `Failed to verify reviewer/copilot roles via Resource API: ${msg}`,
          );
        }

        if (reviewerResources.length > 0) {
          const reviewerResourceIds = new Set(
            reviewerResources.map((r) => String(r.id)),
          );
          const reviewResourceId = String(data.resourceId ?? '');

          if (
            challenge.status !== ChallengeStatus.COMPLETED &&
            !reviewerResourceIds.has(reviewResourceId)
          ) {
            throw new ForbiddenException({
              message:
                'Reviewers can only access their own reviews until the challenge is completed',
              code: 'FORBIDDEN_REVIEW_ACCESS_REVIEWER_SELF',
              details: { challengeId, reviewId, requester: uid },
            });
          }
        } else if (!hasCopilotRole) {
          // Confirm the user has actually submitted to this challenge (has a submission record)
          const mySubs = await this.prisma.submission.findMany({
            where: { challengeId, memberId: uid },
            select: { id: true },
          });
          if (mySubs.length === 0) {
            throw new ForbiddenException({
              message:
                'You must have submitted to this challenge to access this review',
              code: 'FORBIDDEN_REVIEW_ACCESS',
              details: { challengeId, reviewId, requester: uid },
            });
          }

          const visibility = this.getSubmitterVisibilityForChallenge(challenge);
          const isOwnSubmission = !!uid && data.submission?.memberId === uid;

          if (!visibility.allowOwn) {
            throw new ForbiddenException({
              message:
                'Reviews are not accessible for this challenge at the current phase',
              code: 'FORBIDDEN_REVIEW_ACCESS_PHASE',
              details: { challengeId, status: challenge.status },
            });
          }

          if (!visibility.allowAny && !isOwnSubmission) {
            throw new ForbiddenException({
              message:
                'Only reviews of your own submission are accessible during Appeals or Appeals Response',
              code: 'FORBIDDEN_REVIEW_ACCESS_OWN_ONLY',
              details: { challengeId, reviewId },
            });
          }
        }
      }

      this.logger.log(`Review found: ${reviewId}`);
      const result = data as any;
      delete result.submission;
      return result as ReviewResponseDto;
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      const errorResponse = this.prismaErrorService.handleError(
        error,
        `fetching review with ID: ${reviewId}`,
      );

      if (errorResponse.code === 'RECORD_NOT_FOUND') {
        throw new NotFoundException({
          message: `Review with ID ${reviewId} was not found. Please check the ID and try again.`,
          code: errorResponse.code,
          details: { reviewId },
        });
      }

      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  private getSubmitterVisibilityForChallenge(challenge?: {
    status?: ChallengeStatus;
    phases?: Array<{ name?: string | null; isOpen?: boolean | null }>;
  }): { allowAny: boolean; allowOwn: boolean } {
    if (!challenge) {
      return { allowAny: false, allowOwn: false };
    }

    const status = challenge.status;
    const phases = challenge.phases || [];

    const normalizeName = (phaseName: string | null | undefined) =>
      String(phaseName ?? '').toLowerCase();

    const appealsOpen = phases.some(
      (phase) => normalizeName(phase.name) === 'appeals' && phase.isOpen,
    );
    const appealsResponseOpen = phases.some(
      (phase) =>
        normalizeName(phase.name) === 'appeals response' && phase.isOpen,
    );

    const hasAppealsPhases = phases.some((phase) => {
      const name = normalizeName(phase.name);
      return name === 'appeals' || name === 'appeals response';
    });

    const iterativeReviewClosed = phases.some((phase) => {
      const name = normalizeName(phase.name);
      return name === 'iterative review' && phase.isOpen === false;
    });

    const allowAny = status === ChallengeStatus.COMPLETED;
    const allowOwn =
      allowAny ||
      appealsOpen ||
      appealsResponseOpen ||
      (!hasAppealsPhases && iterativeReviewClosed);

    return { allowAny, allowOwn };
  }

  async deleteReview(authUser: JwtUser | undefined, reviewId: string) {
    this.logger.log(`Deleting review with ID: ${reviewId}`);
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      select: {
        id: true,
        submission: {
          select: {
            challengeId: true,
          },
        },
      },
    });

    if (!review) {
      throw new NotFoundException({
        message: `Review with ID ${reviewId} was not found. Cannot delete non-existent review.`,
        code: 'RECORD_NOT_FOUND',
        details: { reviewId },
      });
    }

    await this.ensureReviewDeleteAccess(authUser, review);

    try {
      await this.prisma.review.delete({
        where: { id: reviewId },
      });
      this.logger.log(`Review deleted successfully: ${reviewId}`);
      return { message: `Review ${reviewId} deleted successfully.` };
    } catch (error) {
      const errorResponse = this.prismaErrorService.handleError(
        error,
        `deleting review with ID: ${reviewId}`,
      );

      if (errorResponse.code === 'RECORD_NOT_FOUND') {
        throw new NotFoundException({
          message: `Review with ID ${reviewId} was not found. Cannot delete non-existent review.`,
          code: errorResponse.code,
          details: { reviewId },
        });
      }

      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  async deleteReviewItem(authUser: JwtUser | undefined, itemId: string) {
    this.logger.log(`Deleting review item with ID: ${itemId}`);
    try {
      const existing = await this.prisma.reviewItem.findUnique({
        where: { id: itemId },
        select: {
          reviewId: true,
          review: {
            select: {
              id: true,
              resourceId: true,
              submission: {
                select: {
                  challengeId: true,
                },
              },
            },
          },
        },
      });

      if (!existing || !existing.review) {
        throw new NotFoundException({
          message: `Review item with ID ${itemId} was not found. Cannot delete non-existent item.`,
          code: 'RECORD_NOT_FOUND',
          details: { itemId },
        });
      }

      await this.ensureReviewItemChangeAccess(
        authUser,
        {
          id: existing.review.id,
          resourceId: existing.review.resourceId,
          submission: existing.review.submission,
        },
        {
          action: 'delete',
          itemId,
        },
      );

      const reviewId = existing.reviewId;
      await this.prisma.reviewItem.delete({
        where: { id: itemId },
      });
      if (reviewId) {
        await this.recomputeAndUpdateReviewScores(reviewId);
      }
      this.logger.log(`Review item deleted successfully: ${itemId}`);
      return { message: `Review item ${itemId} deleted successfully.` };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      const errorResponse = this.prismaErrorService.handleError(
        error,
        `deleting review item with ID: ${itemId}`,
      );

      if (errorResponse.code === 'RECORD_NOT_FOUND') {
        throw new NotFoundException({
          message: `Review item with ID ${itemId} was not found. Cannot delete non-existent item.`,
          code: errorResponse.code,
          details: { itemId },
        });
      }

      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  async getReviewProgress(
    challengeId: string,
  ): Promise<ReviewProgressResponseDto> {
    try {
      this.logger.log(
        `Calculating review progress for challenge ${challengeId}`,
      );

      if (
        !challengeId ||
        typeof challengeId !== 'string' ||
        challengeId.trim() === ''
      ) {
        throw new Error('Invalid challengeId parameter');
      }

      this.logger.debug('Fetching reviewers from Resource API');
      const resources = await this.resourceApiService.getResources({
        challengeId,
      });

      const resourceRoles = await this.resourceApiService.getResourceRoles();

      const reviewers = resources.filter((resource) => {
        const role = resourceRoles[resource.roleId];
        return role && role.name.toLowerCase().includes('reviewer');
      });

      const totalReviewers = reviewers.length;
      this.logger.debug(
        `Found ${totalReviewers} reviewers for challenge ${challengeId}`,
      );

      this.logger.debug('Fetching submissions for the challenge');
      const submissions = await this.prisma.submission.findMany({
        where: {
          challengeId,
          status: 'ACTIVE',
        },
      });

      const submissionIds = submissions.map((s) => s.id);
      const totalSubmissions = submissions.length;
      this.logger.debug(
        `Found ${totalSubmissions} submissions for challenge ${challengeId}`,
      );

      this.logger.debug('Fetching submitted reviews');
      const submittedReviews = await this.prisma.review.findMany({
        where: {
          submissionId: { in: submissionIds },
          committed: true,
        },
        include: {
          reviewItems: true,
        },
      });

      const totalSubmittedReviews = submittedReviews.length;
      this.logger.debug(`Found ${totalSubmittedReviews} submitted reviews`);

      let progressPercentage = 0;

      if (totalReviewers > 0 && totalSubmissions > 0) {
        const expectedTotalReviews = totalSubmissions * totalReviewers;
        progressPercentage =
          (totalSubmittedReviews / expectedTotalReviews) * 100;
        progressPercentage = Math.round(progressPercentage * 100) / 100;
      }

      if (progressPercentage > 100) {
        progressPercentage = 100;
      }

      const result: ReviewProgressResponseDto = {
        challengeId,
        totalReviewers,
        totalSubmissions,
        totalSubmittedReviews,
        progressPercentage,
        calculatedAt: new Date().toISOString(),
      };

      this.logger.log(
        `Review progress calculated: ${progressPercentage}% for challenge ${challengeId}`,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `Error calculating review progress for challenge ${challengeId}:`,
        error,
      );

      if (error?.message === 'Invalid challengeId parameter') {
        throw new Error('Invalid challengeId parameter');
      }

      if (error?.message === 'Cannot get data from Resource API.') {
        const statusCode = (error as Error & { statusCode?: number })
          .statusCode;
        if (statusCode === 400) {
          throw new BadRequestException({
            message: `Challenge ID ${challengeId} is not in valid GUID format`,
            code: 'INVALID_CHALLENGE_ID',
          });
        } else if (statusCode === 404) {
          throw new NotFoundException({
            message: `Challenge with ID ${challengeId} was not found`,
            code: 'CHALLENGE_NOT_FOUND',
          });
        }
      }

      if (error?.message && error.message.includes('not found')) {
        throw new NotFoundException({
          message: `Challenge with ID ${challengeId} was not found or has no data available`,
          code: 'CHALLENGE_NOT_FOUND',
        });
      }

      throw new InternalServerErrorException({
        message: 'Failed to calculate review progress',
        code: 'PROGRESS_CALCULATION_ERROR',
      });
    }
  }
}
