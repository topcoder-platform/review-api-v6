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
  Req,
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
} from 'src/dto/review.dto';
import { PaginatedResponse, PaginationDto } from '../../dto/pagination.dto';
import { ReviewService } from './review.service';
import { Request } from 'express';

@ApiTags('Reviews')
@ApiBearerAuth()
@Controller('/reviews')
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  @Post()
  @Roles(UserRole.Reviewer, UserRole.Admin)
  @Scopes(Scope.CreateReview)
  @ApiOperation({
    summary: 'Create a new review',
    description: 'Roles: Reviewer, Admin | Scopes: create:review',
  })
  @ApiBody({ description: 'Review data', type: ReviewRequestDto })
  @ApiResponse({
    status: 201,
    description: 'Review created successfully.',
    type: ReviewResponseDto,
  })
  async createReview(
    @Req() req: Request,
    @Body() body: ReviewRequestDto,
  ): Promise<ReviewResponseDto> {
    const authUser = req['user'];
    return this.reviewService.createReview(authUser as any, body);
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
    return this.reviewService.createReviewItemComments(body);
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
    return this.reviewService.updateReview(reviewId, body);
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
    return this.reviewService.updateReview(reviewId, body);
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
    return this.reviewService.updateReviewItem(itemId, body);
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
    @Req() req: Request,
    @Query('status') status?: ReviewStatus,
    @Query('challengeId') challengeId?: string,
    @Query('submissionId') submissionId?: string,
    @Query() paginationDto?: PaginationDto,
  ): Promise<PaginatedResponse<ReviewResponseDto>> {
    const authUser = req['user'];
    return this.reviewService.getReviews(
      authUser as any,
      status,
      challengeId,
      submissionId,
      paginationDto,
    );
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
    @Req() req: Request,
    @Param('reviewId') reviewId: string,
  ): Promise<ReviewResponseDto> {
    const authUser = req['user'];
    return this.reviewService.getReview(authUser as any, reviewId);
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
    return this.reviewService.deleteReview(reviewId);
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
    return this.reviewService.deleteReviewItem(itemId);
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
    return this.reviewService.getReviewProgress(challengeId);
  }
}
