import {
  Injectable,
  Logger,
  NotFoundException,
  InternalServerErrorException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PaginationDto } from 'src/dto/pagination.dto';
import {
  ReviewSummationBatchResponseDto,
  ReviewSummationQueryDto,
  ReviewSummationRequestDto,
  ReviewSummationResponseDto,
  ReviewSummationUpdateRequestDto,
} from 'src/dto/reviewSummation.dto';
import { SortDto } from 'src/dto/sort.dto';
import { JwtUser, isAdmin } from 'src/shared/modules/global/jwt.service';
import { PrismaService } from 'src/shared/modules/global/prisma.service';
import { PrismaErrorService } from 'src/shared/modules/global/prisma-error.service';
import {
  ChallengeApiService,
  ChallengeData,
} from 'src/shared/modules/global/challenge.service';
import { MemberPrismaService } from 'src/shared/modules/global/member-prisma.service';
import { ResourceApiService } from 'src/shared/modules/global/resource.service';
import { UserRole } from 'src/shared/enums/userRole.enum';
import { Prisma } from '@prisma/client';

@Injectable()
export class ReviewSummationService {
  private readonly logger = new Logger(ReviewSummationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaErrorService: PrismaErrorService,
    private readonly challengeApiService: ChallengeApiService,
    private readonly memberPrisma: MemberPrismaService,
    private readonly resourceApiService: ResourceApiService,
  ) {}

  private readonly systemActor = 'ReviewSummationService';

  private prepareMetadata(
    metadata?: Prisma.JsonValue | null,
  ): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
    if (metadata === undefined) {
      return undefined;
    }

    if (metadata === null) {
      return Prisma.JsonNull;
    }

