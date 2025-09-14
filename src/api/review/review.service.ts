import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
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

  async createReview(body: ReviewRequestDto): Promise<ReviewResponseDto> {
    this.logger.log(`Creating review for submissionId: ${body.submissionId}`);
    try {
      const submission = await this.prisma.submission.findUniqueOrThrow({
        where: { id: body.submissionId },
        select: { challengeId: true },
      });

      if (!submission.challengeId) {
        throw new BadRequestException({
          message: `Submission ${body.submissionId} does not have an associated challengeId`,
          code: 'MISSING_CHALLENGE_ID',
        });
      }

      await this.challengeApiService.validateReviewSubmission(
        submission.challengeId,
      );

      const prismaBody = mapReviewRequestToDto(body) as any;
      const data = await this.prisma.review.create({
        data: prismaBody,
        include: {
          reviewItems: {
            include: {
              reviewItemComments: true,
            },
          },
        },
      });
      this.logger.log(`Review created with ID: ${data.id}`);
      return data as unknown as ReviewResponseDto;
    } catch (error) {
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
      const data = await this.prisma.reviewItem.create({
        data: mapped as any,
        include: {
          reviewItemComments: true,
        },
      });
      this.logger.log(`Review item created with ID: ${data.id}`);
      return data as unknown as ReviewItemResponseDto;
    } catch (error) {
      const errorResponse = this.prismaErrorService.handleError(
        error,
        `creating review item for reviewId: ${body.reviewId}`,
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  async updateReview(
    id: string,
    body: ReviewPatchRequestDto | ReviewPutRequestDto,
  ): Promise<ReviewResponseDto> {
    this.logger.log(`Updating review with ID: ${id}`);
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
      const data = await this.prisma.reviewItem.update({
        where: { id: itemId },
        data: mapReviewItemRequestForUpdate(body),
        include: {
          reviewItemComments: true,
        },
      });
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

  async getReview(reviewId: string): Promise<ReviewResponseDto> {
    this.logger.log(`Getting review with ID: ${reviewId}`);
    try {
      const data = await this.prisma.review.findUniqueOrThrow({
        where: { id: reviewId },
        include: {
          reviewItems: {
            include: {
              reviewItemComments: true,
            },
          },
        },
      });

      this.logger.log(`Review found: ${reviewId}`);
      return data as ReviewResponseDto;
    } catch (error) {
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
      await this.prisma.reviewItem.delete({
        where: { id: itemId },
      });
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
