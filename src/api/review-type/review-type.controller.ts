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
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
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
  ReviewTypeQueryDto,
  ReviewTypeResponseDto,
  ReviewTypeRequestDto,
  ReviewTypeUpdateRequestDto,
} from 'src/dto/reviewType.dto';
import { PaginationDto } from '../../dto/pagination.dto';
import { SortDto } from '../../dto/sort.dto';
import { ReviewTypeService } from './review-type.service';

@ApiTags('ReviewTypes')
@ApiBearerAuth()
@Controller('/reviewTypes')
export class ReviewTypeController {
  constructor(private readonly reviewTypeService: ReviewTypeService) {}

  @Post()
  @Roles(UserRole.Admin, UserRole.Copilot)
  @Scopes(Scope.CreateReviewType)
  @ApiOperation({
    summary: 'Create a new review type',
    description: 'Roles: Admin, Copilot | Scopes: create:review_type',
  })
  @ApiBody({ description: 'Review type data', type: ReviewTypeRequestDto })
  @ApiResponse({
    status: 201,
    description: 'Review type created successfully.',
    type: ReviewTypeResponseDto,
  })
  async createReviewType(
    @Body() body: ReviewTypeRequestDto,
  ): Promise<ReviewTypeResponseDto> {
    return this.reviewTypeService.createReviewType(body);
  }

  @Patch('/:reviewTypeId')
  @Roles(UserRole.Admin)
  @Scopes(Scope.UpdateReviewType)
  @ApiOperation({
    summary: 'Update a review type partially',
    description: 'Roles: Admin | Scopes: update:review_type',
  })
  @ApiParam({
    name: 'reviewTypeId',
    description: 'The ID of the review type',
  })
  @ApiBody({
    description: 'Review type data',
    type: ReviewTypeUpdateRequestDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Review type updated successfully.',
    type: ReviewTypeResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Review type not found.' })
  async patchReviewType(
    @Param('reviewTypeId') reviewTypeId: string,
    @Body() body: ReviewTypeUpdateRequestDto,
  ): Promise<ReviewTypeResponseDto> {
    return this.reviewTypeService.updateReviewType(reviewTypeId, body);
  }

  @Put('/:reviewTypeId')
  @Roles(UserRole.Admin)
  @Scopes(Scope.UpdateReviewType)
  @ApiOperation({
    summary: 'Update a review type',
    description: 'Roles: Admin | Scopes: update:review_type',
  })
  @ApiParam({
    name: 'reviewTypeId',
    description: 'The ID of the review type',
  })
  @ApiBody({ description: 'Review type data', type: ReviewTypeRequestDto })
  @ApiResponse({
    status: 200,
    description: 'Review type updated successfully.',
    type: ReviewTypeResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Review type not found.' })
  async updateReviewType(
    @Param('reviewTypeId') reviewTypeId: string,
    @Body() body: ReviewTypeRequestDto,
  ): Promise<ReviewTypeResponseDto> {
    return this.reviewTypeService.updateReviewType(reviewTypeId, body);
  }

  @Get()
  @Roles(UserRole.Copilot, UserRole.Admin, UserRole.User, UserRole.Reviewer)
  @Scopes(Scope.ReadReviewType)
  @ApiOperation({
    summary: 'Search for review types',
    description:
      'Roles: Copilot, Admin, User, Reviewer. | Scopes: read:review_type',
  })
  @ApiResponse({
    status: 200,
    description: 'List of review types.',
    type: [ReviewTypeResponseDto],
  })
  async listReviewTypes(
    @Query() queryDto: ReviewTypeQueryDto,
    @Query() paginationDto?: PaginationDto,
    @Query() sortDto?: SortDto,
  ): Promise<ReviewTypeResponseDto[]> {
    return this.reviewTypeService.listReviewTypes(
      queryDto,
      paginationDto,
      sortDto,
    );
  }

  @Get('/:reviewTypeId')
  @Roles(UserRole.Copilot, UserRole.Admin, UserRole.User)
  @Scopes(Scope.ReadReviewType)
  @ApiOperation({
    summary: 'View a specific review type',
    description: 'Roles: Copilot, Admin, User | Scopes: read:review_type',
  })
  @ApiParam({
    name: 'reviewTypeId',
    description: 'The ID of the review type',
  })
  @ApiResponse({
    status: 200,
    description: 'Review type retrieved successfully.',
    type: ReviewTypeResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Review type not found.' })
  async getReviewType(
    @Param('reviewTypeId') reviewTypeId: string,
  ): Promise<ReviewTypeResponseDto> {
    return this.reviewTypeService.getReviewType(reviewTypeId);
  }

  @Delete('/:reviewTypeId')
  @Roles(UserRole.Admin)
  @Scopes(Scope.DeleteReviewType)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a review type',
    description: 'Roles: Admin | Scopes: delete:review_type',
  })
  @ApiParam({
    name: 'reviewTypeId',
    description: 'The ID of the review type',
  })
  @ApiResponse({
    status: 204,
    description: 'Review type deleted successfully.',
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Review not found.' })
  async deleteReviewType(@Param('reviewTypeId') reviewTypeId: string) {
    return this.reviewTypeService.deleteReviewType(reviewTypeId);
  }
}
