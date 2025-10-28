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
import { Prisma, ScorecardType, SubmissionType } from '@prisma/client';
import { PaginatedResponse, PaginationDto } from 'src/dto/pagination.dto';
import { PrismaService } from 'src/shared/modules/global/prisma.service';
import { PrismaErrorService } from 'src/shared/modules/global/prisma-error.service';
import { ResourceApiService } from 'src/shared/modules/global/resource.service';
import { ResourcePrismaService } from 'src/shared/modules/global/resource-prisma.service';
import {
  ChallengeApiService,
  ChallengeData,
} from 'src/shared/modules/global/challenge.service';
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

// Roles containing any of these keywords are treated as review-capable resources.
// This includes standard reviewers plus checkpoint screeners/reviewers/approvers.
const REVIEW_ACCESS_ROLE_KEYWORDS = [
  'reviewer',
  'screener',
  'approver',
  'approval',
];

type ReviewItemAccessMode = 'machine' | 'admin' | 'reviewer-owner' | 'copilot';

interface ReviewItemAccessResult {
  mode: ReviewItemAccessMode;
  hasReviewerRole: boolean;
  hasCopilotRole: boolean;
  ownsReview: boolean;
  requiresManagerComment: boolean;
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
        requiresManagerComment: false,
      };
    }

    if (isAdmin(requester)) {
      return {
        mode: 'admin',
        hasReviewerRole: false,
        hasCopilotRole: false,
        ownsReview: false,
        requiresManagerComment: true,
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
    let hasCopilotAccess = false;

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

      if (ownsReview) {
        mode = 'reviewer-owner';
      }
    }

    if (hasCopilotRole) {
      hasCopilotAccess = requesterResources?.some((resource) => {
        const normalizedRoleName = (resource.roleName || '').toLowerCase();
        const matchesRole = normalizedRoleName.includes('copilot');
        const matchesChallenge = challengeId
          ? resource.challengeId === challengeId
          : false;
        return matchesRole && matchesChallenge;
      });
    }

    if (!mode) {
      if (hasCopilotRole) {
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
      } else if (hasReviewerRole && !ownsReview) {
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
    }

    if (!mode) {
      mode = ownsReview ? 'reviewer-owner' : 'copilot';
    }

    const requiresManagerComment = mode === 'copilot';

    return {
      mode,
      hasReviewerRole,
      hasCopilotRole,
      ownsReview,
      requiresManagerComment,
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
    this.logger.log(
      `Creating review for submissionId: ${body.submissionId ?? 'N/A'}`,
    );
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

      const normalizedSubmissionId = body.submissionId
        ? String(body.submissionId).trim()
        : undefined;
      body.submissionId = normalizedSubmissionId;

      let submission: {
        id: string;
        challengeId: string | null;
        memberId: string | null;
        isLatest: boolean | null;
      } | null = null;
      let challengeId: string | undefined;
      let submissionMemberId: string | null = null;
      let submissionIsLatest = false;

      if (normalizedSubmissionId) {
        const submissions = await this.prisma.$queryRaw<
          Array<{
            id: string;
            challengeId: string | null;
            memberId: string | null;
            isLatest: boolean | null;
          }>
        >(Prisma.sql`
          WITH target AS (
            SELECT s."challengeId"
            FROM "submission" s
            WHERE s."id" = ${normalizedSubmissionId}
          )
          SELECT
            ranked."id",
            ranked."challengeId",
            ranked."memberId",
            ranked."isLatest"
          FROM (
            SELECT
              s."id",
              s."challengeId",
              s."memberId",
              CASE
                WHEN ROW_NUMBER() OVER (
                  PARTITION BY COALESCE(s."memberId", s."id")
                  ORDER BY
                    s."submittedDate" DESC NULLS LAST,
                    s."createdAt" DESC NULLS LAST,
                    s."updatedAt" DESC NULLS LAST,
                    s."id" DESC
                ) = 1 THEN TRUE
                ELSE FALSE
              END AS "isLatest"
            FROM "submission" s
            WHERE s."challengeId" IS NOT DISTINCT FROM (
              SELECT target."challengeId" FROM target
            )
          ) ranked
          WHERE ranked."id" = ${normalizedSubmissionId}
        `);

        submission = submissions[0] ?? null;

        if (!submission) {
          throw new NotFoundException({
            message: `Submission with ID ${normalizedSubmissionId} was not found. Please verify the submissionId and try again.`,
            code: 'SUBMISSION_NOT_FOUND',
            details: { submissionId: normalizedSubmissionId },
          });
        }

        if (!submission.challengeId) {
          throw new BadRequestException({
            message: `Submission ${normalizedSubmissionId} does not have an associated challengeId`,
            code: 'MISSING_CHALLENGE_ID',
          });
        }

        challengeId = submission.challengeId;
        submissionMemberId = submission.memberId
          ? String(submission.memberId)
          : null;
        submissionIsLatest = Boolean(submission.isLatest);
      }

      const reviewType = await this.prisma.reviewType.findUnique({
        where: { id: body.typeId },
        select: { name: true },
      });

      if (!reviewType) {
        throw new NotFoundException({
          message: `Review type with ID ${body.typeId} was not found. Please verify the typeId and try again.`,
          code: 'REVIEW_TYPE_NOT_FOUND',
          details: { typeId: body.typeId },
        });
      }

      const reviewTypeName = (reviewType.name ?? '').trim();
      const isPostMortemReview =
        /post[\s-]?mortem/i.test(reviewTypeName) ||
        reviewTypeName === 'Post Mortem';

      const providedResourceId = body.resourceId
        ? String(body.resourceId).trim()
        : undefined;

      let resourceRecord:
        | (Awaited<
            ReturnType<typeof this.resourcePrisma.resource.findUnique>
          > & { roleName?: string | null })
        | null = null;

      if (!challengeId) {
        if (!isPostMortemReview) {
          throw new BadRequestException({
            message:
              'submissionId is required unless creating a Post-Mortem review without submissions.',
            code: 'SUBMISSION_ID_REQUIRED',
          });
        }

        if (!providedResourceId) {
          throw new BadRequestException({
            message:
              'resourceId must be provided when creating a Post-Mortem review without a submission.',
            code: 'RESOURCE_ID_REQUIRED',
          });
        }

        resourceRecord = await this.resourcePrisma.resource.findUnique({
          where: { id: providedResourceId },
        });

        if (!resourceRecord) {
          throw new NotFoundException({
            message: `Resource with ID ${providedResourceId} was not found.`,
            code: 'RESOURCE_NOT_FOUND',
            details: { resourceId: providedResourceId },
          });
        }

        challengeId = String(resourceRecord.challengeId ?? '').trim();

        if (!challengeId) {
          throw new BadRequestException({
            message: `Resource ${providedResourceId} is not associated with a challenge.`,
            code: 'MISSING_CHALLENGE_ID',
            details: { resourceId: providedResourceId },
          });
        }
      }

      if (!challengeId) {
        throw new BadRequestException({
          message:
            'Unable to determine the challenge associated with this review request.',
          code: 'MISSING_CHALLENGE_ID',
        });
      }

      if (isPostMortemReview) {
        const postMortemOpen = await this.challengeApiService.isPhaseOpen(
          challengeId,
          'Post-Mortem',
        );

        if (!postMortemOpen) {
          throw new BadRequestException({
            message: `Post-Mortem phase is not currently open for challenge ${challengeId}.`,
            code: 'POST_MORTEM_PHASE_CLOSED',
            details: { challengeId },
          });
        }
      } else {
        await this.challengeApiService.validateReviewSubmission(challengeId);
      }

      const challengeResources = await this.resourceApiService.getResources({
        challengeId,
      });

      let resource: ResourceInfo | undefined;
      if (providedResourceId) {
        resource = challengeResources.find(
          (challengeResource) => challengeResource.id === providedResourceId,
        );

        if (!resource) {
          if (!resourceRecord) {
            resourceRecord = await this.resourcePrisma.resource.findUnique({
              where: { id: providedResourceId },
            });
          }

          if (!resourceRecord) {
            throw new NotFoundException({
              message: `Resource with ID ${providedResourceId} was not found for challenge ${challengeId}.`,
              code: 'RESOURCE_NOT_FOUND',
              details: {
                resourceId: providedResourceId,
                challengeId,
              },
            });
          }

          const resourceRecordAny = resourceRecord as Record<string, unknown>;

          const phaseIdValue =
            resourceRecordAny?.phaseId !== undefined
              ? resourceRecordAny.phaseId
              : undefined;

          let phaseIdString: string | undefined;
          if (typeof phaseIdValue === 'string') {
            phaseIdString = phaseIdValue;
          } else if (typeof phaseIdValue === 'number') {
            phaseIdString = phaseIdValue.toString();
          } else {
            phaseIdString = undefined;
          }

          const createdValue = (resourceRecordAny?.created ??
            (resourceRecord as { createdAt?: Date; created?: Date })
              .createdAt ??
            new Date()) as Date | string;

          resource = {
            id: resourceRecord.id,
            challengeId: String(resourceRecord.challengeId ?? ''),
            memberId: String(resourceRecord.memberId ?? ''),
            memberHandle: String(resourceRecord.memberHandle ?? ''),
            roleId: String(resourceRecord.roleId ?? ''),
            phaseId: phaseIdString,
            createdBy: String(resourceRecord.createdBy ?? ''),
            created: createdValue,
            roleName:
              resourceRecordAny.roleName !== undefined
                ? (resourceRecordAny.roleName as string | undefined)
                : undefined,
          };
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

      if (
        submission &&
        this.shouldEnforceLatestSubmissionForReview(
          reviewType.name,
          challenge,
        ) &&
        submissionMemberId &&
        !submissionIsLatest
      ) {
        throw new BadRequestException({
          message:
            'Reviews can only be created for the most recent submission per member when the challenge does not allow unlimited submissions.',
          code: 'SUBMISSION_NOT_LATEST',
          details: {
            submissionId: body.submissionId,
            challengeId,
            memberId: submissionMemberId,
            reviewType: reviewType.name,
            isLatest: submissionIsLatest,
          },
        });
      }

      const challengePhases = challenge?.phases ?? [];
      const resolvePhaseId = (phase: (typeof challengePhases)[number]) =>
        String((phase as any)?.id ?? (phase as any)?.phaseId ?? '');

      const normalized = (value: string | undefined | null) =>
        (value ?? '').toLowerCase().replace(/[\s_-]+/g, '');

      const targetPhaseKeys = isPostMortemReview
        ? ['postmortem']
        : ['review', 'iterativereview'];

      const targetPhase = challengePhases.find((phase) =>
        targetPhaseKeys.some((key) => normalized(phase?.name) === key),
      );

      const reviewPhaseName = targetPhase?.name ?? null;

      if (!targetPhase) {
        throw new BadRequestException({
          message: isPostMortemReview
            ? `Challenge ${challengeId} does not have a Post-Mortem phase.`
            : `Challenge ${challengeId} does not have a Review phase.`,
          code: isPostMortemReview
            ? 'POST_MORTEM_PHASE_NOT_FOUND'
            : 'REVIEW_PHASE_NOT_FOUND',
          details: {
            challengeId,
          },
        });
      }

      const reviewPhaseId = resolvePhaseId(targetPhase);

      if (!reviewPhaseId) {
        throw new BadRequestException({
          message: isPostMortemReview
            ? `Post-Mortem phase for challenge ${challengeId} is missing an identifier.`
            : `Review phase for challenge ${challengeId} is missing an identifier.`,
          code: isPostMortemReview
            ? 'POST_MORTEM_PHASE_NOT_FOUND'
            : 'REVIEW_PHASE_NOT_FOUND',
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
          message: `Resource ${resource.id} is associated with phase ${resourcePhaseId}, which does not match the ${reviewPhaseName ?? 'target'} phase ${reviewPhaseId}.`,
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
      prismaBody.submissionId = body.submissionId ?? null;
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
      const flattenedAppeals: any[] = [];
      try {
        for (const item of reviewToReturn.reviewItems ?? []) {
          for (const comment of item.reviewItemComments ?? []) {
            if (comment?.appeal) {
              flattenedAppeals.push(comment.appeal);
            }
          }
        }
      } catch {
        // ignore
      }
      return {
        ...reviewToReturn,
        initialScore: scores.initialScore,
        finalScore: scores.finalScore,
        appeals: flattenedAppeals,
        phaseName: reviewPhaseName,
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
        `creating review for submissionId: ${body.submissionId ?? 'N/A'}`,
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
    const challengeCache = new Map<string, ChallengeData | null>();
    let challengeDetailForPhase: ChallengeData | null = null;
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
    const requestedStatusValue = (body as ReviewPatchRequestDto).status;
    const requestedStatus =
      typeof requestedStatusValue === 'string' &&
      (Object.values(ReviewStatus) as string[]).includes(requestedStatusValue)
        ? requestedStatusValue
        : undefined;
    const requestedCommittedValue = (body as ReviewPatchRequestDto).committed;
    const requestedCommitted =
      typeof requestedCommittedValue === 'boolean'
        ? requestedCommittedValue
        : undefined;
    const reopenStatuses = new Set<ReviewStatus>([
      ReviewStatus.IN_PROGRESS,
      ReviewStatus.PENDING,
    ]);
    const isReopenStatusRequested =
      requestedStatus !== undefined && reopenStatuses.has(requestedStatus);
    const isReopenTransition =
      existingReview.status === ReviewStatus.COMPLETED &&
      isReopenStatusRequested;
    const isCopilotReopenPayload =
      isReopenTransition &&
      definedBodyKeys.includes('status') &&
      definedBodyKeys.every(
        (field) => field === 'status' || field === 'committed',
      ) &&
      (requestedCommitted === undefined || requestedCommitted === false);

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
        hasCopilotRole &&
        !ownsReview &&
        (isStatusOnlyUpdate || isCopilotReopenPayload);

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
      try {
        challengeDetailForPhase =
          await this.challengeApiService.getChallengeDetail(challengeId);
        challengeCache.set(challengeId, challengeDetailForPhase);
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

      if (
        challengeDetailForPhase &&
        challengeDetailForPhase.status === ChallengeStatus.COMPLETED
      ) {
        throw new ForbiddenException({
          message:
            'Reviews for challenges in COMPLETED status cannot be updated.  Only an admin can update a review once the challenge is complete.',
          code: 'REVIEW_UPDATE_FORBIDDEN_CHALLENGE_COMPLETED',
          details: { reviewId: id, challengeId },
        });
      }
    }

    if (
      isReopenTransition &&
      challengeId &&
      existingReview.phaseId !== undefined &&
      existingReview.phaseId !== null
    ) {
      const normalizedPhaseId = String(existingReview.phaseId);

      if (!challengeDetailForPhase) {
        if (challengeCache.has(challengeId)) {
          challengeDetailForPhase = challengeCache.get(challengeId) ?? null;
        } else {
          try {
            challengeDetailForPhase =
              await this.challengeApiService.getChallengeDetail(challengeId);
            challengeCache.set(challengeId, challengeDetailForPhase);
          } catch (error) {
            this.logger.error(
              `[updateReview] Unable to verify phase ${normalizedPhaseId} for review ${id} on challenge ${challengeId}`,
              error,
            );
            throw new InternalServerErrorException({
              message:
                'Unable to verify the phase status for this review. Please try again later.',
              code: 'CHALLENGE_PHASE_STATUS_UNAVAILABLE',
              details: {
                reviewId: id,
                challengeId,
                phaseId: normalizedPhaseId,
              },
            });
          }
        }
      }

      const matchingPhase =
        challengeDetailForPhase?.phases?.find((phase) => {
          if (!phase) {
            return false;
          }
          const candidateIds = [
            String((phase as any).id ?? ''),
            String((phase as any).phaseId ?? ''),
          ].filter((value) => value.length > 0);
          return candidateIds.includes(normalizedPhaseId);
        }) ?? null;

      if (
        matchingPhase &&
        matchingPhase.actualEndTime &&
        matchingPhase.isOpen === false
      ) {
        throw new ForbiddenException({
          message:
            'Reviews associated with closed challenge phases cannot be reopened to Pending or In Progress.',
          code: 'REVIEW_UPDATE_FORBIDDEN_PHASE_CLOSED',
          details: {
            reviewId: id,
            challengeId,
            phaseId: normalizedPhaseId,
          },
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

    if (isReopenTransition) {
      updateData.committed = false;
      updateData.initialScore = null;
      updateData.finalScore = null;
      if (updateData.reviewDate === undefined) {
        updateData.reviewDate = null;
      }
    }

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
      const recomputedScores = isReopenTransition
        ? null
        : await this.recomputeAndUpdateReviewScores(id);
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

      // Attach flattened appeals to response
      const flattenedAppeals: any[] = [];
      try {
        for (const item of responsePayload.reviewItems ?? []) {
          for (const comment of item.reviewItemComments ?? []) {
            if (comment?.appeal) {
              flattenedAppeals.push(comment.appeal);
            }
          }
        }
      } catch {
        // ignore
      }
      (responsePayload as any).appeals = flattenedAppeals;
      (responsePayload as any).phaseName =
        await this.resolvePhaseNameFromChallenge({
          challengeId,
          phaseId: responsePayload.phaseId ?? null,
          challengeCache,
        });

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

      const existingFinalAnswer =
        existingItem.finalAnswer ?? existingItem.initialAnswer ?? null;
      const finalAnswerChanged =
        body.finalAnswer !== undefined &&
        body.finalAnswer !== existingFinalAnswer;
      const managerCommentChanged =
        body.managerComment !== undefined &&
        body.managerComment !== (existingItem.managerComment ?? null);

      if (access.mode === 'copilot') {
        const forbiddenFields: string[] = [];

        if (!finalAnswerChanged && managerCommentChanged) {
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

      if (access.requiresManagerComment && finalAnswerChanged) {
        const managerComment =
          typeof body.managerComment === 'string'
            ? body.managerComment.trim()
            : '';

        if (!managerComment) {
          throw new BadRequestException({
            message:
              'A manager comment is required when updating the score for this review item.',
            code: 'REVIEW_ITEM_UPDATE_MANAGER_COMMENT_REQUIRED',
            details: {
              reviewId: review.id,
              itemId,
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
    thin?: boolean,
  ): Promise<PaginatedResponse<ReviewResponseDto>> {
    const isThin = Boolean(thin);
    this.logger.log(
      `Getting reviews with filters - status: ${status}, challengeId: ${challengeId}, submissionId: ${submissionId}, thin: ${isThin}`,
    );

    const { page = 1, perPage = 10 } = paginationDto || {};
    const skip = (page - 1) * perPage;

    try {
      const reviewWhereClause: any = {};
      let challengeDetail: ChallengeData | null = null;
      let challengeScopedFilter: Prisma.reviewWhereInput | null = null;
      let requesterIsChallengeResource = false;
      const reviewerResourceIdSet = new Set<string>();
      const submitterSubmissionIdSet = new Set<string>();
      let hasCopilotRoleForChallenge = false;
      let hasSubmitterRoleForChallenge = false;
      let submitterVisibilityState = {
        allowAny: false,
        allowOwn: false,
      };
      const allowLimitedVisibilityForOtherSubmissions = false;

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

        const hasDirectSubmissionFilter = Boolean(submissionId);

        const submissions = await this.prisma.submission.findMany({
          where: { challengeId },
          select: { id: true },
        });

        const submissionIds = submissions.map((s) => s.id);
        const challengeFilters: Prisma.reviewWhereInput[] = [];

        if (!hasDirectSubmissionFilter && submissionIds.length > 0) {
          challengeFilters.push({ submissionId: { in: submissionIds } });
        }

        if (!challengeDetail) {
          try {
            challengeDetail =
              await this.challengeApiService.getChallengeDetail(challengeId);
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            this.logger.debug(
              `[getReviews] Unable to fetch challenge detail for phase filtering: ${message}`,
            );
            challengeDetail = null;
          }
        }

        if (challengeDetail?.phases?.length) {
          const phaseIds = new Set<string>();
          for (const phase of challengeDetail.phases ?? []) {
            if (!phase) {
              continue;
            }
            const candidates = [
              String((phase as any).id ?? '').trim(),
              String((phase as any).phaseId ?? '').trim(),
            ].filter((value) => value.length > 0);

            for (const candidate of candidates) {
              phaseIds.add(candidate);
            }
          }

          if (phaseIds.size > 0) {
            challengeFilters.push({ phaseId: { in: Array.from(phaseIds) } });
          }
        }

        if (!hasDirectSubmissionFilter && challengeFilters.length === 0) {
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

        if (challengeFilters.length === 1) {
          challengeScopedFilter = challengeFilters[0];
        } else if (challengeFilters.length > 1) {
          challengeScopedFilter = { OR: challengeFilters };
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
            normalized.forEach((r) => {
              const roleName = (r.roleName || '').toLowerCase();
              if (
                REVIEW_ACCESS_ROLE_KEYWORDS.some((keyword) =>
                  roleName.includes(keyword),
                )
              ) {
                reviewerResourceIdSet.add(r.id);
              }
            });
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
            const reviewerResourceIds = Array.from(reviewerResourceIdSet);
            const reviewerResources = normalized.filter((resource) =>
              reviewerResourceIdSet.has(resource.id),
            );
            let challengeCompletedOrCancelled = false;
            if (challengeId && !challengeDetail) {
              try {
                challengeDetail =
                  await this.challengeApiService.getChallengeDetail(
                    challengeId,
                  );
              } catch (error) {
                const message =
                  error instanceof Error ? error.message : String(error);
                this.logger.debug(
                  `[getReviews] Unable to fetch challenge ${challengeId} for reviewer screening access: ${message}`,
                );
              }
            }

            if (challengeDetail) {
              challengeCompletedOrCancelled = this.isCompletedOrCancelledStatus(
                challengeDetail.status,
              );
            }

            if (challengeCompletedOrCancelled) {
              // Completed or cancelled challenges should expose all reviews to reviewers.
            } else if (challengeId) {
              const reviewerRoleFilter = this.buildReviewerRoleFilters(
                reviewerResources,
                challengeDetail,
                challengeCompletedOrCancelled,
              );

              if (reviewerRoleFilter) {
                const roleOr = reviewerRoleFilter.OR;
                if (roleOr) {
                  const normalizedOr = Array.isArray(roleOr)
                    ? roleOr
                    : [roleOr];
                  const existingOr = reviewWhereClause.OR;
                  if (Array.isArray(existingOr)) {
                    reviewWhereClause.OR = [...existingOr, ...normalizedOr];
                  } else if (existingOr) {
                    reviewWhereClause.OR = [existingOr, ...normalizedOr];
                  } else {
                    reviewWhereClause.OR = normalizedOr;
                  }
                }

                Object.entries(reviewerRoleFilter).forEach(([key, value]) => {
                  if (key === 'OR' || value === undefined) {
                    return;
                  }
                  reviewWhereClause[key] = value;
                });
              } else {
                restrictToResourceIds(reviewerResourceIds);
              }
            } else {
              restrictToResourceIds(reviewerResourceIds);
            }
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
            const submitterReviewPhaseNames = [
              'checkpoint screening',
              'checkpoint review',
              'screening',
              'review',
              'iterative review',
            ];
            const reviewPhasesCompleted = this.hasChallengePhaseCompleted(
              challenge,
              submitterReviewPhaseNames,
            );
            const challengeCompletedOrCancelled =
              this.isCompletedOrCancelledStatus(challenge.status);
            const isMarathonMatch = this.isMarathonMatchChallenge(challenge);
            const mySubmissionIds = mySubs.map((s) => s.id);
            mySubmissionIds.forEach((id) => submitterSubmissionIdSet.add(id));
            submitterVisibilityState =
              this.getSubmitterVisibilityForChallenge(challenge);

            if (!requesterIsChallengeResource && mySubs.length > 0) {
              requesterIsChallengeResource = true;
            }

            if (challengeCompletedOrCancelled) {
              const hasPassingSubmission =
                await this.hasPassingSubmissionForReviewScorecard(
                  challengeId,
                  uid,
                );

              if (!hasPassingSubmission) {
                restrictToSubmissionIds(mySubmissionIds);
              }
            } else if (isMarathonMatch) {
              if (
                appealsOpen ||
                appealsResponseOpen ||
                (challenge.status === ChallengeStatus.ACTIVE &&
                  submissionPhaseClosed &&
                  hasSubmitterRoleForChallenge)
              ) {
                restrictToSubmissionIds(mySubmissionIds);
              } else if (
                hasSubmitterRoleForChallenge &&
                reviewPhasesCompleted
              ) {
                // Marathon submitters can still inspect their own reviews once an allowed review phase completes.
                restrictToSubmissionIds(mySubmissionIds);
              } else {
                this.logger.debug(
                  `[getReviews] Challenge ${challengeId} is in status ${challenge.status}. Returning empty review list for requester ${uid}.`,
                );
                restrictToSubmissionIds([]);
              }
            } else if (
              hasSubmitterRoleForChallenge &&
              (appealsOpen ||
                appealsResponseOpen ||
                submissionPhaseClosed ||
                reviewPhasesCompleted)
            ) {
              // Non-marathon submitters can only inspect their own submissions until completion/cancellation.
              restrictToSubmissionIds(mySubmissionIds);
            } else {
              // Reviews exist but the phase does not allow visibility yet; respond with no results.
              this.logger.debug(
                `[getReviews] Challenge ${challengeId} is in status ${challenge.status}. Returning empty review list for requester ${uid}.`,
              );
              restrictToSubmissionIds([]);
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
                .filter((challenge) => {
                  const status = challenge.status;
                  if (!status) {
                    return false;
                  }
                  const statusString = String(status);
                  return (
                    status === ChallengeStatus.COMPLETED ||
                    status === ChallengeStatus.CANCELLED ||
                    statusString.startsWith('CANCELLED_')
                  );
                })
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
              const mySubsByChallenge = new Map<string, string[]>();

              for (const sub of mySubs) {
                const subChallengeId = sub.challengeId;
                if (!subChallengeId) {
                  continue;
                }
                const existing = mySubsByChallenge.get(subChallengeId);
                if (existing) {
                  existing.push(sub.id);
                } else {
                  mySubsByChallenge.set(subChallengeId, [sub.id]);
                }
              }

              // For completed challenges, allow all submissions only when the member has a passing submission
              for (const completedId of completedIds) {
                const hasPassingSubmission =
                  await this.hasPassingSubmissionForReviewScorecard(
                    completedId,
                    uid,
                  );

                if (hasPassingSubmission) {
                  const subs = await this.prisma.submission.findMany({
                    where: { challengeId: completedId },
                    select: { id: true },
                  });
                  subs.forEach((s) => allowed.add(s.id));
                } else {
                  const ownSubmissions =
                    mySubsByChallenge.get(completedId) ?? [];
                  ownSubmissions.forEach((id) => allowed.add(id));
                }
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
        ].includes(challengeDetail.status) &&
        (isAdmin(authUser) || requesterIsChallengeResource);

      const whereAndClauses: Prisma.reviewWhereInput[] = [];
      if (Object.keys(reviewWhereClause).length > 0) {
        whereAndClauses.push(reviewWhereClause);
      }
      if (challengeScopedFilter) {
        whereAndClauses.push(challengeScopedFilter);
      }
      const finalWhereClause: Prisma.reviewWhereInput =
        whereAndClauses.length === 0
          ? {}
          : whereAndClauses.length === 1
            ? whereAndClauses[0]
            : { AND: whereAndClauses };

      this.logger.debug(`Fetching reviews with where clause:`);
      this.logger.debug(finalWhereClause);

      const reviewInclude: Prisma.reviewInclude = {
        submission: {
          select: { id: true, memberId: true, challengeId: true },
        },
      };

      if (!isThin) {
        reviewInclude.reviewItems = {
          include: REVIEW_ITEM_COMMENTS_INCLUDE,
        };
      }

      const reviews = await this.prisma.review.findMany({
        where: finalWhereClause,
        skip,
        take: perPage,
        include: reviewInclude,
      });

      const challengeCache = new Map<string, ChallengeData | null>();
      if (challengeId && challengeDetail?.id) {
        challengeCache.set(challengeId, challengeDetail);
      }

      const challengeIdsToFetch = new Set<string>();
      for (const review of reviews) {
        const reviewChallengeId = review.submission?.challengeId;
        if (
          typeof reviewChallengeId === 'string' &&
          reviewChallengeId.trim().length > 0 &&
          !challengeCache.has(reviewChallengeId)
        ) {
          challengeIdsToFetch.add(reviewChallengeId);
        }
      }

      if (challengeIdsToFetch.size) {
        try {
          const challengeDetails = await this.challengeApiService.getChallenges(
            Array.from(challengeIdsToFetch),
          );
          challengeDetails.forEach((detail) => {
            if (detail?.id) {
              challengeCache.set(detail.id, detail);
            }
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `[getReviews] Failed to prefetch challenge phase data: ${message}`,
          );
        }
      }

      const phaseNameCache = new Map<string, string | null>();
      for (const review of reviews) {
        const phaseIdValue = review.phaseId
          ? String(review.phaseId).trim()
          : '';
        if (!phaseIdValue || phaseNameCache.has(phaseIdValue)) {
          continue;
        }
        const reviewChallengeId =
          review.submission?.challengeId ?? challengeId ?? null;
        const resolvedPhaseName = await this.resolvePhaseNameFromChallenge({
          challengeId: reviewChallengeId,
          phaseId: phaseIdValue,
          challengeCache,
        });
        phaseNameCache.set(phaseIdValue, resolvedPhaseName);
      }

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

        const reviewPhaseId = review.phaseId ? String(review.phaseId) : '';
        const phaseName = reviewPhaseId
          ? (phaseNameCache.get(reviewPhaseId) ?? null)
          : null;
        const normalizedPhaseName = this.normalizePhaseName(phaseName);

        const reviewChallengeId =
          review.submission?.challengeId ?? challengeId ?? null;
        const challengeForReview = reviewChallengeId
          ? (challengeCache.get(reviewChallengeId) ?? null)
          : null;
        const screeningPhaseCompleted = this.hasChallengePhaseCompleted(
          challengeForReview,
          ['screening'],
        );
        const checkpointReviewPhaseCompleted = this.hasChallengePhaseCompleted(
          challengeForReview,
          ['checkpoint review'],
        );
        const reviewPhaseCompleted = this.hasChallengePhaseCompleted(
          challengeForReview,
          ['review'],
        );
        const iterativeReviewPhaseCompleted = this.hasChallengePhaseCompleted(
          challengeForReview,
          ['iterative review'],
        );
        const phaseNamesForCompletionCheck: string[] = [];
        if (phaseName && phaseName.trim().length > 0) {
          phaseNamesForCompletionCheck.push(phaseName);
        } else if (normalizedPhaseName.length > 0) {
          phaseNamesForCompletionCheck.push(normalizedPhaseName);
        }
        const phaseCompletedForResolvedNames =
          phaseNamesForCompletionCheck.length > 0 &&
          this.hasChallengePhaseCompleted(
            challengeForReview,
            phaseNamesForCompletionCheck,
          );
        const allowOwnScreeningVisibility =
          !isPrivilegedRequester &&
          hasSubmitterRoleForChallenge &&
          !hasCopilotRoleForChallenge &&
          !isReviewerForReview &&
          isOwnSubmission &&
          screeningPhaseCompleted &&
          normalizedPhaseName === 'screening';
        const allowOwnCheckpointReviewVisibility =
          !isPrivilegedRequester &&
          hasSubmitterRoleForChallenge &&
          !hasCopilotRoleForChallenge &&
          !isReviewerForReview &&
          isOwnSubmission &&
          checkpointReviewPhaseCompleted &&
          normalizedPhaseName === 'checkpoint review';
        const allowOwnReviewVisibility =
          !isPrivilegedRequester &&
          hasSubmitterRoleForChallenge &&
          !hasCopilotRoleForChallenge &&
          !isReviewerForReview &&
          isOwnSubmission &&
          reviewPhaseCompleted &&
          normalizedPhaseName === 'review';
        const allowOwnIterativeReviewVisibility =
          !isPrivilegedRequester &&
          hasSubmitterRoleForChallenge &&
          !hasCopilotRoleForChallenge &&
          !isReviewerForReview &&
          isOwnSubmission &&
          iterativeReviewPhaseCompleted &&
          normalizedPhaseName === 'iterative review';
        const allowOwnClosedPhaseVisibility =
          !isPrivilegedRequester &&
          hasSubmitterRoleForChallenge &&
          !hasCopilotRoleForChallenge &&
          !isReviewerForReview &&
          isOwnSubmission &&
          phaseCompletedForResolvedNames;
        const shouldMaskReviewDetails =
          !allowOwnScreeningVisibility &&
          !allowOwnCheckpointReviewVisibility &&
          !allowOwnReviewVisibility &&
          !allowOwnIterativeReviewVisibility &&
          !allowOwnClosedPhaseVisibility &&
          !isPrivilegedRequester &&
          hasSubmitterRoleForChallenge &&
          submitterSubmissionIdSet.size > 0 &&
          !hasCopilotRoleForChallenge &&
          !isReviewerForReview &&
          isOwnSubmission &&
          !submitterVisibilityState.allowOwn;
        const shouldLimitNonOwnerVisibility =
          allowLimitedVisibilityForOtherSubmissions &&
          !isPrivilegedRequester &&
          hasSubmitterRoleForChallenge &&
          submitterSubmissionIdSet.size > 0 &&
          !hasCopilotRoleForChallenge &&
          !isReviewerForReview &&
          !isOwnSubmission &&
          !submitterVisibilityState.allowAny;

        const challengeStatusForReview =
          challengeForReview?.status ?? challengeDetail?.status ?? null;
        const shouldMaskOtherReviewerDetails =
          !isPrivilegedRequester &&
          reviewerResourceIdSet.size > 0 &&
          !isReviewerForReview &&
          !this.isCompletedOrCancelledStatus(challengeStatusForReview) &&
          normalizedPhaseName !== 'screening' &&
          normalizedPhaseName !== 'checkpoint screening';

        const sanitizeScores =
          shouldMaskReviewDetails ||
          shouldLimitNonOwnerVisibility ||
          shouldMaskOtherReviewerDetails;
        const sanitizedReview: typeof review & {
          reviewItems?: typeof review.reviewItems;
        } = {
          ...review,
          initialScore: sanitizeScores ? null : review.initialScore,
          finalScore: sanitizeScores ? null : review.finalScore,
        };

        const shouldTrimIterativeReviewForOtherSubmitters =
          !isPrivilegedRequester &&
          submitterSubmissionIdSet.size > 0 &&
          !hasCopilotRoleForChallenge &&
          !isReviewerForReview &&
          !isOwnSubmission &&
          normalizedPhaseName === 'iterative review' &&
          this.isFirst2FinishChallenge(challengeForReview);
        const shouldStripOtherReviewerContent =
          shouldMaskOtherReviewerDetails &&
          !['screening', 'checkpoint screening'].includes(
            normalizedPhaseName ?? '',
          );
        const shouldStripReviewItems =
          shouldMaskReviewDetails ||
          shouldTrimIterativeReviewForOtherSubmitters ||
          shouldLimitNonOwnerVisibility ||
          shouldStripOtherReviewerContent;

        if (!isThin) {
          sanitizedReview.reviewItems = shouldStripReviewItems
            ? []
            : (review.reviewItems ?? []);
        } else {
          delete (sanitizedReview as any).reviewItems;
        }

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
        result.phaseName = phaseName;
        if (!isThin) {
          // Flatten appeals across all review item comments for convenience
          const flattenedAppeals: any[] = [];
          try {
            const itemsWithComments = (sanitizedReview.reviewItems ??
              []) as Array<{
              reviewItemComments?: Array<{ appeal?: unknown }>;
            }>;
            for (const item of itemsWithComments) {
              for (const comment of item.reviewItemComments ?? []) {
                if (comment?.appeal) {
                  flattenedAppeals.push(comment.appeal);
                }
              }
            }
          } catch {
            // Non-fatal; leave appeals empty on any unexpected structure
          }
          (result as any).appeals = flattenedAppeals;
        } else {
          delete (result as any).appeals;
        }
        if (shouldIncludeSubmitterMetadata) {
          result.submitterHandle = submitterProfile?.handle ?? null;
          result.submitterMaxRating = submitterProfile?.maxRating ?? null;
        }
        if (shouldLimitNonOwnerVisibility) {
          delete (result as any).finalScore;
          delete (result as any).initialScore;
          result.submitterHandle = null;
          result.submitterMaxRating = null;
          if (!isThin) {
            (result as any).appeals = [];
          } else {
            delete (result as any).appeals;
          }
          delete (result as any).metadata;
          delete (result as any).typeId;
          delete (result as any).committed;
        }
        return result;
      });

      const totalCount = await this.prisma.review.count({
        where: finalWhereClause,
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

      const reviewResourceId = String(data.resourceId ?? '').trim();
      let challengeId: string | null = null;

      if (data.submission?.challengeId) {
        const normalizedChallengeId = String(
          data.submission.challengeId,
        ).trim();
        challengeId = normalizedChallengeId.length
          ? normalizedChallengeId
          : null;
      }

      if (!challengeId && reviewResourceId.length) {
        try {
          const resourceRecord = await this.resourcePrisma.resource.findUnique({
            where: { id: reviewResourceId },
            select: { challengeId: true },
          });

          const resourceChallengeId = String(
            resourceRecord?.challengeId ?? '',
          ).trim();
          if (resourceChallengeId.length) {
            challengeId = resourceChallengeId;
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.debug(
            `[getReview] Failed to resolve challengeId via resource ${reviewResourceId}: ${message}`,
          );
        }
      }

      const challengeCache = new Map<string, ChallengeData | null>();
      const isPrivilegedRequester = authUser?.isMachine || isAdmin(authUser);
      let resolvedPhaseName: string | null = null;
      let challengeDetail: ChallengeData | null = null;
      let hasCopilotRole = false;
      let hasReviewerRoleResource = false;
      let reviewerResourceIds = new Set<string>();
      let isReviewerForReview = false;
      let isSubmitterForChallenge = false;

      // Authorization for non-M2M, non-admin users
      if (!authUser?.isMachine && !isAdmin(authUser)) {
        const uid = String(authUser?.userId ?? '');

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
        challengeCache.set(challengeId, challenge);
        challengeDetail = challenge;

        let reviewerResources: ResourceInfo[] = [];
        try {
          const resources =
            await this.resourceApiService.getMemberResourcesRoles(
              challengeId,
              uid,
            );
          reviewerResources = resources.filter((r) => {
            const roleName = (r.roleName || '').toLowerCase();
            return REVIEW_ACCESS_ROLE_KEYWORDS.some((keyword) =>
              roleName.includes(keyword),
            );
          });
          hasReviewerRoleResource = reviewerResources.some((resource) =>
            (resource.roleName || '').toLowerCase().includes('reviewer'),
          );
          hasCopilotRole = resources.some((r) =>
            (r.roleName || '').toLowerCase().includes('copilot'),
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          this.logger.debug(
            `Failed to verify reviewer/copilot roles via Resource API: ${msg}`,
          );
        }

        reviewerResourceIds = new Set(
          reviewerResources
            .map((r) => String(r.id ?? '').trim())
            .filter((id) => id.length > 0),
        );
        isReviewerForReview = reviewerResourceIds.has(reviewResourceId);

        if (reviewerResources.length > 0) {
          const challengeInFinalState = [
            ChallengeStatus.COMPLETED,
            ChallengeStatus.CANCELLED_FAILED_REVIEW,
          ].includes(challenge.status);
          if (!resolvedPhaseName && data.phaseId && challengeId) {
            resolvedPhaseName = await this.resolvePhaseNameFromChallenge({
              challengeId,
              phaseId: data.phaseId,
              challengeCache,
            });
          }
          const normalizedReviewerPhase =
            this.normalizePhaseName(resolvedPhaseName);
          const isScreeningPhaseForReviewer =
            hasReviewerRoleResource &&
            (normalizedReviewerPhase === 'screening' ||
              normalizedReviewerPhase === 'checkpoint screening');
          if (
            !challengeInFinalState &&
            !reviewerResourceIds.has(reviewResourceId) &&
            !isScreeningPhaseForReviewer
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
          isSubmitterForChallenge = mySubs.length > 0;
          if (!isSubmitterForChallenge) {
            throw new ForbiddenException({
              message:
                'You must have submitted to this challenge to access this review',
              code: 'FORBIDDEN_REVIEW_ACCESS',
              details: { challengeId, reviewId, requester: uid },
            });
          }

          const visibility = this.getSubmitterVisibilityForChallenge(challenge);
          const isOwnSubmission = !!uid && data.submission?.memberId === uid;

          resolvedPhaseName = await this.resolvePhaseNameFromChallenge({
            challengeId,
            phaseId: data.phaseId ?? null,
            challengeCache,
          });
          const normalizedPhaseNameForAccess =
            this.normalizePhaseName(resolvedPhaseName);
          const phaseNamesForAccessCheck: string[] = [];
          if (resolvedPhaseName && resolvedPhaseName.trim().length > 0) {
            phaseNamesForAccessCheck.push(resolvedPhaseName);
          } else if (normalizedPhaseNameForAccess.length > 0) {
            phaseNamesForAccessCheck.push(normalizedPhaseNameForAccess);
          }
          const canSeeOwnScreeningReview =
            isOwnSubmission &&
            normalizedPhaseNameForAccess === 'screening' &&
            this.hasChallengePhaseCompleted(challenge, ['screening']);
          const canSeeOwnCheckpointReview =
            isOwnSubmission &&
            normalizedPhaseNameForAccess === 'checkpoint review' &&
            this.hasChallengePhaseCompleted(challenge, ['checkpoint review']);
          const canSeeOwnClosedPhaseReview =
            isOwnSubmission &&
            phaseNamesForAccessCheck.length > 0 &&
            this.hasChallengePhaseCompleted(
              challenge,
              phaseNamesForAccessCheck,
            );

          if (
            !visibility.allowOwn &&
            !canSeeOwnScreeningReview &&
            !canSeeOwnCheckpointReview &&
            !canSeeOwnClosedPhaseReview
          ) {
            throw new ForbiddenException({
              message:
                'Reviews are not accessible for this challenge at the current phase',
              code: 'FORBIDDEN_REVIEW_ACCESS_PHASE',
              details: { challengeId, status: challenge.status },
            });
          }

          const isFirst2Finish = this.isFirst2FinishChallenge(challenge);
          if (!visibility.allowAny && !isOwnSubmission && !isFirst2Finish) {
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
      const result = { ...(data as any) };
      delete result.submission;
      // Flatten appeals across all review item comments for convenience
      const flattenedAppeals: any[] = [];
      try {
        for (const item of result.reviewItems ?? []) {
          for (const comment of item.reviewItemComments ?? []) {
            if (comment?.appeal) {
              flattenedAppeals.push(comment.appeal);
            }
          }
        }
      } catch {
        // ignore
      }
      result.appeals = flattenedAppeals;
      if (!resolvedPhaseName) {
        resolvedPhaseName = await this.resolvePhaseNameFromChallenge({
          challengeId,
          phaseId: data.phaseId ?? null,
          challengeCache,
        });
      }
      result.phaseName = resolvedPhaseName;

      const normalizedPhaseName = this.normalizePhaseName(resolvedPhaseName);
      const requesterId = String(authUser?.userId ?? '');
      const submissionOwnerId = String(data.submission?.memberId ?? '');
      const challengeForReview = challengeId
        ? (challengeCache.get(challengeId) ?? challengeDetail)
        : challengeDetail;
      const shouldTrimIterativeReviewForOtherSubmitters =
        !isPrivilegedRequester &&
        isSubmitterForChallenge &&
        !hasCopilotRole &&
        !isReviewerForReview &&
        submissionOwnerId.length > 0 &&
        requesterId.length > 0 &&
        submissionOwnerId !== requesterId &&
        normalizedPhaseName === 'iterative review' &&
        this.isFirst2FinishChallenge(challengeForReview);

      if (shouldTrimIterativeReviewForOtherSubmitters) {
        result.reviewItems = [];
        result.appeals = [];
      }

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

  private async resolvePhaseNameFromChallenge(params: {
    challengeId?: string | null;
    phaseId?: string | null;
    challengeCache?: Map<string, ChallengeData | null>;
  }): Promise<string | null> {
    const { challengeId, phaseId, challengeCache } = params;
    if (!phaseId) {
      return null;
    }

    const normalizedPhaseId = String(phaseId);
    const cache = challengeCache ?? new Map<string, ChallengeData | null>();

    if (!challengeId) {
      return null;
    }

    const challengeKey = String(challengeId);
    let challengeDetail: ChallengeData | null | undefined;

    if (cache.has(challengeKey)) {
      challengeDetail = cache.get(challengeKey) ?? null;
    } else {
      try {
        challengeDetail =
          await this.challengeApiService.getChallengeDetail(challengeKey);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.debug(
          `[resolvePhaseNameFromChallenge] Failed to fetch challenge ${challengeKey}: ${message}`,
        );
        challengeDetail = null;
      }
      cache.set(challengeKey, challengeDetail);
    }

    if (!challengeDetail) {
      return null;
    }

    const phases = challengeDetail.phases ?? [];
    const matchedPhase = phases.find((phase) => {
      if (!phase) {
        return false;
      }
      const candidateIds = [
        String((phase as any).id ?? ''),
        String((phase as any).phaseId ?? ''),
      ].filter((candidate) => candidate.length > 0);

      return candidateIds.includes(normalizedPhaseId);
    });

    return matchedPhase?.name ?? null;
  }

  private normalizePhaseName(phaseName: string | null | undefined): string {
    return String(phaseName ?? '')
      .trim()
      .toLowerCase();
  }

  private hasTimestampValue(value: unknown): boolean {
    if (value == null) {
      return false;
    }
    if (value instanceof Date) {
      return true;
    }
    switch (typeof value) {
      case 'string':
        return value.trim().length > 0;
      case 'number':
        return Number.isFinite(value);
      case 'bigint':
      case 'boolean':
        return true;
      case 'symbol':
      case 'function':
        return false;
      case 'object': {
        const valueWithToISOString = value as {
          toISOString?: (() => string) | undefined;
          valueOf?: (() => unknown) | undefined;
        };
        if (typeof valueWithToISOString.toISOString === 'function') {
          try {
            return valueWithToISOString.toISOString().trim().length > 0;
          } catch {
            return false;
          }
        }
        if (typeof valueWithToISOString.valueOf === 'function') {
          const primitiveValue = valueWithToISOString.valueOf();
          if (primitiveValue !== value) {
            return this.hasTimestampValue(primitiveValue);
          }
        }
        return false;
      }
      default:
        return false;
    }
  }

  private hasChallengePhaseCompleted(
    challenge: ChallengeData | null | undefined,
    phaseNames: string[],
  ): boolean {
    if (!challenge?.phases?.length) {
      return false;
    }

    const normalizedTargets = new Set(
      (phaseNames ?? [])
        .map((name) => this.normalizePhaseName(name))
        .filter((name) => name.length > 0),
    );

    if (!normalizedTargets.size) {
      return false;
    }

    return (challenge.phases ?? []).some((phase) => {
      if (!phase) {
        return false;
      }

      const normalizedName = this.normalizePhaseName((phase as any).name);
      if (!normalizedTargets.has(normalizedName)) {
        return false;
      }

      if ((phase as any).isOpen === true) {
        return false;
      }

      const actualEnd =
        (phase as any).actualEndTime ??
        (phase as any).actualEndDate ??
        (phase as any).actualEnd ??
        null;

      return this.hasTimestampValue(actualEnd);
    });
  }

  private getPhaseIdsForNames(
    challenge: ChallengeData | null | undefined,
    phaseNames: string[],
  ): string[] {
    if (!challenge?.phases?.length) {
      return [];
    }

    const normalizedTargets = new Set(
      (phaseNames ?? [])
        .map((name) => this.normalizePhaseName(name))
        .filter((name) => name.length > 0),
    );

    if (!normalizedTargets.size) {
      return [];
    }

    const phaseIds: string[] = [];

    for (const phase of challenge.phases ?? []) {
      if (!phase) {
        continue;
      }

      const normalizedName = this.normalizePhaseName((phase as any).name);
      if (!normalizedTargets.has(normalizedName)) {
        continue;
      }

      const candidateIds = [(phase as any).id, (phase as any).phaseId]
        .map((value) => String(value ?? '').trim())
        .filter((value) => value.length > 0);

      for (const candidate of candidateIds) {
        if (!phaseIds.includes(candidate)) {
          phaseIds.push(candidate);
        }
      }
    }

    return phaseIds;
  }

  private getSubmitterVisibilityForChallenge(
    challenge?: ChallengeData | null,
  ): { allowAny: boolean; allowOwn: boolean } {
    if (!challenge) {
      return { allowAny: false, allowOwn: false };
    }

    const status = challenge.status;
    const phases = challenge.phases || [];
    const isFirst2Finish = this.isFirst2FinishChallenge(challenge);

    const appealsOpen = phases.some(
      (phase) =>
        this.normalizePhaseName(phase?.name) === 'appeals' &&
        phase?.isOpen === true,
    );
    const appealsResponseOpen = phases.some(
      (phase) =>
        this.normalizePhaseName(phase?.name) === 'appeals response' &&
        phase?.isOpen === true,
    );

    const hasAppealsPhases = phases.some((phase) => {
      const name = this.normalizePhaseName(phase?.name);
      return name === 'appeals' || name === 'appeals response';
    });

    const iterativeReviewClosed = phases.some((phase) => {
      const name = this.normalizePhaseName(phase?.name);
      return name === 'iterative review' && phase?.isOpen === false;
    });

    const allowAny = this.isCompletedOrCancelledStatus(status);
    const allowOwn =
      allowAny ||
      appealsOpen ||
      appealsResponseOpen ||
      (!hasAppealsPhases && iterativeReviewClosed) ||
      isFirst2Finish;

    return { allowAny, allowOwn };
  }

  private isFirst2FinishChallenge(challenge?: ChallengeData | null): boolean {
    if (!challenge) {
      return false;
    }

    const typeName = (challenge.type ?? '').trim().toLowerCase();
    if (
      typeName === 'first2finish' ||
      typeName === 'first 2 finish' ||
      typeName === 'topgear task'
    ) {
      return true;
    }

    const legacySubTrack = (challenge.legacy?.subTrack ?? '')
      .trim()
      .toLowerCase();

    if (legacySubTrack === 'first_2_finish') {
      return true;
    }

    return false;
  }

  private isMarathonMatchChallenge(challenge?: ChallengeData | null): boolean {
    if (!challenge) {
      return false;
    }

    const typeName = (challenge.type ?? '').trim().toLowerCase();
    if (typeName === 'marathon match') {
      return true;
    }

    const legacySubTrack = (challenge.legacy?.subTrack ?? '')
      .trim()
      .toLowerCase();
    if (legacySubTrack.includes('marathon')) {
      return true;
    }

    const legacyTrack = (challenge.legacy?.track ?? '').trim().toLowerCase();
    return legacyTrack.includes('marathon');
  }

  private async hasPassingSubmissionForReviewScorecard(
    challengeId: string,
    memberId: string,
  ): Promise<boolean> {
    const normalizedChallengeId = String(challengeId ?? '').trim();
    const normalizedMemberId = String(memberId ?? '').trim();

    if (!normalizedChallengeId || !normalizedMemberId) {
      return false;
    }

    try {
      const passingSummation = await this.prisma.reviewSummation.findFirst({
        where: {
          isPassing: true,
          scorecard: {
            type: {
              in: [
                ScorecardType.REVIEW,
                ScorecardType.ITERATIVE_REVIEW,
                ScorecardType.APPROVAL,
              ],
            },
          },
          submission: {
            challengeId: normalizedChallengeId,
            memberId: normalizedMemberId,
          },
        },
        select: { id: true },
      });

      return Boolean(passingSummation);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[hasPassingSubmissionForReviewScorecard] Failed to check passing submission for challenge ${normalizedChallengeId}, member ${normalizedMemberId}: ${message}`,
      );
      return false;
    }
  }

  private isCompletedOrCancelledStatus(
    status?: ChallengeStatus | null,
  ): boolean {
    if (!status) {
      return false;
    }
    if (status === ChallengeStatus.COMPLETED) {
      return true;
    }
    if (status === ChallengeStatus.CANCELLED) {
      return true;
    }
    return String(status).startsWith('CANCELLED_');
  }

  private identifyReviewerRoleType(
    roleName: string,
  ):
    | 'screener'
    | 'checkpoint-screener'
    | 'checkpoint-reviewer'
    | 'reviewer'
    | 'approver'
    | 'iterative-reviewer'
    | 'unknown' {
    const normalized = (roleName ?? '').toLowerCase().trim();

    if (!normalized.length) {
      return 'unknown';
    }

    if (normalized.includes('checkpoint') && normalized.includes('screener')) {
      return 'checkpoint-screener';
    }

    if (normalized.includes('checkpoint') && normalized.includes('reviewer')) {
      return 'checkpoint-reviewer';
    }

    if (normalized.includes('screener') && !normalized.includes('checkpoint')) {
      return 'screener';
    }

    if (normalized.includes('approver') || normalized.includes('approval')) {
      return 'approver';
    }

    if (normalized.includes('iterative') && normalized.includes('reviewer')) {
      return 'iterative-reviewer';
    }

    if (
      normalized.includes('reviewer') &&
      !normalized.includes('checkpoint') &&
      !normalized.includes('iterative')
    ) {
      return 'reviewer';
    }

    return 'unknown';
  }

  private buildReviewerRoleFilters(
    resources: ResourceInfo[],
    challengeDetail: ChallengeData | null,
    challengeCompletedOrCancelled: boolean,
  ): Prisma.reviewWhereInput | null {
    if (challengeCompletedOrCancelled) {
      return null;
    }

    const allReviewerResourceIds = (resources ?? [])
      .map((resource) => String(resource?.id ?? '').trim())
      .filter((id) => id.length > 0);

    if (!challengeDetail) {
      return allReviewerResourceIds.length
        ? { resourceId: { in: allReviewerResourceIds } }
        : null;
    }

    const groupedByRole = new Map<
      ReturnType<typeof this.identifyReviewerRoleType>,
      ResourceInfo[]
    >();

    for (const resource of resources ?? []) {
      if (!resource) {
        continue;
      }
      const roleType = this.identifyReviewerRoleType(resource.roleName ?? '');
      if (roleType === 'unknown') {
        continue;
      }

      const existing = groupedByRole.get(roleType);
      if (existing) {
        existing.push(resource);
      } else {
        groupedByRole.set(roleType, [resource]);
      }
    }

    const filters: Prisma.reviewWhereInput[] = [];

    const screeningPhaseIds = this.getPhaseIdsForNames(challengeDetail, [
      'screening',
    ]);
    const hasScreeningVisibility =
      screeningPhaseIds.length > 0 &&
      (groupedByRole.has('screener') ||
        groupedByRole.has('reviewer') ||
        groupedByRole.has('checkpoint-reviewer'));
    if (hasScreeningVisibility) {
      filters.push({
        AND: [
          { submission: { type: SubmissionType.CONTEST_SUBMISSION } },
          { phaseId: { in: screeningPhaseIds } },
        ],
      });
    }

    if (groupedByRole.has('checkpoint-screener')) {
      const checkpointScreeningPhaseIds = this.getPhaseIdsForNames(
        challengeDetail,
        ['checkpoint screening'],
      );
      if (checkpointScreeningPhaseIds.length) {
        filters.push({
          AND: [
            { submission: { type: SubmissionType.CHECKPOINT_SUBMISSION } },
            { phaseId: { in: checkpointScreeningPhaseIds } },
          ],
        });
      }
    }

    if (groupedByRole.has('checkpoint-reviewer')) {
      const checkpointReviewPhaseIds = this.getPhaseIdsForNames(
        challengeDetail,
        ['checkpoint review'],
      );
      const checkpointReviewerResourceIds = (
        groupedByRole.get('checkpoint-reviewer') ?? []
      )
        .map((resource) => String(resource?.id ?? '').trim())
        .filter((id) => id.length > 0);
      if (
        checkpointReviewPhaseIds.length &&
        checkpointReviewerResourceIds.length
      ) {
        filters.push({
          AND: [
            { submission: { type: SubmissionType.CHECKPOINT_SUBMISSION } },
            { phaseId: { in: checkpointReviewPhaseIds } },
            { resourceId: { in: checkpointReviewerResourceIds } },
          ],
        });
      } else if (checkpointReviewerResourceIds.length) {
        filters.push({
          AND: [
            { submission: { type: SubmissionType.CHECKPOINT_SUBMISSION } },
            { resourceId: { in: checkpointReviewerResourceIds } },
          ],
        });
      }
    }

    if (groupedByRole.has('reviewer')) {
      const reviewPhaseIds = this.getPhaseIdsForNames(challengeDetail, [
        'review',
      ]);
      const reviewerResourceIds = (groupedByRole.get('reviewer') ?? [])
        .map((resource) => String(resource?.id ?? '').trim())
        .filter((id) => id.length > 0);
      if (reviewPhaseIds.length && reviewerResourceIds.length) {
        filters.push({
          AND: [
            { submission: { type: SubmissionType.CONTEST_SUBMISSION } },
            { phaseId: { in: reviewPhaseIds } },
            { resourceId: { in: reviewerResourceIds } },
          ],
        });
      } else if (reviewerResourceIds.length) {
        filters.push({
          AND: [
            { submission: { type: SubmissionType.CONTEST_SUBMISSION } },
            { resourceId: { in: reviewerResourceIds } },
          ],
        });
      }
    }

    if (groupedByRole.has('iterative-reviewer')) {
      const iterativeReviewPhaseIds = this.getPhaseIdsForNames(
        challengeDetail,
        ['iterative review'],
      );
      const iterativeReviewerResourceIds = (
        groupedByRole.get('iterative-reviewer') ?? []
      )
        .map((resource) => String(resource?.id ?? '').trim())
        .filter((id) => id.length > 0);
      if (
        iterativeReviewPhaseIds.length &&
        iterativeReviewerResourceIds.length
      ) {
        filters.push({
          AND: [
            { submission: { type: SubmissionType.CONTEST_SUBMISSION } },
            { phaseId: { in: iterativeReviewPhaseIds } },
            { resourceId: { in: iterativeReviewerResourceIds } },
          ],
        });
      }
    }

    if (groupedByRole.has('approver')) {
      const approvalPhaseIds = this.getPhaseIdsForNames(challengeDetail, [
        'approval',
      ]);
      const approverResourceIds = (groupedByRole.get('approver') ?? [])
        .map((resource) => String(resource?.id ?? '').trim())
        .filter((id) => id.length > 0);
      if (approvalPhaseIds.length && approverResourceIds.length) {
        filters.push({
          AND: [
            { submission: { type: SubmissionType.CONTEST_SUBMISSION } },
            { phaseId: { in: approvalPhaseIds } },
            { resourceId: { in: approverResourceIds } },
          ],
        });
      }
    }

    if (filters.length) {
      return { OR: filters };
    }

    return allReviewerResourceIds.length
      ? { resourceId: { in: allReviewerResourceIds } }
      : null;
  }

  private shouldEnforceLatestSubmissionForReview(
    reviewTypeName: string | null | undefined,
    challenge: ChallengeData | null | undefined,
  ): boolean {
    if (!this.isScreeningOrReviewType(reviewTypeName)) {
      return false;
    }

    if (!challenge) {
      return true;
    }

    const submissionLimit = (
      challenge.metadata as Record<string, unknown> | undefined
    )?.['submissionLimit'];

    const unlimited = this.extractSubmissionLimitUnlimited(submissionLimit);
    if (unlimited === true) {
      return false;
    }

    return this.challengeHasSubmissionLimit(challenge);
  }

  private isScreeningOrReviewType(
    reviewTypeName: string | null | undefined,
  ): boolean {
    if (!reviewTypeName) {
      return false;
    }

    const normalized = reviewTypeName.trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    const names = new Set([
      'review',
      'iterative review',
      'screening',
      'checkpoint screening',
    ]);

    if (names.has(normalized)) {
      return true;
    }

    return false;
  }

  private challengeHasSubmissionLimit(
    challenge: ChallengeData | null | undefined,
  ): boolean {
    if (!challenge?.metadata) {
      return true;
    }

    const rawValue = challenge.metadata['submissionLimit'];
    if (rawValue == null) {
      return true;
    }

    let parsed: unknown = rawValue;

    if (typeof rawValue === 'string') {
      const trimmed = rawValue.trim();
      if (!trimmed) {
        return true;
      }

      try {
        parsed = JSON.parse(trimmed);
      } catch {
        const numeric = Number(trimmed);
        if (Number.isFinite(numeric) && numeric > 0) {
          return true;
        }
        const normalized = trimmed.toLowerCase();
        if (['unlimited', 'false', '0', 'no', 'none'].includes(normalized)) {
          return false;
        }
        return true;
      }
    }

    if (typeof parsed === 'number') {
      return Number.isFinite(parsed) && parsed > 0;
    }

    if (typeof parsed === 'string') {
      const numeric = Number(parsed);
      if (Number.isFinite(numeric) && numeric > 0) {
        return true;
      }
      const normalized = parsed.trim().toLowerCase();
      if (['unlimited', 'false', '0', 'no', 'none'].includes(normalized)) {
        return false;
      }
      return true;
    }

    if (parsed && typeof parsed === 'object') {
      const unlimited = this.parseBooleanFlag((parsed as any).unlimited);
      if (unlimited === true) {
        return false;
      }

      const candidates = [
        (parsed as any).count,
        (parsed as any).max,
        (parsed as any).maximum,
        (parsed as any).limitCount,
        (parsed as any).value,
      ];

      for (const candidate of candidates) {
        if (candidate === undefined || candidate === null) {
          continue;
        }
        const numeric = Number(candidate);
        if (Number.isFinite(numeric) && numeric > 0) {
          return true;
        }
      }

      const limitFlag = this.parseBooleanFlag((parsed as any).limit);
      if (limitFlag === true) {
        return true;
      }
      if (limitFlag === false) {
        return false;
      }
      return true;
    }

    return true;
  }

  private extractSubmissionLimitUnlimited(value: unknown): boolean | null {
    if (value == null) {
      return null;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }

      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return this.coerceLooseBoolean(
            (parsed as Record<string, unknown>).unlimited,
          );
        }
        return this.coerceLooseBoolean(parsed);
      } catch {
        return this.coerceLooseBoolean(trimmed);
      }
    }

    if (typeof value === 'object' && !Array.isArray(value)) {
      return this.coerceLooseBoolean(
        (value as Record<string, unknown>).unlimited,
      );
    }

    return this.coerceLooseBoolean(value);
  }

  private coerceLooseBoolean(value: unknown): boolean | null {
    if (value == null) {
      return null;
    }

    if (value === true || value === false) {
      return value;
    }

    if (value instanceof Boolean) {
      return value.valueOf();
    }

    if (value instanceof Number) {
      return this.coerceLooseBoolean(value.valueOf());
    }

    let candidate: string;

    if (typeof value === 'string') {
      candidate = value;
    } else if (value instanceof String) {
      candidate = value.valueOf();
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        return null;
      }
      candidate = value.toString();
    } else if (typeof value === 'bigint') {
      candidate = value.toString();
    } else {
      return null;
    }

    const normalized = candidate.trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
    return null;
  }

  private parseBooleanFlag(value: unknown): boolean | null {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', 'yes', '1'].includes(normalized)) {
        return true;
      }
      if (['false', 'no', '0'].includes(normalized)) {
        return false;
      }
      return null;
    }
    if (typeof value === 'number') {
      if (value === 1) {
        return true;
      }
      if (value === 0) {
        return false;
      }
      return null;
    }
    return null;
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
