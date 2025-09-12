import {
  Controller,
  Post,
  Patch,
  Put,
  Get,
  Delete,
  Body,
  Param,
  Query,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Roles } from 'src/shared/guards/tokenRoles.guard';
import { UserRole } from 'src/shared/enums/userRole.enum';
import { Scopes } from 'src/shared/decorators/scopes.decorator';
import { Scope } from 'src/shared/enums/scopes.enum';
import {
  ReviewRequestDto,
  ReviewPutRequestDto,
  ReviewPatchRequestDto,
  ReviewResponseDto,
  ReviewItemRequestDto,
  ReviewItemResponseDto,
  ReviewProgressResponseDto,
  ReviewStatus,
  mapReviewRequestToDto,
  mapReviewItemRequestToDto,
  mapReviewItemRequestForUpdate,
} from 'src/dto/review.dto';
import { PrismaService } from '../../shared/modules/global/prisma.service';
import { LoggerService } from '../../shared/modules/global/logger.service';
import { PaginatedResponse, PaginationDto } from '../../dto/pagination.dto';
import { PrismaErrorService } from '../../shared/modules/global/prisma-error.service';
import { ResourceApiService } from '../../shared/modules/global/resource.service';
import { ChallengeApiService } from '../../shared/modules/global/challenge.service';

