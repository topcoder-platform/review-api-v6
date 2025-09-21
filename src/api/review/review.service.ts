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
import { PaginatedResponse, PaginationDto } from 'src/dto/pagination.dto';
import { PrismaService } from 'src/shared/modules/global/prisma.service';
import { PrismaErrorService } from 'src/shared/modules/global/prisma-error.service';
import { ResourceApiService } from 'src/shared/modules/global/resource.service';
import { ChallengeApiService } from 'src/shared/modules/global/challenge.service';
import { LoggerService } from 'src/shared/modules/global/logger.service';
import { JwtUser, isAdmin } from 'src/shared/modules/global/jwt.service';
import { ChallengeStatus } from 'src/shared/enums/challengeStatus.enum';
import { ResourceInfo } from 'src/shared/models/ResourceInfo.model';

@Injectable()
export class ReviewService {
  private readonly logger: LoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaErrorService: PrismaErrorService,
    private readonly resourceApiService: ResourceApiService,
    private readonly challengeApiService: ChallengeApiService,
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

  private async recomputeAndUpdateReviewScores(reviewId: string) {
    try {
      const review = await this.prisma.review.findUnique({
        where: { id: reviewId },
        select: {
          id: true,
          scorecardId: true,
        },
      });
      if (!review?.scorecardId) return;

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
    } catch (e) {
      this.logger.error(
        `[recomputeAndUpdateReviewScores] Failed for review ${reviewId}`,
        e,
      );
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

      await this.challengeApiService.validateReviewSubmission(
        submission.challengeId,
      );

      const challengeResources = await this.resourceApiService.getResources({
        challengeId: submission.challengeId,
      });

      const resource = challengeResources.find(
        (challengeResource) => challengeResource.id === body.resourceId,
      );

      if (!resource) {
        throw new NotFoundException({
          message: `Resource with ID ${body.resourceId} was not found for challenge ${submission.challengeId}.`,
          code: 'RESOURCE_NOT_FOUND',
          details: {
            resourceId: body.resourceId,
            challengeId: submission.challengeId,
          },
        });
      }

      const challenge = await this.challengeApiService.getChallengeDetail(
        submission.challengeId,
      );

      const challengePhases = challenge?.phases ?? [];
      const requestedPhaseId = String(body.phaseId);
      const resolvePhaseId = (phase: (typeof challengePhases)[number]) =>
        String((phase as any)?.id ?? (phase as any)?.phaseId ?? '');

      const matchingPhase = challengePhases.find((phase) => {
        const candidate = resolvePhaseId(phase);
        return candidate && candidate === requestedPhaseId;
      });

      if (!matchingPhase) {
        throw new BadRequestException({
          message: `Phase ${body.phaseId} is not associated with challenge ${submission.challengeId}.`,
          code: 'INVALID_REVIEW_PHASE',
          details: {
            resourceId: body.resourceId,
            submissionId: body.submissionId,
            challengeId: submission.challengeId,
          },
        });
      }

      const matchingPhaseName = (matchingPhase.name ?? '').toLowerCase();
      if (!matchingPhaseName.includes('review')) {
        throw new BadRequestException({
          message: `Phase ${body.phaseId} is not a Review phase for challenge ${submission.challengeId}.`,
          code: 'INVALID_REVIEW_PHASE',
          details: {
            phaseName: matchingPhase.name,
            challengeId: submission.challengeId,
          },
        });
      }

      const resourcePhaseId = resource?.phaseId
        ? String(resource.phaseId)
        : undefined;
      if (resourcePhaseId && resourcePhaseId !== requestedPhaseId) {
        throw new BadRequestException({
          message: `Resource ${body.resourceId} is associated with phase ${resourcePhaseId}, which does not match the requested phase ${requestedPhaseId}.`,
          code: 'RESOURCE_PHASE_MISMATCH',
          details: {
            resourceId: body.resourceId,
            expectedPhaseId: resourcePhaseId,
            requestedPhaseId,
          },
        });
      }

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
                challengeId: submission.challengeId,
                resourceId: body.resourceId,
              },
            });
          }

          if (String(resource.memberId) !== uid) {
            throw new ForbiddenException({
              message:
                'The specified resource does not belong to the authenticated user.',
              code: 'RESOURCE_MEMBER_MISMATCH',
              details: {
                challengeId: submission.challengeId,
                resourceId: body.resourceId,
                requester: uid,
                resourceOwner: resource.memberId,
              },
            });
          }

          let isReviewer = false;
          try {
            const resources =
              await this.resourceApiService.getMemberResourcesRoles(
                submission.challengeId,
                uid,
              );
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
                challengeId: submission.challengeId,
                requester: uid,
              },
            });
          }
        }
      }

      const prismaBody = mapReviewRequestToDto(body) as any;
      const createdReview = await this.prisma.review.create({
        data: prismaBody,
        include: {
          reviewItems: {
            include: {
              reviewItemComments: true,
            },
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
              include: {
                reviewItemComments: true,
              },
            },
          },
        });
      }

      this.logger.log(`Review created with ID: ${reviewToReturn.id}`);
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
        select: { id: true },
      });

      if (!review) {
        throw new BadRequestException({
          message: `Review with ID ${reviewId} does not exist. Cannot create review items for a non-existent review.`,
          code: 'REVIEW_NOT_FOUND',
          details: { reviewId },
        });
      }

      const data = await this.prisma.reviewItem.create({
        data: mapped as any,
        include: {
          reviewItemComments: true,
        },
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

      if (!ownsReview) {
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

    try {
      const data = await this.prisma.review.update({
        where: { id },
        data: mapReviewRequestToDto(body as ReviewPatchRequestDto),
        include: {
          reviewItems: {
            include: {
              reviewItemComments: true,
            },
          },
        },
      });
      // Recalculate scores based on current review items
      await this.recomputeAndUpdateReviewScores(id);
      this.logger.log(`Review updated successfully: ${id}`);
      return data as unknown as ReviewResponseDto;
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
    itemId: string,
    body: ReviewItemRequestDto,
  ): Promise<ReviewItemResponseDto> {
    this.logger.log(`Updating review item with ID: ${itemId}`);
    try {
      // First get the existing review item to find the associated review's resourceId
      const existingItem = await this.prisma.reviewItem.findUnique({
        where: { id: itemId },
        include: {
          review: {
            select: {
              resourceId: true,
            },
          },
        },
      });

      if (!existingItem) {
        throw new NotFoundException({
          message: `Review item with ID ${itemId} was not found. Please check the ID and try again.`,
          code: 'RECORD_NOT_FOUND',
          details: { itemId },
        });
      }

      // Get the mapped data for update
      const mappedData = mapReviewItemRequestForUpdate(body);

      // If there are review item comments to update, set the resourceId
      if (mappedData.reviewItemComments?.create) {
        mappedData.reviewItemComments.create =
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          mappedData.reviewItemComments.create.map((comment: any) => ({
            ...comment,
            // Use the review's resourceId as the commenter
            resourceId: comment.resourceId || existingItem.review.resourceId,
          }));
      }

      const data = await this.prisma.reviewItem.update({
        where: { id: itemId },
        data: mappedData,
        include: {
          reviewItemComments: true,
        },
      });
      // Recalculate parent review scores
      if (data?.reviewId) {
        await this.recomputeAndUpdateReviewScores(data.reviewId);
      }
      this.logger.log(`Review item updated successfully: ${itemId}`);
      return data as unknown as ReviewItemResponseDto;
    } catch (error) {
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
          let isReviewerOrCopilot = false;
          try {
            const resources =
              await this.resourceApiService.getMemberResourcesRoles(
                challengeId,
                uid,
              );
            isReviewerOrCopilot = resources.some((r) => {
              const rn = (r.roleName || '').toLowerCase();
              return rn.includes('reviewer') || rn.includes('copilot');
            });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.debug(
              `Failed to verify reviewer/copilot roles via Resource API: ${msg}`,
            );
          }

          if (!isReviewerOrCopilot) {
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
            const challenge =
              await this.challengeApiService.getChallengeDetail(challengeId);
            const phases = challenge.phases || [];
            const appealsOpen = phases.some(
              (p) => p.name === 'Appeals' && p.isOpen,
            );
            const appealsResponseOpen = phases.some(
              (p) => p.name === 'Appeals Response' && p.isOpen,
            );

            if (challenge.status === ChallengeStatus.COMPLETED) {
              // Allowed to see all reviews on this challenge
              // reviewWhereClause already limited to submissions on this challenge
            } else if (appealsOpen || appealsResponseOpen) {
              // Restrict to own reviews (own submissions only)
              restrictToSubmissionIds(mySubs.map((s) => s.id));
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

      this.logger.debug(`Fetching reviews with where clause:`);
      this.logger.debug(reviewWhereClause);

      const reviews = await this.prisma.review.findMany({
        where: reviewWhereClause,
        skip,
        take: perPage,
        include: {
          reviewItems: {
            include: {
              reviewItemComments: true,
            },
          },
        },
      });

      const totalCount = await this.prisma.review.count({
        where: reviewWhereClause,
      });

      this.logger.log(
        `Found ${reviews.length} reviews (page ${page} of ${Math.ceil(totalCount / perPage)})`,
      );

      return {
        data: reviews as ReviewResponseDto[],
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
            include: {
              reviewItemComments: true,
            },
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

          // Determine visibility by challenge phase/status
          const phases = challenge.phases || [];
          const appealsOpen = phases.some(
            (p) => p.name === 'Appeals' && p.isOpen,
          );
          const appealsResponseOpen = phases.some(
            (p) => p.name === 'Appeals Response' && p.isOpen,
          );

          if (challenge.status === ChallengeStatus.COMPLETED) {
            // Allowed to view any review on this challenge
          } else if (appealsOpen || appealsResponseOpen) {
            const isOwnSubmission = !!uid && data.submission?.memberId === uid;
            if (!isOwnSubmission) {
              throw new ForbiddenException({
                message:
                  'Only reviews of your own submission are accessible during Appeals or Appeals Response',
                code: 'FORBIDDEN_REVIEW_ACCESS_OWN_ONLY',
                details: { challengeId, reviewId },
              });
            }
          } else {
            throw new ForbiddenException({
              message:
                'Reviews are not accessible for this challenge at the current phase',
              code: 'FORBIDDEN_REVIEW_ACCESS_PHASE',
              details: { challengeId, status: challenge.status },
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

  async deleteReview(reviewId: string) {
    this.logger.log(`Deleting review with ID: ${reviewId}`);
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

  async deleteReviewItem(itemId: string) {
    this.logger.log(`Deleting review item with ID: ${itemId}`);
    try {
      // Get parent reviewId before deletion
      const existing = await this.prisma.reviewItem.findUnique({
        where: { id: itemId },
        select: { reviewId: true },
      });
      await this.prisma.reviewItem.delete({
        where: { id: itemId },
      });
      if (existing?.reviewId) {
        await this.recomputeAndUpdateReviewScores(existing.reviewId);
      }
      this.logger.log(`Review item deleted successfully: ${itemId}`);
      return { message: `Review item ${itemId} deleted successfully.` };
    } catch (error) {
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
