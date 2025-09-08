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
  mapReviewRequestToDto,
  mapReviewItemRequestToDto,
} from 'src/dto/review.dto';
import { PrismaService } from '../../shared/modules/global/prisma.service';
import { ScorecardStatus } from '../../dto/scorecard.dto';
import { LoggerService } from '../../shared/modules/global/logger.service';
import { PaginatedResponse, PaginationDto } from '../../dto/pagination.dto';
import { PrismaErrorService } from '../../shared/modules/global/prisma-error.service';
import { ResourceApiService } from '../../shared/modules/global/resource.service';

@ApiTags('Reviews')
@ApiBearerAuth()
@Controller('/reviews')
export class ReviewController {
  private readonly logger: LoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaErrorService: PrismaErrorService,
    private readonly resourceApiService: ResourceApiService,
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
      const prismaBody = mapReviewRequestToDto(body) as any
      const data = await this.prisma.review.create({
        data:prismaBody as any,
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
      const errorResponse = this.prismaErrorService.handleError(
        error,
        'creating review',
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
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
      const data = await this.prisma.reviewItem.create({
        data: mapReviewItemRequestToDto(body),
        include: {
          reviewItemComments: true,
        },
      });
      this.logger.log(`Review item created with ID: ${data.id}`);
      return data as unknown as ReviewItemResponseDto;
    } catch (error) {
      const errorResponse = this.prismaErrorService.handleError(
        error,
        'creating review item',
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
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
        `updating review ${id}`,
      );

      if (errorResponse.code === 'RECORD_NOT_FOUND') {
        throw new NotFoundException({
          message: `Review with ID ${id} was not found`,
          code: errorResponse.code,
        });
      }

      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
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
        data: mapReviewItemRequestToDto(body),
        include: {
          reviewItemComments: true,
        },
      });
      this.logger.log(`Review item updated successfully: ${itemId}`);
      return data as unknown as ReviewItemResponseDto;
    } catch (error) {
      const errorResponse = this.prismaErrorService.handleError(
        error,
        `updating review item ${itemId}`,
      );

      if (errorResponse.code === 'RECORD_NOT_FOUND') {
        throw new NotFoundException({
          message: `Review item with ID ${itemId} was not found`,
          code: errorResponse.code,
        });
      }

      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
      });
    }
  }

  @Get()
  @Roles(UserRole.Reviewer, UserRole.Copilot, UserRole.Admin, UserRole.User)
  @Scopes(Scope.ReadReview)
  @ApiOperation({
    summary: 'Search for pending reviews',
    description:
      'Roles: Reviewer, Copilot, Admin, User. For User, only applies to their own review, until challenge completion. | Scopes: read:review',
  })
  @ApiQuery({
    name: 'status',
    description: 'The review status to filter by',
    example: 'pending',
    required: false,
    enum: ScorecardStatus,
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
    description: 'List of pending reviews.',
    type: [ReviewResponseDto],
  })
  async getPendingReviews(
    @Query('status') status?: ScorecardStatus,
    @Query('challengeId') challengeId?: string,
    @Query('submissionId') submissionId?: string,
    @Query() paginationDto?: PaginationDto,
  ): Promise<PaginatedResponse<ReviewResponseDto>> {
    this.logger.log(
      `Getting pending reviews with filters - status: ${status}, challengeId: ${challengeId}, submissionId: ${submissionId}`,
    );

    const { page = 1, perPage = 10 } = paginationDto || {};
    const skip = (page - 1) * perPage;

    try {
      // Build the where clause for reviews based on available filter parameters
      const reviewWhereClause: any = {};
      if (submissionId) {
        reviewWhereClause.submissionId = submissionId;
      }

      // Get reviews by status if provided
      let reviews: any[] = [];
      let totalCount = 0;

      if (status) {
        this.logger.debug(`Fetching reviews by scorecard status: ${status}`);
        const scorecards = await this.prisma.scorecard.findMany({
          where: {
            status: ScorecardStatus[status as keyof typeof ScorecardStatus],
          },
          include: {
            reviews: {
              where: reviewWhereClause,
              skip,
              take: perPage,
            },
          },
        });

        reviews = scorecards.flatMap((d) => d.reviews);

        // Count total reviews matching the filter for pagination metadata
        const scorecardIds = scorecards.map((s) => s.id);
        totalCount = await this.prisma.review.count({
          where: {
            ...reviewWhereClause,
            scorecardId: { in: scorecardIds },
          },
        });
      }

      // Get reviews by challengeId if provided
      if (challengeId) {
        this.logger.debug(`Fetching reviews by challengeId: ${challengeId}`);
        const challengeResults = await this.prisma.challengeResult.findMany({
          where: { challengeId },
        });

        const submissionIds = challengeResults.map((c) => c.submissionId);

        if (submissionIds.length > 0) {
          const challengeReviews = await this.prisma.review.findMany({
            where: {
              submissionId: { in: submissionIds },
              ...reviewWhereClause,
            },
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

          reviews = [...reviews, ...challengeReviews];

          // Count total for this condition separately
          const challengeReviewCount = await this.prisma.review.count({
            where: {
              submissionId: { in: submissionIds },
              ...reviewWhereClause,
            },
          });

          totalCount += challengeReviewCount;
        }
      }

      // If no specific filters, get all reviews with pagination
      if (!status && !challengeId && !submissionId) {
        this.logger.debug('Fetching all reviews with pagination');
        reviews = await this.prisma.review.findMany({
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

        totalCount = await this.prisma.review.count();
      }

      // Deduplicate reviews by ID
      const uniqueReviews = Object.values(
        reviews.reduce((acc: Record<string, any>, review) => {
          if (!acc[review.id]) {
            acc[review.id] = review;
          }
          return acc;
        }, {}),
      );

      this.logger.log(
        `Found ${uniqueReviews.length} reviews (page ${page} of ${Math.ceil(totalCount / perPage)})`,
      );

      return {
        data: uniqueReviews as ReviewResponseDto[],
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
        'fetching reviews',
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
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
        `fetching review ${reviewId}`,
      );

      if (errorResponse.code === 'RECORD_NOT_FOUND') {
        throw new NotFoundException({
          message: `Review with ID ${reviewId} was not found`,
          code: errorResponse.code,
        });
      }

      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
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
        `deleting review ${reviewId}`,
      );

      if (errorResponse.code === 'RECORD_NOT_FOUND') {
        throw new NotFoundException({
          message: `Review with ID ${reviewId} was not found`,
          code: errorResponse.code,
        });
      }

      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
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
        `deleting review item ${itemId}`,
      );

      if (errorResponse.code === 'RECORD_NOT_FOUND') {
        throw new NotFoundException({
          message: `Review item with ID ${itemId} was not found`,
          code: errorResponse.code,
        });
      }

      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
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
