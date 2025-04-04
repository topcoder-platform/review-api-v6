import {
  Controller,
  Post,
  Patch,
  Get,
  Delete,
  Body,
  Param,
  Query,
  NotFoundException,
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
  ReviewResponseDto,
  ReviewItemRequestDto,
  ReviewItemResponseDto,
  mapReviewRequestToDto,
  mapReviewItemRequestToDto,
} from 'src/dto/review.dto';
import { PrismaService } from '../../shared/modules/global/prisma.service';
import { ScorecardStatus } from '../../dto/scorecard.dto';
import { LoggerService } from '../../shared/modules/global/logger.service';
import { PaginatedResponse, PaginationDto } from '../../dto/pagination.dto';

@ApiTags('Reviews')
@ApiBearerAuth()
@Controller('/api/reviews')
export class ReviewController {
  private readonly logger: LoggerService;

  constructor(private readonly prisma: PrismaService) {
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
      const data = await this.prisma.review.create({
        data: mapReviewRequestToDto(body),
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
      this.logger.error(`Failed to create review: ${error.message}`, error.stack);
      throw new InternalServerErrorException({
        message: `Failed to create review: ${error.message}`,
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
      this.logger.error(`Failed to create review item: ${error.message}`, error.stack);
      throw new InternalServerErrorException({
        message: `Failed to create review item: ${error.message}`,
      });
    }
  }

  @Patch('/:id')
  @Roles(UserRole.Reviewer)
  @Scopes(Scope.UpdateReview)
  @ApiOperation({
    summary: 'Update a review partially',
    description: 'Roles: Reviewer | Scopes: update:review',
  })
  @ApiParam({
    name: 'id',
    description: 'The ID of the review',
    example: 'review123',
  })
  @ApiBody({ description: 'Review data', type: ReviewRequestDto })
  @ApiResponse({
    status: 200,
    description: 'Review updated successfully.',
    type: ReviewResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Review not found.' })
  async updateReview(
    @Param('id') id: string,
    @Body() body: ReviewRequestDto,
  ): Promise<ReviewResponseDto> {
    this.logger.log(`Updating review with ID: ${id}`);
    try {
      const data = await this.prisma.review.update({
        where: { id },
        data: mapReviewRequestToDto(body),
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
      this.logger.error(`Failed to update review ${id}: ${error.message}`, error.stack);
      if (error.code === 'P2025') {
        throw new NotFoundException({ message: `Review not found with ID: ${id}` });
      }
      throw new InternalServerErrorException({
        message: `Error updating review: ${error.message}`,
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
      this.logger.error(`Failed to update review item ${itemId}: ${error.message}`, error.stack);
      if (error.code === 'P2025') {
        throw new NotFoundException({ message: `Review item not found with ID: ${itemId}` });
      }
      throw new InternalServerErrorException({
        message: `Error updating review item: ${error.message}`,
      });
    }
  }

  @Get()
  @Roles(
    UserRole.Reviewer,
    UserRole.Copilot,
    UserRole.Admin,
    UserRole.Submitter,
  )
  @Scopes(Scope.ReadReview)
  @ApiOperation({
    summary: 'Search for pending reviews',
    description:
      'Roles: Reviewer, Copilot, Admin, Submitter. For Submitter, only applies to their own review, until challenge completion. | Scopes: read:review',
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
    this.logger.log(`Getting pending reviews with filters - status: ${status}, challengeId: ${challengeId}, submissionId: ${submissionId}`);

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
        const scorecardIds = scorecards.map(s => s.id);
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

        const submissionIds = challengeResults.map(c => c.submissionId);
        
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
        reviews.reduce((acc, review) => {
          if (!acc[review.id]) {
            acc[review.id] = review;
          }
          return acc;
        }, {})
      );

      this.logger.log(`Found ${uniqueReviews.length} reviews (page ${page} of ${Math.ceil(totalCount / perPage)})`);
      
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
      this.logger.error(`Error getting pending reviews: ${error.message}`, error.stack);
      throw new InternalServerErrorException({
        message: `Failed to fetch reviews: ${error.message}`,
      });
    }
  }

  @Get('/:id')
  @Roles(
    UserRole.Reviewer,
    UserRole.Copilot,
    UserRole.Submitter,
    UserRole.Admin,
  )
  @Scopes(Scope.ReadReview)
  @ApiOperation({
    summary: 'View a specific review',
    description:
      'Roles: Reviewer, Copilot, Submitter, Admin | Scopes: read:review',
  })
  @ApiParam({
    name: 'id',
    description: 'The ID of the review',
    example: 'review123',
  })
  @ApiResponse({
    status: 200,
    description: 'Review retrieved successfully.',
    type: ReviewResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Review not found.' })
  async getReview(@Param('id') id: string): Promise<ReviewResponseDto> {
    this.logger.log(`Getting review with ID: ${id}`);
    try {
      const data = await this.prisma.review.findUniqueOrThrow({
        where: { id },
        include: {
          reviewItems: {
            include: {
              reviewItemComments: true,
            },
          },
        },
      });
      
      this.logger.log(`Review found: ${id}`);
      return data as ReviewResponseDto;
    } catch (error) {
      this.logger.error(`Failed to get review ${id}: ${error.message}`, error.stack);
      if (error.code === 'P2025') {
        throw new NotFoundException({ message: `Review not found with ID: ${id}` });
      }
      throw new InternalServerErrorException({
        message: `Error fetching review: ${error.message}`,
      });
    }
  }

  @Delete('/:id')
  @Roles(UserRole.Copilot, UserRole.Admin)
  @Scopes(Scope.DeleteReview)
  @ApiOperation({
    summary: 'Delete a review',
    description: 'Roles: Copilot, Admin | Scopes: delete:review',
  })
  @ApiParam({
    name: 'id',
    description: 'The ID of the review',
    example: 'mock-review-id',
  })
  @ApiResponse({
    status: 200,
    description: 'Review deleted successfully.',
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Review not found.' })
  async deleteReview(@Param('id') id: string) {
    this.logger.log(`Deleting review with ID: ${id}`);
    try {
      await this.prisma.review.delete({
        where: { id },
      });
      this.logger.log(`Review deleted successfully: ${id}`);
      return { message: `Review ${id} deleted successfully.` };
    } catch (error) {
      this.logger.error(`Failed to delete review ${id}: ${error.message}`, error.stack);
      if (error.code === 'P2025') {
        throw new NotFoundException({ message: `Review not found with ID: ${id}` });
      }
      throw new InternalServerErrorException({
        message: `Error deleting review: ${error.message}`,
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
      this.logger.error(`Failed to delete review item ${itemId}: ${error.message}`, error.stack);
      if (error.code === 'P2025') {
        throw new NotFoundException({ message: `Review item not found with ID: ${itemId}` });
      }
      throw new InternalServerErrorException({
        message: `Error deleting review item: ${error.message}`,
      });
    }
  }
}
