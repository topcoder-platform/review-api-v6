import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  AppealRequestDto,
  AppealResponseDto,
  AppealResponseRequestDto,
  AppealResponseResponseDto,
  mapAppealResponseRequestToDto,
} from 'src/dto/appeal.dto';
import { PaginatedResponse, PaginationDto } from 'src/dto/pagination.dto';
import { PrismaService } from 'src/shared/modules/global/prisma.service';
import { PrismaErrorService } from 'src/shared/modules/global/prisma-error.service';
import { ChallengeApiService } from 'src/shared/modules/global/challenge.service';
import { LoggerService } from 'src/shared/modules/global/logger.service';
import { JwtUser, isAdmin } from 'src/shared/modules/global/jwt.service';
import { ResourcePrismaService } from 'src/shared/modules/global/resource-prisma.service';

@Injectable()
export class AppealService {
  private readonly logger = LoggerService.forRoot('AppealService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaErrorService: PrismaErrorService,
    private readonly challengeApiService: ChallengeApiService,
    private readonly resourcePrisma: ResourcePrismaService,
  ) {}

  async createAppeal(
    authUser: JwtUser,
    body: AppealRequestDto,
  ): Promise<AppealResponseDto> {
    this.logger.log('Creating appeal');
    try {
      const trimmedContent = body.content?.trim();
      if (!trimmedContent) {
        throw new BadRequestException({
          message: 'Appeal content must not be empty.',
          code: 'EMPTY_APPEAL_CONTENT',
        });
      }

      const reviewItemComment =
        await this.prisma.reviewItemComment.findUniqueOrThrow({
          where: { id: body.reviewItemCommentId },
          include: {
            reviewItem: {
              include: {
                review: {
                  include: {
                    submission: {
                      select: { challengeId: true, memberId: true },
                    },
                  },
                },
              },
            },
          },
        });

      const submission = reviewItemComment.reviewItem.review.submission;
      const submissionMemberId = submission?.memberId
        ? String(submission.memberId)
        : '';
      const requesterMemberId = authUser?.userId ? String(authUser.userId) : '';
      const isPrivilegedRequester = authUser?.isMachine || isAdmin(authUser);
      const challengeId = submission?.challengeId;

      if (!challengeId) {
        throw new BadRequestException({
          message: `No challengeId found for reviewItemComment ${body.reviewItemCommentId}`,
          code: 'MISSING_CHALLENGE_ID',
        });
      }

      if (!submissionMemberId) {
        throw new BadRequestException({
          message: `No submission owner found for reviewItemComment ${body.reviewItemCommentId}`,
          code: 'MISSING_SUBMISSION_OWNER',
        });
      }

      if (!isPrivilegedRequester) {
        if (!requesterMemberId) {
          throw new ForbiddenException({
            message:
              'Only authenticated submitters may create appeals for review item comments.',
            code: 'APPEAL_CREATE_FORBIDDEN',
          });
        }

        if (submissionMemberId !== requesterMemberId) {
          throw new ForbiddenException({
            message: `Only the submission owner can create this appeal.`,
            code: 'APPEAL_CREATE_FORBIDDEN',
            details: {
              requesterMemberId,
              submissionMemberId,
              reviewItemCommentId: body.reviewItemCommentId,
            },
          });
        }

        if (body.resourceId && body.resourceId !== submissionMemberId) {
          throw new BadRequestException({
            message:
              'Submitters cannot appeal a review item comment for a review that is not their own.',
            code: 'RESOURCE_ID_MISMATCH',
            details: {
              requestedResourceId: body.resourceId,
              submissionMemberId,
            },
          });
        }
      }

      this.ensureAppealPermission(
        authUser,
        submission?.memberId,
        'create',
        'APPEAL_CREATE_FORBIDDEN',
      );

      await this.challengeApiService.validateAppealSubmission(challengeId);

      const data = await this.prisma.appeal.create({
        data: {
          ...body,
          resourceId: submissionMemberId,
          content: trimmedContent,
        },
      });

      this.logger.log(`Appeal created with ID: ${data.id}`);
      return data as AppealResponseDto;
    } catch (error) {
      if (
        error.message &&
        typeof error.message === 'string' &&
        error.message.includes('Appeals cannot be submitted')
      ) {
        throw new BadRequestException({
          message: error.message,
          code: 'PHASE_VALIDATION_ERROR',
        });
      }

      if (
        error instanceof ForbiddenException ||
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      const errorResponse = this.prismaErrorService.handleError(
        error,
        `creating appeal for review item comment: ${body.reviewItemCommentId}`,
        body,
      );

      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  async updateAppeal(
    authUser: JwtUser,
    appealId: string,
    body: AppealRequestDto,
  ): Promise<AppealResponseDto> {
    this.logger.log(`Updating appeal with ID: ${appealId}`);
    try {
      const existingAppeal = await this.getAppealContext(appealId);

      if (!existingAppeal) {
        throw new NotFoundException({
          message: `Appeal with ID ${appealId} was not found. Please verify the appeal ID is correct.`,
          code: 'RECORD_NOT_FOUND',
        });
      }

      this.ensureAppealPermission(
        authUser,
        existingAppeal.reviewItemComment.reviewItem.review.submission?.memberId,
        'update',
        'APPEAL_UPDATE_FORBIDDEN',
      );

      if (
        !authUser?.isMachine &&
        !isAdmin(authUser) &&
        body.resourceId !== existingAppeal.resourceId
      ) {
        throw new ForbiddenException({
          message: 'Submitters cannot change the resourceId for an appeal.',
          code: 'APPEAL_RESOURCE_UPDATE_FORBIDDEN',
          details: {
            appealId,
            requestedResourceId: body.resourceId,
            existingResourceId: existingAppeal.resourceId,
          },
        });
      }

      if (
        body.reviewItemCommentId !== existingAppeal.reviewItemCommentId &&
        !authUser?.isMachine &&
        !isAdmin(authUser)
      ) {
        const newComment = await this.getReviewItemCommentContext(
          body.reviewItemCommentId,
        );

        if (!newComment) {
          throw new NotFoundException({
            message: `Review item comment with ID ${body.reviewItemCommentId} was not found.`,
            code: 'REVIEW_ITEM_COMMENT_NOT_FOUND',
          });
        }

        this.ensureAppealPermission(
          authUser,
          newComment.reviewItem.review.submission?.memberId,
          'update',
          'APPEAL_UPDATE_FORBIDDEN',
        );
      }

      const data = await this.prisma.appeal.update({
        where: { id: appealId },
        data: { ...body },
      });

      this.logger.log(`Appeal updated successfully: ${appealId}`);
      return data as AppealResponseDto;
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      const errorResponse = this.prismaErrorService.handleError(
        error,
        `updating appeal ${appealId}`,
      );

      if (errorResponse.code === 'RECORD_NOT_FOUND') {
        throw new NotFoundException({
          message: `Appeal with ID ${appealId} was not found. Please verify the appeal ID is correct.`,
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

  async deleteAppeal(
    authUser: JwtUser,
    appealId: string,
  ): Promise<{ message: string }> {
    this.logger.log(`Deleting appeal with ID: ${appealId}`);
    try {
      const existingAppeal = await this.getAppealContext(appealId);

      if (!existingAppeal) {
        throw new NotFoundException({
          message: `Appeal with ID ${appealId} was not found. Cannot delete a non-existent appeal.`,
          code: 'RECORD_NOT_FOUND',
        });
      }

      this.ensureAppealPermission(
        authUser,
        existingAppeal.reviewItemComment.reviewItem.review.submission?.memberId,
        'delete',
        'APPEAL_DELETE_FORBIDDEN',
      );

      await this.prisma.appeal.delete({
        where: { id: appealId },
      });

      this.logger.log(`Appeal deleted successfully: ${appealId}`);
      return { message: `Appeal ${appealId} deleted successfully.` };
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      const errorResponse = this.prismaErrorService.handleError(
        error,
        `deleting appeal ${appealId}`,
      );

      if (errorResponse.code === 'RECORD_NOT_FOUND') {
        throw new NotFoundException({
          message: `Appeal with ID ${appealId} was not found. Cannot delete a non-existent appeal.`,
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

  async createAppealResponse(
    authUser: JwtUser,
    appealId: string,
    body: AppealResponseRequestDto,
  ): Promise<AppealResponseResponseDto> {
    this.logger.log(`Creating response for appeal ID: ${appealId}`);
    try {
      const appeal = await this.prisma.appeal.findUniqueOrThrow({
        where: { id: appealId },
        include: {
          appealResponse: true,
          reviewItemComment: {
            include: {
              reviewItem: {
                include: {
                  review: {
                    select: {
                      resourceId: true,
                      submission: {
                        select: { challengeId: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (appeal.appealResponse) {
        throw new BadRequestException({
          message: `Appeal with ID ${appealId} already has a response.`,
          code: 'APPEAL_ALREADY_RESPONDED',
          details: { appealResponseId: appeal.appealResponse.id },
        });
      }

      if (!authUser) {
        throw new ForbiddenException({
          message:
            'Only the reviewer assigned to this review or an admin may respond to the appeal.',
          code: 'APPEAL_RESPONSE_FORBIDDEN',
        });
      }

      const review = appeal.reviewItemComment.reviewItem.review;
      const reviewerResourceId = review?.resourceId
        ? String(review.resourceId)
        : '';

      if (!reviewerResourceId) {
        throw new BadRequestException({
          message: `No reviewer resource found for appeal ${appealId}.`,
          code: 'MISSING_REVIEWER_RESOURCE',
        });
      }

      const reviewerResource = await this.resourcePrisma.resource.findUnique({
        where: { id: reviewerResourceId },
      });

      if (!reviewerResource) {
        throw new NotFoundException({
          message: `Reviewer resource ${reviewerResourceId} not found for appeal ${appealId}.`,
          code: 'REVIEWER_RESOURCE_NOT_FOUND',
          details: { appealId, reviewerResourceId },
        });
      }

      const reviewerMemberId = reviewerResource.memberId
        ? String(reviewerResource.memberId)
        : '';

      if (!reviewerMemberId) {
        throw new BadRequestException({
          message: `Reviewer resource ${reviewerResourceId} does not have a memberId.`,
          code: 'MISSING_REVIEWER_MEMBER_ID',
          details: { appealId, reviewerResourceId },
        });
      }

      const hasAdminPrivileges = Boolean(
        authUser.isMachine || isAdmin(authUser),
      );

      if (!hasAdminPrivileges) {
        const requesterMemberId = authUser.userId
          ? String(authUser.userId)
          : '';

        if (!requesterMemberId || requesterMemberId !== reviewerMemberId) {
          throw new ForbiddenException({
            message:
              'Only the reviewer assigned to this review or an admin may respond to the appeal.',
            code: 'APPEAL_RESPONSE_FORBIDDEN',
            details: {
              appealId,
              reviewerMemberId,
              requesterMemberId,
              reviewerResourceId,
            },
          });
        }
      }

      const challengeId = review?.submission?.challengeId;
      if (!challengeId) {
        throw new BadRequestException({
          message: `No challengeId found for appeal ${appealId}`,
          code: 'MISSING_CHALLENGE_ID',
        });
      }

      await this.challengeApiService.validateAppealResponseSubmission(
        challengeId,
      );

      const data = await this.prisma.appeal.update({
        where: { id: appealId },
        data: {
          appealResponse: {
            create: {
              ...mapAppealResponseRequestToDto(body),
              resourceId: reviewerResourceId,
            },
          },
        },
        include: {
          appealResponse: true,
        },
      });

      this.logger.log(`Appeal response created for appeal ID: ${appealId}`);
      return data.appealResponse as AppealResponseResponseDto;
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }

      if (error instanceof BadRequestException) {
        throw error;
      }

      if (
        error.message &&
        typeof error.message === 'string' &&
        error.message.includes('Appeal responses cannot be submitted')
      ) {
        throw new BadRequestException({
          message: error.message,
          code: 'PHASE_VALIDATION_ERROR',
        });
      }

      const errorResponse = this.prismaErrorService.handleError(
        error,
        `creating response for appeal ${appealId}`,
      );

      if (errorResponse.code === 'RECORD_NOT_FOUND') {
        throw new NotFoundException({
          message: `Appeal with ID ${appealId} was not found. Cannot create response for a non-existent appeal.`,
          code: errorResponse.code,
          details: errorResponse.details,
        });
      }

      if (errorResponse.code === 'UNIQUE_CONSTRAINT_FAILED') {
        throw new BadRequestException({
          message: `Appeal with ID ${appealId} already has a response.`,
          code: 'APPEAL_ALREADY_RESPONDED',
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

  async updateAppealResponse(
    appealResponseId: string,
    body: AppealResponseRequestDto,
  ): Promise<AppealResponseRequestDto> {
    this.logger.log(`Updating appeal response with ID: ${appealResponseId}`);
    try {
      const data = await this.prisma.appealResponse.update({
        where: { id: appealResponseId },
        data: mapAppealResponseRequestToDto(body),
      });

      this.logger.log(
        `Appeal response updated successfully: ${appealResponseId}`,
      );
      return data as AppealResponseRequestDto;
    } catch (error) {
      const errorResponse = this.prismaErrorService.handleError(
        error,
        `updating appeal response ${appealResponseId}`,
      );

      if (errorResponse.code === 'RECORD_NOT_FOUND') {
        throw new NotFoundException({
          message: `Appeal response with ID ${appealResponseId} was not found. Please verify the appeal response ID is correct.`,
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

  async getAppeals(
    resourceId?: string,
    reviewId?: string,
    paginationDto?: PaginationDto,
  ): Promise<PaginatedResponse<AppealResponseDto>> {
    this.logger.log(
      `Getting appeals with filters - resourceId: ${resourceId}, reviewId: ${reviewId}`,
    );

    const { page = 1, perPage = 10 } = paginationDto || {};
    const skip = (page - 1) * perPage;

    try {
      const whereClause: any = {};
      if (resourceId) whereClause.resourceId = resourceId;
      if (reviewId) {
        whereClause.reviewItemComment = {
          reviewItem: {
            reviewId: reviewId,
          },
        };
      }

      const [appeals, totalCount] = await Promise.all([
        this.prisma.appeal.findMany({
          where: whereClause,
          skip,
          take: perPage,
          include: {
            reviewItemComment: {
              include: {
                reviewItem: true,
              },
            },
            appealResponse: true,
          },
        }),
        this.prisma.appeal.count({
          where: whereClause,
        }),
      ]);

      this.logger.log(
        `Found ${appeals.length} appeals (page ${page} of ${Math.ceil(totalCount / perPage)})`,
      );

      return {
        data: appeals.map((appeal) => ({
          id: appeal.id,
          resourceId: appeal.resourceId,
          reviewItemCommentId: appeal.reviewItemCommentId,
          content: appeal.content,
          createdAt: appeal.createdAt,
          createdBy: appeal.createdBy,
          updatedAt: appeal.updatedAt,
          updatedBy: appeal.updatedBy,
          legacyId: appeal.legacyId,
        })) as AppealResponseDto[],
        meta: {
          page,
          perPage,
          totalCount,
          totalPages: Math.ceil(totalCount / perPage),
        },
      };
    } catch (error) {
      const errorResponse = this.prismaErrorService.handleError(
        error,
        `fetching appeals with filters - resourceId: ${resourceId}, reviewId: ${reviewId}`,
      );

      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  private ensureAppealPermission(
    authUser: JwtUser,
    submissionMemberId: string | null | undefined,
    action: 'create' | 'update' | 'delete',
    errorCode: string,
  ): void {
    if (!authUser) {
      throw new ForbiddenException({
        message: `Only the submission owner or an admin can ${action} this appeal.`,
        code: errorCode,
      });
    }

    if (authUser.isMachine || isAdmin(authUser)) {
      return;
    }

    const requesterId = authUser.userId ? String(authUser.userId) : '';
    const ownerId = submissionMemberId ? String(submissionMemberId) : '';

    if (!requesterId || !ownerId || requesterId !== ownerId) {
      throw new ForbiddenException({
        message: `Only the submission owner or an admin can ${action} this appeal.`,
        code: errorCode,
        details: {
          action,
          requesterId,
          submissionMemberId,
        },
      });
    }
  }

  private getAppealContext(appealId: string) {
    return this.prisma.appeal.findUnique({
      where: { id: appealId },
      include: {
        reviewItemComment: {
          include: {
            reviewItem: {
              include: {
                review: {
                  include: {
                    submission: {
                      select: { id: true, memberId: true, challengeId: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  private getReviewItemCommentContext(reviewItemCommentId: string) {
    return this.prisma.reviewItemComment.findUnique({
      where: { id: reviewItemCommentId },
      include: {
        reviewItem: {
          include: {
            review: {
              include: {
                submission: {
                  select: { id: true, memberId: true, challengeId: true },
                },
              },
            },
          },
        },
      },
    });
  }
}
