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
  Req,
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
  ReviewSummationQueryDto,
  ReviewSummationResponseDto,
  ReviewSummationRequestDto,
  ReviewSummationPutRequestDto,
  ReviewSummationUpdateRequestDto,
} from 'src/dto/reviewSummation.dto';
import { LoggerService } from '../../shared/modules/global/logger.service';
import { PaginatedResponse, PaginationDto } from '../../dto/pagination.dto';
import { SortDto } from '../../dto/sort.dto';
import { ReviewSummationService } from './review-summation.service';
import { JwtUser } from 'src/shared/modules/global/jwt.service';

@ApiTags('ReviewSummations')
@ApiBearerAuth()
@Controller('/reviewSummations')
export class ReviewSummationController {
  private readonly logger: LoggerService;

  constructor(private readonly service: ReviewSummationService) {
    this.logger = LoggerService.forRoot(ReviewSummationController.name);
  }

  @Post()
  @Roles(UserRole.Admin, UserRole.Copilot)
  @Scopes(Scope.CreateReviewSummation)
  @ApiOperation({
    summary: 'Create a new review summation',
    description: 'Roles: Admin, Copilot | Scopes: create:review_summation',
  })
  @ApiBody({
    description: 'Review summation data',
    type: ReviewSummationRequestDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Review summation created successfully.',
    type: ReviewSummationResponseDto,
  })
  async createReviewSummation(
    @Req() req: Request,
    @Body() body: ReviewSummationRequestDto,
  ): Promise<ReviewSummationResponseDto> {
    this.logger.log(
      `Creating review summation with request boy: ${JSON.stringify(body)}`,
    );
    const authUser: JwtUser = req['user'] as JwtUser;
    return this.service.createSummation(authUser, body);
  }

  @Patch('/:reviewSummationId')
  @Roles(UserRole.Admin)
  @Scopes(Scope.UpdateReviewSummation)
  @ApiOperation({
    summary: 'Update a review summation partially',
    description: 'Roles: Admin | Scopes: update:review_summation',
  })
  @ApiParam({
    name: 'reviewSummationId',
    description: 'The ID of the review summation',
  })
  @ApiBody({
    description: 'Review type data',
    type: ReviewSummationUpdateRequestDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Review type updated successfully.',
    type: ReviewSummationResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Review type not found.' })
  async patchReviewSummation(
    @Req() req: Request,
    @Param('reviewSummationId') reviewSummationId: string,
    @Body() body: ReviewSummationUpdateRequestDto,
  ): Promise<ReviewSummationResponseDto> {
    const authUser: JwtUser = req['user'] as JwtUser;
    return this.service.updateSummation(authUser, reviewSummationId, body);
  }

  @Put('/:reviewSummationId')
  @Roles(UserRole.Admin)
  @Scopes(Scope.UpdateReviewSummation)
  @ApiOperation({
    summary: 'Update a review summation',
    description: 'Roles: Admin | Scopes: update:review_summation',
  })
  @ApiParam({
    name: 'reviewSummationId',
    description: 'The ID of the review summation',
  })
  @ApiBody({
    description: 'Review type data',
    type: ReviewSummationPutRequestDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Review type updated successfully.',
    type: ReviewSummationResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Review type not found.' })
  async updateReviewSummation(
    @Req() req: Request,
    @Param('reviewSummationId') reviewSummationId: string,
    @Body() body: ReviewSummationPutRequestDto,
  ): Promise<ReviewSummationResponseDto> {
    const authUser: JwtUser = req['user'] as JwtUser;
    return this.service.updateSummation(authUser, reviewSummationId, body);
  }

  @Get()
  @Roles(UserRole.Copilot, UserRole.Admin)
  @Scopes(Scope.ReadReviewSummation)
  @ApiOperation({
    summary: 'Search for review summations',
    description: 'Roles: Copilot, Admin. | Scopes: read:review_summation',
  })
  @ApiResponse({
    status: 200,
    description: 'List of review summations.',
    type: [ReviewSummationResponseDto],
  })
  async listReviewSummations(
    @Query() queryDto: ReviewSummationQueryDto,
    @Query() paginationDto?: PaginationDto,
    @Query() sortDto?: SortDto,
  ): Promise<PaginatedResponse<ReviewSummationResponseDto>> {
    this.logger.log(
      `Getting review summations with filters - ${JSON.stringify(queryDto)}`,
    );
    return this.service.searchSummation(queryDto, paginationDto, sortDto);
  }

  @Get('/:reviewSummationId')
  @Roles(UserRole.Copilot, UserRole.Admin)
  @Scopes(Scope.ReadReviewSummation)
  @ApiOperation({
    summary: 'View a specific review summation',
    description: 'Roles: Copilot, Admin | Scopes: read:review_summation',
  })
  @ApiParam({
    name: 'reviewSummationId',
    description: 'The ID of the review summation',
  })
  @ApiResponse({
    status: 200,
    description: 'Review type retrieved successfully.',
    type: ReviewSummationResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Review type not found.' })
  async getReviewSummation(
    @Param('reviewSummationId') reviewSummationId: string,
  ): Promise<ReviewSummationResponseDto> {
    this.logger.log(`Getting review summation with ID: ${reviewSummationId}`);
    return this.service.getSummation(reviewSummationId);
  }

  @Delete('/:reviewSummationId')
  @Roles(UserRole.Admin)
  @Scopes(Scope.DeleteReviewSummation)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a review summation',
    description: 'Roles: Admin | Scopes: delete:review_summation',
  })
  @ApiParam({
    name: 'reviewSummationId',
    description: 'The ID of the review summation',
  })
  @ApiResponse({
    status: 200,
    description: 'Review type deleted successfully.',
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Review not found.' })
  async deleteReviewSummation(
    @Param('reviewSummationId') reviewSummationId: string,
  ) {
    this.logger.log(`Deleting review summation with ID: ${reviewSummationId}`);
    await this.service.deleteSummation(reviewSummationId);
    return {
      message: `Review type ${reviewSummationId} deleted successfully.`,
    };
  }
}
