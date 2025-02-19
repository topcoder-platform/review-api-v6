import {
  Controller,
  Post,
  Patch,
  Get,
  Delete,
  Body,
  Param,
  Query,
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
import { Roles, UserRole } from 'src/shared/guards/tokenRoles.guard';
import {
  ReviewRequestDto,
  ReviewResponseDto,
  ReviewItemRequestDto,
  ReviewItemResponseDto,
  mockReviewResponse,
} from 'src/dto/review.dto';

@ApiTags('Reviews')
@ApiBearerAuth()
@Controller('/api/reviews')
export class ReviewController {
  @Post()
  @Roles(UserRole.Reviewer)
  @ApiOperation({
    summary: 'Create a new review',
    description: 'Roles: Reviewer',
  })
  @ApiBody({ description: 'Review data', type: ReviewRequestDto })
  @ApiResponse({
    status: 201,
    description: 'Review created successfully.',
    type: ReviewResponseDto,
  })
  createReview(@Body() body: ReviewRequestDto): ReviewResponseDto {
    return mockReviewResponse;
  }

  @Post('/items')
  @Roles(UserRole.Reviewer, UserRole.Copilot)
  @ApiOperation({
    summary: 'Create review item',
    description: 'Roles: Reviewer',
  })
  @ApiBody({ description: 'Review item data', type: ReviewItemRequestDto })
  @ApiResponse({
    status: 201,
    description: 'Review item comments created successfully.',
    type: ReviewResponseDto,
  })
  createReviewItemComments(
    @Body() body: ReviewItemRequestDto,
  ): ReviewResponseDto {
    return mockReviewResponse;
  }

  @Patch('/:id')
  @Roles(UserRole.Reviewer)
  @ApiOperation({
    summary: 'Update a review partially',
    description: 'Roles: Reviewer',
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
  updateReview(
    @Param('id') id: string,
    @Body() body: ReviewRequestDto,
  ): ReviewResponseDto {
    return mockReviewResponse;
  }

  @Patch('/:id/items/:itemId')
  @Roles(UserRole.Reviewer, UserRole.Copilot, UserRole.Admin)
  @ApiOperation({
    summary:
      'Update a specific review item, if copilot is patching, manager comment is required',
    description: 'Roles: Reviewer, Copilot, Admin',
  })
  @ApiParam({
    name: 'id',
    description: 'The ID of the review',
    example: 'review123',
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
  updateReviewItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: ReviewItemRequestDto,
  ): ReviewItemResponseDto {
    return mockReviewResponse.reviewItems![0];
  }

  @Get('/:id')
  @Roles(
    UserRole.Reviewer,
    UserRole.Copilot,
    UserRole.Submitter,
    UserRole.Admin,
  )
  @ApiOperation({
    summary: 'View a specific review',
    description: 'Roles: Reviewer, Copilot, Submitter, Admin',
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
  getReview(@Param('id') id: string): ReviewResponseDto {
    return mockReviewResponse;
  }

  @Get()
  @Roles(
    UserRole.Reviewer,
    UserRole.Copilot,
    UserRole.Admin,
    UserRole.Submitter,
  )
  @ApiOperation({
    summary: 'Search for pending reviews',
    description:
      'Roles: Reviewer, Copilot, Admin, Submitter. For Submitter, only applies to their own review, until challenge completion',
  })
  @ApiQuery({
    name: 'status',
    description: 'The review status to filter by',
    example: 'pending',
    required: false,
  })
  @ApiQuery({
    name: 'submissionId',
    description: 'The ID of the submission to filter by',
    required: false,
  })
  @ApiQuery({
    name: 'challengeId',
    description: 'The ID of the challenge to filter by',
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'List of pending reviews.',
    type: [ReviewResponseDto],
  })
  getPendingReviews(
    @Query('status') status?: string,
    @Query('submissionId') submissionId?: string,
    @Query('challengeId') challengeId?: string,
  ) {
    return [mockReviewResponse];
  }

  @Delete('/:id')
  @Roles(UserRole.Copilot, UserRole.Admin)
  @ApiOperation({
    summary: 'Delete a review',
    description: 'Roles: Copilot, Admin',
  })
  @ApiParam({
    name: 'id',
    description: 'The ID of the review',
    example: 'mock-review-id',
  })
  @ApiResponse({ status: 200, description: 'Review deleted successfully.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Review not found.' })
  deleteReview(@Param('id') id: string) {
    return { message: `Review ${id} deleted successfully.` };
  }

  @Delete('/:id/items/:itemId')
  @Roles(UserRole.Copilot, UserRole.Admin)
  @ApiOperation({
    summary: 'Delete a review item',
    description: 'Roles: Copilot, Admin',
  })
  @ApiParam({
    name: 'id',
    description: 'The ID of the review',
    example: 'mock-review-id',
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
  deleteReviewItem(@Param('id') id: string, @Param('itemId') itemId: string) {
    return {
      message: `Review item ${itemId} from review ${id} deleted successfully.`,
    };
  }
}