    return metadata as Prisma.InputJsonValue;
  }

  private phaseNameEquals(
    phaseName: string | null | undefined,
    target: string,
  ) {
    return (
      (phaseName ?? '').trim().toLowerCase() === target.trim().toLowerCase()
    );
  }

  private findPhase(challenge: ChallengeData, phaseName: string) {
    return (challenge.phases ?? []).find((phase) =>
      this.phaseNameEquals(phase?.name, phaseName),
    );
  }

  private isFirst2FinishChallenge(challenge: ChallengeData): boolean {
    const type = (challenge.type ?? '').trim().toLowerCase();
    const legacySubTrack = (challenge.legacy?.subTrack ?? '')
      .trim()
      .toLowerCase();
    return (
      type === 'first2finish' ||
      type === 'first 2 finish' ||
      legacySubTrack === 'first_2_finish'
    );
  }

  private isMarathonMatchChallenge(challenge: ChallengeData): boolean {
    const type = (challenge.type ?? '').trim().toLowerCase();
    if (type === 'marathon match') {
      return true;
    }

    const legacyTrack = (challenge.legacy?.subTrack ?? '').trim().toLowerCase();
    if (legacyTrack.includes('marathon')) {
      return true;
    }

    return false;
  }

  private roundScore(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private computeAverage(
    scores: Array<number | null | undefined>,
  ): number | null {
    const valid = scores.filter(
      (score): score is number =>
        typeof score === 'number' && Number.isFinite(score),
    );
    if (!valid.length) {
      return null;
    }
    const sum = valid.reduce((acc, score) => acc + score, 0);
    return this.roundScore(sum / valid.length);
  }

  private async getPassingScoreByScorecard(
    scorecardIds: string[],
  ): Promise<Map<string, number>> {
    if (!scorecardIds.length) {
      return new Map();
    }

    const uniqueIds = Array.from(new Set(scorecardIds.filter(Boolean)));
    if (!uniqueIds.length) {
      return new Map();
    }

    const scorecards = await this.prisma.scorecard.findMany({
      where: {
        id: {
          in: uniqueIds,
        },
      },
      select: {
        id: true,
        minimumPassingScore: true,
        minScore: true,
      },
    });

    return new Map(
      scorecards.map((card) => {
        const minimumPassingScore =
          typeof card.minimumPassingScore === 'number' &&
          Number.isFinite(card.minimumPassingScore)
            ? card.minimumPassingScore
            : undefined;
        const minScore =
          typeof card.minScore === 'number' && Number.isFinite(card.minScore)
            ? card.minScore
            : 0;
        return [card.id, minimumPassingScore ?? minScore];
      }),
    );
  }

  private buildBatchResponse(
    challengeId: string,
    stage: 'INITIAL' | 'FINAL',
    summary: {
      processed: number;
      created: number;
      updated: number;
      skipped: number;
    },
  ): ReviewSummationBatchResponseDto {
    return {
      challengeId,
      stage,
      processedSubmissions: summary.processed,
      createdCount: summary.created,
      updatedCount: summary.updated,
      skippedCount: summary.skipped,
    };
  }

  async generateInitialSummationsForChallenge(
    authUser: JwtUser,
    challengeId: string,
  ): Promise<ReviewSummationBatchResponseDto> {
    return this.generateSummationsForChallenge(
      authUser,
      challengeId,
      'INITIAL',
    );
  }

  async finalizeSummationsForChallenge(
    authUser: JwtUser,
    challengeId: string,
  ): Promise<ReviewSummationBatchResponseDto> {
    return this.generateSummationsForChallenge(authUser, challengeId, 'FINAL');
  }

  private async generateSummationsForChallenge(
    authUser: JwtUser,
    challengeId: string,
    stage: 'INITIAL' | 'FINAL',
  ): Promise<ReviewSummationBatchResponseDto> {
    if (!challengeId || typeof challengeId !== 'string') {
      throw new BadRequestException({
        message:
          'A valid challengeId is required to generate review summations.',
        code: 'INVALID_CHALLENGE_ID',
      });
    }

    try {
      const actor = authUser?.userId
        ? String(authUser.userId)
        : this.systemActor;

      const challenge =
        await this.challengeApiService.getChallengeDetail(challengeId);
      const isF2F = this.isFirst2FinishChallenge(challenge);

      if (stage === 'INITIAL') {
        const reviewPhase =
          this.findPhase(challenge, 'Review') ??
          this.findPhase(challenge, 'Iterative Review');
        if (!reviewPhase) {
          throw new BadRequestException({
            message: `Challenge ${challengeId} does not have a Review or Iterative Review phase.`,
            code: 'REVIEW_PHASE_MISSING',
          });
        }
        if (reviewPhase.isOpen) {
          throw new BadRequestException({
            message: `Review phase for challenge ${challengeId} is still open. Summations can only be generated after it closes.`,
            code: 'REVIEW_PHASE_OPEN',
          });
        }
      } else {
        if (isF2F) {
          const iterativeReview = this.findPhase(challenge, 'Iterative Review');
          if (!iterativeReview) {
            throw new BadRequestException({
              message: `Challenge ${challengeId} is First2Finish but missing an Iterative Review phase.`,
              code: 'ITERATIVE_REVIEW_PHASE_MISSING',
            });
          }
          if (iterativeReview.isOpen) {
            throw new BadRequestException({
              message: `Iterative Review phase for challenge ${challengeId} must be closed before finalizing summations.`,
              code: 'ITERATIVE_REVIEW_PHASE_OPEN',
            });
          }
        } else {
          const appealsResponse = this.findPhase(challenge, 'Appeals Response');
          if (!appealsResponse) {
            throw new BadRequestException({
              message: `Challenge ${challengeId} is missing an Appeals Response phase.`,
              code: 'APPEALS_RESPONSE_PHASE_MISSING',
            });
          }
          if (appealsResponse.isOpen) {
            throw new BadRequestException({
              message: `Appeals Response phase for challenge ${challengeId} is still open. Final summations can only be generated after it closes.`,
              code: 'APPEALS_RESPONSE_PHASE_OPEN',
            });
          }
        }
      }

      const submissions = await this.prisma.submission.findMany({
        where: { challengeId },
        select: { id: true },
      });

      if (!submissions.length) {
        return this.buildBatchResponse(challengeId, stage, {
          processed: 0,
          created: 0,
          updated: 0,
          skipped: 0,
        });
      }

      const submissionIds = submissions.map((submission) => submission.id);

      const [reviews, existingSummations] = await Promise.all([
        this.prisma.review.findMany({
          where: {
            submissionId: {
              in: submissionIds,
            },
            committed: true,
          },
          select: {
            id: true,
            submissionId: true,
            scorecardId: true,
            initialScore: true,
            finalScore: true,
          },
        }),
        this.prisma.reviewSummation.findMany({
          where: {
            submissionId: {
              in: submissionIds,
            },
          },
        }),
      ]);

      if (stage === 'FINAL' && isF2F) {
        const hasPerfectScore = reviews.some((review) => {
          const score = review.finalScore ?? review.initialScore;
          return typeof score === 'number' && score >= 100;
        });
        if (!hasPerfectScore) {
          throw new BadRequestException({
            message: `Cannot finalize summations for challenge ${challengeId}. No review with a score of 100 was found.`,
            code: 'PERFECT_SCORE_REQUIRED',
          });
        }
      }

      const scorecardIds = reviews
        .map((review) => review.scorecardId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
      const minScoreByScorecard =
        await this.getPassingScoreByScorecard(scorecardIds);

      const reviewsBySubmission = new Map<string, typeof reviews>();
      for (const review of reviews) {
        if (!review.submissionId) {
          continue;
        }
        const bucket = reviewsBySubmission.get(review.submissionId) ?? [];
        bucket.push(review);
        reviewsBySubmission.set(review.submissionId, bucket);
      }

      const summationBySubmission = new Map(
        existingSummations.map((summation) => [
          summation.submissionId,
          summation,
        ]),
      );

      const now = new Date();
      const operations: Array<
        ReturnType<typeof this.prisma.reviewSummation.create>
      > = [];
      const summary = {
        processed: submissions.length,
        created: 0,
        updated: 0,
        skipped: 0,
      };

      for (const submission of submissions) {
        const submissionReviews = reviewsBySubmission.get(submission.id) ?? [];
        if (!submissionReviews.length) {
          summary.skipped += 1;
          continue;
        }

        const primaryScorecardId =
          submissionReviews.find((review) => review.scorecardId)?.scorecardId ??
          null;

        if (!primaryScorecardId) {
          summary.skipped += 1;
          continue;
        }

        const aggregateScore =
          stage === 'INITIAL'
            ? this.computeAverage(
                submissionReviews.map((review) => review.initialScore),
              )
            : this.computeAverage(
                submissionReviews.map(
                  (review) => review.finalScore ?? review.initialScore ?? null,
                ),
              );

        if (aggregateScore === null) {
          summary.skipped += 1;
          continue;
        }

        const minPassingScore =
          minScoreByScorecard.get(primaryScorecardId) ?? 0;
        const isPassing = aggregateScore >= minPassingScore;

        const baseData = {
          submissionId: submission.id,
          aggregateScore,
          scorecardId: primaryScorecardId,
          isPassing,
          isFinal: stage === 'FINAL',
          reviewedDate: now,
          updatedBy: actor,
        };

        const existing = summationBySubmission.get(submission.id);
        if (existing) {
          summary.updated += 1;
          operations.push(
            this.prisma.reviewSummation.update({
              where: { id: existing.id },
              data: baseData,
            }),
          );
        } else {
          summary.created += 1;
          operations.push(
            this.prisma.reviewSummation.create({
              data: {
                ...baseData,
                createdBy: actor,
              },
            }),
          );
        }
      }

      if (operations.length) {
        await this.prisma.$transaction(operations);
      }

      const result = this.buildBatchResponse(challengeId, stage, summary);
      this.logger.log({
        message: `Review summations batch complete for stage ${stage}`,
        challengeId,
        ...summary,
      });
      return result;
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      const errorResponse = this.prismaErrorService.handleError(
        error,
        `generating ${stage.toLowerCase()} review summations for challenge ${challengeId}`,
      );

      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  async createSummation(authUser: JwtUser, body: ReviewSummationRequestDto) {
    try {
      // Validate submissionId format and existence
      if (body.submissionId) {
        // First check if the submissionId length is valid (should be 14 characters for nanoid)
        if (body.submissionId.length > 14) {
          throw new BadRequestException({
            message: `Invalid submissionId format. Expected 14 characters, got ${body.submissionId.length}`,
            code: 'INVALID_SUBMISSION_ID_FORMAT',
            details: {
              field: 'submissionId',
              expectedLength: 14,
              actualLength: body.submissionId.length,
            },
          });
        }

        // Check if submission exists
        const submission = await this.prisma.submission.findUnique({
          where: { id: body.submissionId },
        });

        if (!submission) {
          throw new NotFoundException(
            `Submission with ID ${body.submissionId} not found. Please verify the submission ID is correct.`,
          );
        }
      }

      const { metadata, ...rest } = body;
      const createData: Prisma.reviewSummationUncheckedCreateInput = {
        ...rest,
      };
      const normalizedMetadata = this.prepareMetadata(metadata);
      if (normalizedMetadata !== undefined) {
        createData.metadata = normalizedMetadata;
      }

      const data = await this.prisma.reviewSummation.create({
        data: createData,
      });
      this.logger.log(`Review summation created with ID: ${data.id}`);
      return data as ReviewSummationResponseDto;
    } catch (error) {
      // Re-throw NotFoundException and BadRequestException as-is
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      const errorResponse = this.prismaErrorService.handleError(
        error,
        `creating review summation for submission ${body.submissionId}`,
        body,
      );

      // Throw appropriate HTTP exception based on error code
      if (errorResponse.code === 'FOREIGN_KEY_CONSTRAINT_FAILED') {
        throw new BadRequestException({
          message: errorResponse.message,
          code: errorResponse.code,
          details: errorResponse.details,
        });
      }

      if (errorResponse.code === 'UNIQUE_CONSTRAINT_FAILED') {
        throw new BadRequestException({
          message: errorResponse.message,
          code: errorResponse.code,
          details: errorResponse.details,
        });
      }

      if (
        errorResponse.code === 'VALIDATION_ERROR' ||
        errorResponse.code === 'REQUIRED_FIELD_MISSING' ||
        errorResponse.code === 'INVALID_DATA'
      ) {
        throw new BadRequestException({
          message: errorResponse.message,
          code: errorResponse.code,
          details: errorResponse.details,
        });
      }

      // For other errors, throw internal server error
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  async searchSummation(
    authUser: JwtUser,
    queryDto: ReviewSummationQueryDto,
    paginationDto?: PaginationDto,
    sortDto?: SortDto,
  ) {
    try {
      const { page = 1, perPage = 10 } = paginationDto || {};
      const skip = (page - 1) * perPage;
      let orderBy;

      const parseBooleanString = (value?: string): boolean | undefined => {
        if (typeof value !== 'string') {
          return undefined;
        }
        return value.toLowerCase() === 'true';
      };

      if (sortDto && sortDto.orderBy && sortDto.sortBy) {
        orderBy = {
          [sortDto.sortBy]: sortDto.orderBy.toLowerCase(),
        };
      }

      const normalizedRoles = new Set(
        (authUser?.roles ?? [])
          .map((role) =>
            String(role ?? '')
              .trim()
              .toLowerCase(),
          )
          .filter((role) => role.length > 0),
      );

      const hasSubmitterRole = normalizedRoles.has(
        String(UserRole.Submitter).trim().toLowerCase(),
      );
      const hasCopilotRole = normalizedRoles.has(
        String(UserRole.Copilot).trim().toLowerCase(),
      );
      const hasGeneralUserRole = normalizedRoles.has(
        String(UserRole.User).trim().toLowerCase(),
      );
      const isPrivileged =
        (authUser?.isMachine ?? false) || isAdmin(authUser) || hasCopilotRole;
      const isSubmitterOnly =
        !isPrivileged && (hasSubmitterRole || hasGeneralUserRole);

      const rawChallengeId = queryDto.challengeId
        ? String(queryDto.challengeId).trim()
        : undefined;
      const challengeIdFilter =
        rawChallengeId && rawChallengeId.length ? rawChallengeId : undefined;
      const includeMetadata =
        (queryDto.metadata ?? '').toLowerCase() === 'true';

      let enforcedMemberId: string | undefined;

      if (isSubmitterOnly) {
        const userId =
          authUser?.userId !== undefined && authUser?.userId !== null
            ? String(authUser.userId)
            : '';
        if (!userId) {
          throw new ForbiddenException({
            message:
              'Authenticated user information is required to view review summations.',
            code: 'SUBMITTER_USER_MISSING',
            details: {
              reason: 'USER_ID_MISSING',
              roles: Array.from(normalizedRoles),
            },
          });
        }

        if (!challengeIdFilter) {
          throw new ForbiddenException({
            message:
              'Submitters must specify a challengeId when listing review summations.',
            code: 'SUBMITTER_CHALLENGE_ID_REQUIRED',
            details: {
              reason: 'CHALLENGE_ID_REQUIRED',
              guidance:
                'Pass a challengeId query parameter when requesting review summations as a submitter.',
              submitterUserId: authUser?.userId ?? null,
              submitterHandle: authUser?.handle ?? null,
              roles: Array.from(normalizedRoles),
            },
          });
        }

        const challenge =
          await this.challengeApiService.getChallengeDetail(challengeIdFilter);

        if (!this.isMarathonMatchChallenge(challenge)) {
          throw new ForbiddenException({
            message:
              'Submitters can only view review summations for Marathon Match challenges.',
            code: 'SUBMITTER_NON_MARATHON_FORBIDDEN',
            details: {
              challengeId: challengeIdFilter,
              challengeType: challenge.type ?? null,
              legacyTrack: challenge.track ?? null,
              legacySubTrack: challenge.legacy?.subTrack ?? null,
              allowedChallengeTypes: ['Marathon Match'],
              submitterUserId: authUser?.userId ?? null,
              submitterHandle: authUser?.handle ?? null,
              roles: Array.from(normalizedRoles),
            },
          });
        }

        let memberResources: unknown[] = [];
        let resourceLookupFailed = false;
        try {
          memberResources = await this.resourceApiService.getResources({
            challengeId: challengeIdFilter,
            memberId: userId,
          });
        } catch (resourceLookupError) {
          resourceLookupFailed = true;
          const message =
            resourceLookupError instanceof Error
              ? resourceLookupError.message
              : String(resourceLookupError);
          this.logger.warn(
            `[searchSummation] Unable to load member resources for challenge ${challengeIdFilter} and member ${userId}: ${message}`,
          );
        }

        if (!resourceLookupFailed) {
          const hasAnyResource =
            Array.isArray(memberResources) && memberResources.length > 0;
          if (!hasAnyResource) {
            throw new ForbiddenException({
              message:
                'Submitter access requires active registration for this challenge.',
              code: 'SUBMITTER_NOT_REGISTERED',
              details: {
                challengeId: challengeIdFilter,
                memberId: userId,
                info: 'Member does not have any resources on this challenge.',
              },
            });
          }
        } else {
          try {
            await this.resourceApiService.validateSubmitterRegistration(
              challengeIdFilter,
              userId,
            );
          } catch (validationError) {
            const details =
              validationError instanceof Error
                ? validationError.message
                : String(validationError);
            throw new ForbiddenException({
              message:
                'Submitter access requires active registration for this challenge.',
              code: 'SUBMITTER_NOT_REGISTERED',
              details: {
                challengeId: challengeIdFilter,
                memberId: userId,
                info: details,
              },
            });
          }

          enforcedMemberId = userId;
        }
      }

      // Build the where clause for review summations based on available filter parameters
      const reviewSummationWhereClause: any = {};
      const isPassingFilter = parseBooleanString(queryDto.isPassing);
      const isFinalFilter = parseBooleanString(queryDto.isFinal);
      const isProvisionalFilter = parseBooleanString(queryDto.isProvisional);
      const isExampleFilter = parseBooleanString(queryDto.isExample);
      const exampleOnly = parseBooleanString(queryDto.example) === true;
      const provisionalOnly = parseBooleanString(queryDto.provisional) === true;
      const systemOnly = parseBooleanString(queryDto.system) === true;

      if (queryDto.submissionId) {
        reviewSummationWhereClause.submissionId = queryDto.submissionId;
      }
      if (queryDto.aggregateScore) {
        reviewSummationWhereClause.aggregateScore = parseFloat(
          queryDto.aggregateScore,
        );
      }
      if (queryDto.scorecardId) {
        reviewSummationWhereClause.scorecardId = queryDto.scorecardId;
      }
      if (isPassingFilter !== undefined) {
        reviewSummationWhereClause.isPassing = isPassingFilter;
      }
      if (isFinalFilter !== undefined) {
        reviewSummationWhereClause.isFinal = isFinalFilter;
      } else if (systemOnly) {
        reviewSummationWhereClause.isFinal = true;
      }
      if (isProvisionalFilter !== undefined) {
        reviewSummationWhereClause.isProvisional = isProvisionalFilter;
      } else if (provisionalOnly) {
        reviewSummationWhereClause.isProvisional = true;
      }
      if (isExampleFilter !== undefined) {
        reviewSummationWhereClause.isExample = isExampleFilter;
      } else if (exampleOnly) {
        reviewSummationWhereClause.isExample = true;
      }

      const submissionWhereClause: Record<string, unknown> = {};
      if (challengeIdFilter) {
        submissionWhereClause.challengeId = challengeIdFilter;
      }
      if (enforcedMemberId) {
        submissionWhereClause.memberId = enforcedMemberId;
      }

      const whereClause = {
        ...reviewSummationWhereClause,
        ...(Object.keys(submissionWhereClause).length
          ? { submission: { is: submissionWhereClause } }
          : {}),
      };

      const shouldEnrichSubmitterMetadata = Boolean(challengeIdFilter);

      const summations = await this.prisma.reviewSummation.findMany({
        where: whereClause,
        skip,
        take: perPage,
        orderBy,
        ...(shouldEnrichSubmitterMetadata
          ? {
              include: {
                submission: {
                  select: {
                    memberId: true,
                  },
                },
              },
            }
          : {}),
      });

      const submitterInfoByMemberId = new Map<
        string,
        { handle: string | null; maxRating: number | null }
      >();

      if (shouldEnrichSubmitterMetadata && summations.length) {
        try {
          const memberIds = Array.from(
            new Set(
              summations
                .map((summation) => {
                  const submission = (
                    summation as typeof summation & {
                      submission?: { memberId: string | null };
                    }
                  ).submission;
                  return typeof submission?.memberId === 'string'
                    ? submission.memberId.trim()
                    : null;
                })
                .filter((memberId): memberId is string => Boolean(memberId)),
            ),
          );

          if (memberIds.length) {
            const memberIdsAsBigInt: bigint[] = [];
            for (const memberId of memberIds) {
              try {
                memberIdsAsBigInt.push(BigInt(memberId));
              } catch (conversionError) {
                this.logger.debug(
                  `[searchSummation] Skipping submitter memberId ${memberId}: unable to convert to BigInt. ${conversionError}`,
                );
              }
            }

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
                submitterInfoByMemberId.set(member.userId.toString(), {
                  handle: member.handle ?? null,
                  maxRating: member.maxRating?.rating ?? null,
                });
              });
            }
          }
        } catch (enrichmentError) {
          const message =
            enrichmentError instanceof Error
              ? enrichmentError.message
              : String(enrichmentError);
          this.logger.warn(
            `[searchSummation] Failed to enrich submitter metadata: ${message}`,
          );
        }
      }

      // Count total entities matching the filter for pagination metadata
      const totalCount = await this.prisma.reviewSummation.count({
        where: whereClause,
      });

      const data: ReviewSummationResponseDto[] = summations.map((summation) => {
        const { submission, metadata, ...rest } =
          summation as typeof summation & {
            submission?: { memberId: string | null };
            metadata?: Prisma.JsonValue | null;
          };

        let submitterId: number | null = null;
        let submitterHandle: string | null = null;
        let submitterMaxRating: number | null = null;

        if (submission && typeof submission.memberId === 'string') {
          const memberId = submission.memberId.trim();
          if (memberId.length) {
            const numericMemberId = Number.parseInt(memberId, 10);
            if (
              Number.isNaN(numericMemberId) ||
              !Number.isFinite(numericMemberId) ||
              !Number.isSafeInteger(numericMemberId)
            ) {
              submitterId = null;
            } else {
              submitterId = numericMemberId;
            }
            const profile = submitterInfoByMemberId.get(memberId);
            submitterHandle = profile?.handle ?? null;
            submitterMaxRating = profile?.maxRating ?? null;
          }
        }

        const base: ReviewSummationResponseDto = {
          ...rest,
          submitterId,
          submitterHandle,
          submitterMaxRating,
        } as ReviewSummationResponseDto;

        if (includeMetadata) {
          base.metadata = metadata ?? null;
        }

        return base;
      });

      this.logger.log(
        `Found ${data.length} review summations (page ${page} of ${Math.ceil(totalCount / perPage)})`,
      );

      return {
        data,
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
        `searching review summations with filters - submissionId: ${queryDto.submissionId}, scorecardId: ${queryDto.scorecardId}, challengeId: ${queryDto.challengeId}`,
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  async getSummation(id: string) {
    try {
      return this.checkSummation(id);
    } catch (error) {
      // Re-throw NotFoundException from checkSummation as-is
      if (error instanceof NotFoundException) {
        throw error;
      }

      const errorResponse = this.prismaErrorService.handleError(
        error,
        `fetching review summation ${id}`,
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  async updateSummation(
    authUser: JwtUser,
    id: string,
    body: ReviewSummationUpdateRequestDto,
  ) {
    try {
      await this.checkSummation(id);

      // If submissionId is provided, validate it exists and check its length
      if (body.submissionId) {
        // First check if the submissionId length is valid (should be 14 characters for nanoid)
        if (body.submissionId.length > 14) {
          throw new BadRequestException({
            message: `Invalid submissionId format. Expected 14 characters, got ${body.submissionId.length}`,
            code: 'INVALID_SUBMISSION_ID_FORMAT',
            details: {
              field: 'submissionId',
              expectedLength: 14,
              actualLength: body.submissionId.length,
            },
          });
        }

        // Check if submission exists
        const submission = await this.prisma.submission.findUnique({
          where: { id: body.submissionId },
        });

        if (!submission) {
          throw new NotFoundException(
            `Submission with ID ${body.submissionId} not found. Please verify the submission ID is correct.`,
          );
        }
      }

      const { metadata, ...rest } = body;
      const updateData: Prisma.reviewSummationUncheckedUpdateInput = {
        ...rest,
      };
      const normalizedMetadata = this.prepareMetadata(metadata);
      if (normalizedMetadata !== undefined) {
        updateData.metadata = normalizedMetadata;
      }

      const data = await this.prisma.reviewSummation.update({
        where: { id },
        data: updateData,
      });
      this.logger.log(`Review summation updated successfully: ${id}`);
      return data as ReviewSummationResponseDto;
    } catch (error) {
      // Re-throw NotFoundException and BadRequestException from checkSummation and validation as-is
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      const errorResponse = this.prismaErrorService.handleError(
        error,
        `updating review summation ${id}`,
        body,
      );

      // Throw appropriate HTTP exception based on error code
      if (errorResponse.code === 'FOREIGN_KEY_CONSTRAINT_FAILED') {
        throw new BadRequestException({
          message: errorResponse.message,
          code: errorResponse.code,
          details: errorResponse.details,
        });
      }

      if (errorResponse.code === 'UNIQUE_CONSTRAINT_FAILED') {
        throw new BadRequestException({
          message: errorResponse.message,
          code: errorResponse.code,
          details: errorResponse.details,
        });
      }

      if (
        errorResponse.code === 'VALIDATION_ERROR' ||
        errorResponse.code === 'REQUIRED_FIELD_MISSING' ||
        errorResponse.code === 'INVALID_DATA'
      ) {
        throw new BadRequestException({
          message: errorResponse.message,
          code: errorResponse.code,
          details: errorResponse.details,
        });
      }

      // For other errors, throw internal server error
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  async deleteSummation(id: string) {
    try {
      await this.checkSummation(id);
      await this.prisma.reviewSummation.delete({
        where: { id },
      });
    } catch (error) {
      // Re-throw NotFoundException from checkSummation as-is
      if (error instanceof NotFoundException) {
        throw error;
      }

      const errorResponse = this.prismaErrorService.handleError(
        error,
        `deleting review summation ${id}`,
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  private async checkSummation(id: string) {
    try {
      const data = await this.prisma.reviewSummation.findUnique({
        where: { id },
      });
      if (!data || !data.id) {
        throw new NotFoundException(
          `Review summation with ID ${id} not found. Please verify the summation ID is correct.`,
        );
      }
      return data;
    } catch (error) {
      // Re-throw NotFoundException as-is
      if (error instanceof NotFoundException) {
        throw error;
      }

      const errorResponse = this.prismaErrorService.handleError(
        error,
        `checking existence of review summation ${id}`,
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }
}