@ApiTags('Reviews')
@ApiBearerAuth()
@Controller('/reviews')
export class ReviewController {
  private readonly logger: LoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaErrorService: PrismaErrorService,
    private readonly resourceApiService: ResourceApiService,
    private readonly challengeApiService: ChallengeApiService,
  ) {
    this.logger = LoggerService.forRoot('ReviewController');
  }

  @Post()
  @Roles(UserRole.Reviewer)
  @Scopes(Scope.CreateReview)
  @ApiOperation({
    summary: 'Create a new review',
    description: 'Roles: Reviewer | Scopes: create:review',
  })
  @ApiBody({ description: 'Review data', type: ReviewRequestDto })
  @ApiResponse({
    status: 201,
    description: 'Review created successfully.',
    type: ReviewResponseDto,
  })
  async createReview(
    @Body() body: ReviewRequestDto,
  ): Promise<ReviewResponseDto> {
    this.logger.log(`Creating review for submissionId: ${body.submissionId}`);
    try {
      // Get the submission to find the challengeId
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

      // Validate that review submission is allowed for this challenge
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
      // Handle phase validation errors
      if (
        error.message &&
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

  @Post('/items')
  @Roles(UserRole.Reviewer, UserRole.Copilot)
  @Scopes(Scope.CreateReviewItem)
  @ApiOperation({
    summary: 'Create review item',
    description: 'Roles: Reviewer, Copilot | Scopes: create:review-item',
  })
  @ApiBody({ description: 'Review item data', type: ReviewItemRequestDto })
  @ApiResponse({
    status: 201,
    description: 'Review item comments created successfully.',
    type: ReviewItemResponseDto,
  })
  async createReviewItemComments(
    @Body() body: ReviewItemRequestDto,
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
        // Cast after validation to satisfy Prisma types for top-level create
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

  @Patch('/:reviewId')
  @Roles(UserRole.Reviewer)
  @Scopes(Scope.UpdateReview)
  @ApiOperation({
    summary: 'Update a review partially',
    description: 'Roles: Reviewer | Scopes: update:review',
  })
  @ApiParam({
    name: 'reviewId',
    description: 'The ID of the review',
    example: 'review123',
  })
  @ApiBody({ description: 'Review data', type: ReviewPatchRequestDto })
  @ApiResponse({
    status: 200,
    description: 'Review updated successfully.',
    type: ReviewResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Review not found.' })
  async updateReview(
    @Param('reviewId') reviewId: string,
    @Body() body: ReviewPatchRequestDto,
  ): Promise<ReviewResponseDto> {
    return this._updateReview(reviewId, body);
  }

  @Put('/:reviewId')
  @Roles(UserRole.Reviewer)
  @Scopes(Scope.UpdateReview)
  @ApiOperation({
    summary: 'Update a review partially',
    description: 'Roles: Reviewer | Scopes: update:review',
  })
  @ApiParam({
    name: 'reviewId',
    description: 'The ID of the review',
    example: 'review123',
  })
  @ApiBody({ description: 'Review data', type: ReviewPutRequestDto })
  @ApiResponse({
    status: 200,
    description: 'Review updated successfully.',
    type: ReviewResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Review not found.' })
  async updatePutReview(
    @Param('reviewId') reviewId: string,
    @Body() body: ReviewPutRequestDto,
  ): Promise<ReviewResponseDto> {
    return this._updateReview(reviewId, body);
  }

  /**
   * The inner update method for entity
   */
  async _updateReview(
    id: string,
    body: ReviewPatchRequestDto | ReviewPutRequestDto,
  ) {
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

  @Patch('/items/:itemId')
  @Roles(UserRole.Reviewer, UserRole.Copilot, UserRole.Admin)
  @Scopes(Scope.UpdateReviewItem)
  @ApiOperation({
    summary:
      'Update a specific review item, if copilot is patching, manager comment is required',
    description: 'Roles: Reviewer, Copilot, Admin | Scopes: update:review-item',
  })
  @ApiParam({
    name: 'itemId',
    description: 'The ID of the review item',
    example: 'item456',
  })
  @ApiBody({ description: 'Review item data', type: ReviewItemRequestDto })
  @ApiResponse({
    status: 200,
    description: 'Review item updated successfully.',
    type: ReviewItemResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Review item not found.' })
  async updateReviewItem(
    @Param('itemId') itemId: string,
    @Body() body: ReviewItemRequestDto,
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

  @Get()
  @Roles(UserRole.Reviewer, UserRole.Copilot, UserRole.Admin, UserRole.User)
  @Scopes(Scope.ReadReview)
  @ApiOperation({
    summary: 'Search for reviews',
    description:
      'Roles: Reviewer, Copilot, Admin, User. For User, only applies to their own review, until challenge completion. | Scopes: read:review',
  })
  @ApiQuery({
    name: 'status',
    description: 'The review status to filter by',
    enum: ReviewStatus,
    example: ReviewStatus.PENDING,
    required: false,
  })
  @ApiQuery({
    name: 'challengeId',
    description: 'The ID of the challenge to filter by',
    required: false,
  })
  @ApiQuery({
    name: 'submissionId',
    description: 'The ID of the submission to filter by',
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'List of reviews.',
    type: [ReviewResponseDto],
  })
  async getReviews(
    @Query('status') status?: ReviewStatus,
    @Query('challengeId') challengeId?: string,
    @Query('submissionId') submissionId?: string,
    @Query() paginationDto?: PaginationDto,
  ): Promise<PaginatedResponse<ReviewResponseDto>> {
    this.logger.log(
      `Getting reviews with filters - status: ${status}, challengeId: ${challengeId}, submissionId: ${submissionId}`,
    );

    const { page = 1, perPage = 10 } = paginationDto || {};
    const skip = (page - 1) * perPage;

    try {
      // Build the where clause for reviews based on available filter parameters
      const reviewWhereClause: any = {};

      if (submissionId) {
        reviewWhereClause.submissionId = submissionId;
      }

      if (status) {
        reviewWhereClause.status = status;
      }

      // Get reviews by challengeId if provided
      if (challengeId) {
        this.logger.debug(`Fetching reviews by challengeId: ${challengeId}`);
        // Get submissions for this challenge directly (consistent with POST /reviews)
        const submissions = await this.prisma.submission.findMany({
          where: { challengeId },
          select: { id: true },
        });

        const submissionIds = submissions.map((s) => s.id);

        if (submissionIds.length > 0) {
          reviewWhereClause.submissionId = { in: submissionIds };
        } else {
          // No submissions found for this challenge, return empty result
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

      // Get reviews with the built where clause
      this.logger.debug(
        `Fetching reviews with where clause:`,
        reviewWhereClause,
      );
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

      // Count total reviews matching the filter for pagination metadata
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

  @Get('/:reviewId')
  @Roles(UserRole.Reviewer, UserRole.Copilot, UserRole.User, UserRole.Admin)
  @Scopes(Scope.ReadReview)
  @ApiOperation({
    summary: 'View a specific review',
    description: 'Roles: Reviewer, Copilot, User, Admin | Scopes: read:review',
  })
  @ApiParam({
    name: 'reviewId',
    description: 'The ID of the review',
    example: 'review123',
  })
  @ApiResponse({
    status: 200,
    description: 'Review retrieved successfully.',
    type: ReviewResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Review not found.' })
  async getReview(
    @Param('reviewId') reviewId: string,
  ): Promise<ReviewResponseDto> {
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

  @Delete('/:reviewId')
  @Roles(UserRole.Copilot, UserRole.Admin)
  @Scopes(Scope.DeleteReview)
  @ApiOperation({
    summary: 'Delete a review',
    description: 'Roles: Copilot, Admin | Scopes: delete:review',
  })
  @ApiParam({
    name: 'reviewId',
    description: 'The ID of the review',
    example: 'mock-review-id',
  })
  @ApiResponse({
    status: 200,
    description: 'Review deleted successfully.',
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Review not found.' })
  async deleteReview(@Param('reviewId') reviewId: string) {
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

  @Delete('/items/:itemId')
  @Roles(UserRole.Copilot, UserRole.Admin)
  @Scopes(Scope.DeleteReviewItem)
  @ApiOperation({
    summary: 'Delete a review item',
    description: 'Roles: Copilot, Admin | Scopes: delete:review-item',
  })
  @ApiParam({
    name: 'itemId',
    description: 'The ID of the review item',
    example: 'mock-item-id',
  })
  @ApiResponse({
    status: 200,
    description: 'Review item deleted successfully.',
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Review item not found.' })
  async deleteReviewItem(@Param('itemId') itemId: string) {
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

  @Get('/progress/:challengeId')
  @Roles(UserRole.Admin, UserRole.Copilot, UserRole.Reviewer, UserRole.User)
  @Scopes(Scope.ReadReview)
  @ApiOperation({
    summary: 'Get review progress for a specific challenge',
    description:
      'Calculate and return the review progress percentage for a challenge. Accessible to all authenticated users. | Scopes: read:review',
  })
  @ApiParam({
    name: 'challengeId',
    description: 'The ID of the challenge to calculate progress for',
    example: 'challenge123',
  })
  @ApiResponse({
    status: 200,
    description: 'Review progress calculated successfully.',
    type: ReviewProgressResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid challengeId parameter.',
  })
  @ApiResponse({
    status: 404,
    description: 'Challenge not found or no data available.',
  })
  @ApiResponse({
    status: 500,
    description: 'Server error during calculation.',
  })
  async getReviewProgress(
    @Param('challengeId') challengeId: string,
  ): Promise<ReviewProgressResponseDto> {
    this.logger.log(
      `Calculating review progress for challenge: ${challengeId}`,
    );

    try {
      // Validate challengeId parameter
      if (
        !challengeId ||
        typeof challengeId !== 'string' ||
        challengeId.trim() === ''
      ) {
        throw new Error('Invalid challengeId parameter');
      }

      // Get reviewers from Resource API
      this.logger.debug('Fetching reviewers from Resource API');
      const resources = await this.resourceApiService.getResources({
        challengeId,
      });

      // Get resource roles to filter by reviewer role
      const resourceRoles = await this.resourceApiService.getResourceRoles();

      // Filter resources to get only reviewers
      const reviewers = resources.filter((resource) => {
        const role = resourceRoles[resource.roleId];
        return role && role.name.toLowerCase().includes('reviewer');
      });

      const totalReviewers = reviewers.length;
      this.logger.debug(
        `Found ${totalReviewers} reviewers for challenge ${challengeId}`,
      );

      // Get submissions for the challenge
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

      // Get submitted reviews for these submissions
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

      // Calculate progress percentage
      let progressPercentage = 0;

      if (totalReviewers > 0 && totalSubmissions > 0) {
        const expectedTotalReviews = totalSubmissions * totalReviewers;
        progressPercentage =
          (totalSubmittedReviews / expectedTotalReviews) * 100;
        // Round to 2 decimal places
        progressPercentage = Math.round(progressPercentage * 100) / 100;
      }

      // Handle edge cases
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

      if (error.message === 'Invalid challengeId parameter') {
        throw new Error('Invalid challengeId parameter');
      }

      // Handle Resource API errors based on HTTP status codes
      if (error.message === 'Cannot get data from Resource API.') {
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

      if (error.message && error.message.includes('not found')) {
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
