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
  InternalServerErrorException,
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
  ReviewSummationQueryDto,
  ReviewSummationResponseDto,
  ReviewSummationRequestDto,
  ReviewSummationPutRequestDto,
  ReviewSummationUpdateRequestDto,
} from 'src/dto/reviewSummation.dto';
import { PrismaService } from '../../shared/modules/global/prisma.service';
import { LoggerService } from '../../shared/modules/global/logger.service';
import { PaginatedResponse, PaginationDto } from '../../dto/pagination.dto';
import { SortDto } from '../../dto/sort.dto';
import { PrismaErrorService } from '../../shared/modules/global/prisma-error.service';

@ApiTags('ReviewSummations')
@ApiBearerAuth()
@Controller('/api/reviewSummations')
export class ReviewSummationController {
  private readonly logger: LoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaErrorService: PrismaErrorService,
  ) {
    this.logger = LoggerService.forRoot('ReviewSummationController');
  }

  @Post()
  @Roles(UserRole.Admin, UserRole.Copilot)
  @Scopes(Scope.CreateReviewSummation)
  @ApiOperation({
    summary: 'Create a new review summation',
    description: 'Roles: Admin, Copilot | Scopes: create:review_summation',
  })
  @ApiBody({ description: 'Review type data', type: ReviewSummationRequestDto })
  @ApiResponse({
    status: 201,
    description: 'Review type created successfully.',
    type: ReviewSummationResponseDto,
  })
  async createReviewSummation(
    @Body() body: ReviewSummationRequestDto,
  ): Promise<ReviewSummationResponseDto> {
    this.logger.log(
      `Creating review summation with request boy: ${JSON.stringify(body)}`,
    );
    try {
      const data = await this.prisma.reviewSummation.create({
        data: body,
      });
      this.logger.log(`Review type created with ID: ${data.id}`);
      return data as ReviewSummationResponseDto;
    } catch (error) {
      const errorResponse = this.prismaErrorService.handleError(
        error,
        'creating review summation',
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
      });
    }
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
    @Param('reviewSummationId') reviewSummationId: string,
    @Body() body: ReviewSummationUpdateRequestDto,
  ): Promise<ReviewSummationResponseDto> {
    return this._updateReviewSummation(reviewSummationId, body);
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
    @Param('reviewSummationId') reviewSummationId: string,
    @Body() body: ReviewSummationPutRequestDto,
  ): Promise<ReviewSummationResponseDto> {
    return this._updateReviewSummation(reviewSummationId, body);
  }

  /**
   * The inner update method for entity
   */
  async _updateReviewSummation(
    reviewSummationId: string,
    body: ReviewSummationUpdateRequestDto,
  ): Promise<ReviewSummationResponseDto> {
    this.logger.log(`Updating review summation with ID: ${reviewSummationId}`);
    try {
      const data = await this.prisma.reviewSummation.update({
        where: { id: reviewSummationId },
        data: body,
      });
      this.logger.log(`Review type updated successfully: ${reviewSummationId}`);
      return data as ReviewSummationResponseDto;
    } catch (error) {
      throw this._rethrowError(
        error,
        reviewSummationId,
        `updating review summation ${reviewSummationId}`,
      );
    }
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

    const { page = 1, perPage = 10 } = paginationDto || {};
    const skip = (page - 1) * perPage;
    let orderBy;

    if (sortDto && sortDto.orderBy && sortDto.sortBy) {
      orderBy = {
        [sortDto.sortBy]: sortDto.orderBy.toLowerCase(),
      };
    }

    try {
      // Build the where clause for review summations based on available filter parameters
      const reviewSummationWhereClause: any = {};
      if (queryDto.submissionId) {
        reviewSummationWhereClause.submissionId = queryDto.submissionId;
      }
      if (queryDto.aggregateScore) {
        reviewSummationWhereClause.aggregateScore = parseFloat(
          queryDto.aggregateScore,
        );
      }
      if (queryDto.scorecardId) {
        reviewSummationWhereClause.scorecardId = queryDto.scorecardId;
      }
      if (queryDto.isPassing !== undefined) {
        reviewSummationWhereClause.isPassing =
          queryDto.isPassing.toLowerCase() === 'true';
      }
      if (queryDto.isFinal !== undefined) {
        reviewSummationWhereClause.isFinal =
          queryDto.isFinal.toLowerCase() === 'true';
      }

      // find entities by filters
      const reviewSummations = await this.prisma.reviewSummation.findMany({
        where: {
          ...reviewSummationWhereClause,
        },
        skip,
        take: perPage,
        orderBy,
      });

      // Count total entities matching the filter for pagination metadata
      const totalCount = await this.prisma.reviewSummation.count({
        where: {
          ...reviewSummationWhereClause,
        },
      });

      this.logger.log(
        `Found ${reviewSummations.length} review summations (page ${page} of ${Math.ceil(totalCount / perPage)})`,
      );

      return {
        data: reviewSummations as ReviewSummationResponseDto[],
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
        'fetching review summations',
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
      });
    }
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
    try {
      const data = await this.prisma.reviewSummation.findUniqueOrThrow({
        where: { id: reviewSummationId },
      });

      this.logger.log(`Review summation found: ${reviewSummationId}`);
      return data as ReviewSummationResponseDto;
    } catch (error) {
      throw this._rethrowError(
        error,
        reviewSummationId,
        `fetching review summation ${reviewSummationId}`,
      );
    }
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
    try {
      await this.prisma.reviewSummation.delete({
        where: { id: reviewSummationId },
      });
      this.logger.log(`Review type deleted successfully: ${reviewSummationId}`);
      return {
        message: `Review type ${reviewSummationId} deleted successfully.`,
      };
    } catch (error) {
      throw this._rethrowError(
        error,
        reviewSummationId,
        `deleting review summation ${reviewSummationId}`,
      );
    }
  }

  /**
   * Build exception by error code
   */
  _rethrowError(error: any, reviewSummationId: string, message: string) {
    const errorResponse = this.prismaErrorService.handleError(error, message);

    if (errorResponse.code === 'RECORD_NOT_FOUND') {
      return new NotFoundException({
        message: `Review type with ID ${reviewSummationId} was not found`,
        code: errorResponse.code,
      });
    }

    return new InternalServerErrorException({
      message: errorResponse.message,
      code: errorResponse.code,
    });
  }
}
