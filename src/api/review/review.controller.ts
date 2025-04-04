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

@ApiTags('Reviews')
@ApiBearerAuth()
@Controller('/api/reviews')
export class ReviewController {
  constructor(private readonly prisma: PrismaService) {}

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
    return data as unknown as ReviewResponseDto;
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
    const data = await this.prisma.reviewItem.create({
      data: mapReviewItemRequestToDto(body),
      include: {
        reviewItemComments: true,
      },
    });
    return data as unknown as ReviewItemResponseDto;
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
    const data = await this.prisma.review
      .update({
        where: { id },
        data: mapReviewRequestToDto(body),
        include: {
          reviewItems: {
            include: {
              reviewItemComments: true,
            },
          },
        },
      })
      .catch((error) => {
        if (error.code !== 'P2025') {
          throw new NotFoundException({ message: `Review not found.` });
        }
        throw new InternalServerErrorException({
          message: `Error: ${error.code}`,
        });
      });
    return data as unknown as ReviewResponseDto;
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
    const data = await this.prisma.reviewItem
      .update({
        where: { id: itemId },
        data: mapReviewItemRequestToDto(body),
        include: {
          reviewItemComments: true,
        },
      })
      .catch((error) => {
        if (error.code !== 'P2025') {
          throw new NotFoundException({ message: `Review item not found.` });
        }
        throw new InternalServerErrorException({
          message: `Error: ${error.code}`,
        });
      });
    return data as unknown as ReviewItemResponseDto;
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
  @ApiQuery({
    name: 'page',
    description: 'Page number (starts from 1)',
    required: false,
    type: Number,
    example: 1,
  })
  @ApiQuery({
    name: 'perPage',
    description: 'Number of items per page',
    required: false,
    type: Number,
    example: 10,
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
    @Query('page') page: number = 1,
    @Query('perPage') perPage: number = 10,
  ) {
    const skip = (page - 1) * perPage;
    const scorecardReviews = status
      ? (
          await this.prisma.scorecard.findMany({
            where: {
              status: ScorecardStatus[status as keyof typeof ScorecardStatus],
            },
            include: {
              reviews: {
                where: {
                  submissionId: submissionId ? submissionId : {},
                },
              },
            },
            skip,
            take: perPage,
          })
        ).flatMap((d) => d.reviews)
      : [];

    const challengeSubmissionId = challengeId
      ? (
          await this.prisma.challengeResult.findMany({
            where: {
              challengeId,
            },
          })
        ).map((c) => c.submissionId)
      : [];

    if (submissionId) {
      challengeSubmissionId.push(submissionId);
    }

    const challengeReviews = challengeSubmissionId
      ? await this.prisma.review.findMany({
          where: {
            submissionId: { in: challengeSubmissionId },
          },
          skip,
          take: perPage,
        })
      : [];

    return [...scorecardReviews, ...challengeReviews].reduce((acc, review) => {
      acc[review.id] = review;
      return acc;
    }, {}) as ReviewResponseDto[];
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
    const data = await this.prisma.review
      .findUniqueOrThrow({
        where: { id },
        include: {
          reviewItems: {
            include: {
              reviewItemComments: true,
            },
          },
        },
      })
      .catch((error) => {
        if (error.code !== 'P2025') {
          throw new NotFoundException({ message: `Review not found.` });
        }
        throw new InternalServerErrorException({
          message: `Error: ${error.code}`,
        });
      });
    return data as ReviewResponseDto;
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
    await this.prisma.review
      .delete({
        where: { id },
      })
      .catch((error) => {
        if (error.code !== 'P2025') {
          throw new NotFoundException({ message: `Review not found.` });
        }
        throw new InternalServerErrorException({
          message: `Error: ${error.code}`,
        });
      });
    return { message: `Review ${id} deleted successfully.` };
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
    await this.prisma.reviewItem
      .delete({
        where: { id: itemId },
      })
      .catch((error) => {
        if (error.code !== 'P2025') {
          throw new NotFoundException({ message: `Review item not found.` });
        }
        throw new InternalServerErrorException({
          message: `Error: ${error.code}`,
        });
      });
    return {
      message: `Review item ${itemId} deleted successfully.`,
    };
  }
}
