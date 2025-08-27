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
  ReviewTypeQueryDto,
  ReviewTypeResponseDto,
  ReviewTypeRequestDto,
  ReviewTypeUpdateRequestDto,
} from 'src/dto/reviewType.dto';
import { PrismaService } from '../../shared/modules/global/prisma.service';
import { LoggerService } from '../../shared/modules/global/logger.service';
import { PaginatedResponse, PaginationDto } from '../../dto/pagination.dto';
import { SortDto } from '../../dto/sort.dto';
import { PrismaErrorService } from '../../shared/modules/global/prisma-error.service';

@ApiTags('ReviewTypes')
@ApiBearerAuth()
@Controller('/api/reviewTypes')
export class ReviewTypeController {
  private readonly logger: LoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaErrorService: PrismaErrorService,
  ) {
    this.logger = LoggerService.forRoot('ReviewTypeController');
  }

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
    this.logger.log(
      `Creating review type with request boy: ${JSON.stringify(body)}`,
    );
    try {
      const data = await this.prisma.reviewType.create({
        data: body,
      });
      this.logger.log(`Review type created with ID: ${data.id}`);
      return data as ReviewTypeResponseDto;
    } catch (error) {
      const errorResponse = this.prismaErrorService.handleError(
        error,
        'creating review type',
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
      });
    }
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
    return this._updateReviewType(reviewTypeId, body);
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
    return this._updateReviewType(reviewTypeId, body);
  }

  /**
   * The inner update method for entity
   */
  async _updateReviewType(
    reviewTypeId: string,
    body: ReviewTypeUpdateRequestDto,
  ): Promise<ReviewTypeResponseDto> {
    this.logger.log(`Updating review type with ID: ${reviewTypeId}`);
    try {
      const data = await this.prisma.reviewType.update({
        where: { id: reviewTypeId },
        data: body,
      });
      this.logger.log(`Review type updated successfully: ${reviewTypeId}`);
      return data as ReviewTypeResponseDto;
    } catch (error) {
      throw this._rethrowError(
        error,
        reviewTypeId,
        `updating review type ${reviewTypeId}`,
      );
    }
  }

  @Get()
  @Roles(
    UserRole.Copilot,
    UserRole.Admin,
    UserRole.Submitter,
    UserRole.Reviewer,
  )
  @Scopes(Scope.ReadReviewType)
  @ApiOperation({
    summary: 'Search for review types',
    description:
      'Roles: Copilot, Admin, Submitter, Reviewer. | Scopes: read:review_type',
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
    this.logger.log(
      `Getting review types with filters - ${JSON.stringify(queryDto)}`,
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
      // Build the where clause for review types based on available filter parameters
      const reviewTypeWhereClause: any = {};
      if (queryDto.name) {
        reviewTypeWhereClause.name = queryDto.name;
      }
      if (queryDto.isActive !== undefined) {
        reviewTypeWhereClause.isActive =
          queryDto.isActive.toLowerCase() === 'true';
      }

      // find entities by filters
      const reviewTypes = await this.prisma.reviewType.findMany({
        where: {
          ...reviewTypeWhereClause,
        },
        skip,
        take: perPage,
        orderBy,
      });

      // Count total entities matching the filter for pagination metadata
      const totalCount = await this.prisma.reviewType.count({
        where: {
          ...reviewTypeWhereClause,
        },
      });

      this.logger.log(
        `Found ${reviewTypes.length} review types (page ${page} of ${Math.ceil(totalCount / perPage)})`,
      );

      return reviewTypes as ReviewTypeResponseDto[];
    } catch (error) {
      const errorResponse = this.prismaErrorService.handleError(
        error,
        'fetching review types',
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
      });
    }
  }

  @Get('/:reviewTypeId')
  @Roles(UserRole.Copilot, UserRole.Admin)
  @Scopes(Scope.ReadReviewType)
  @ApiOperation({
    summary: 'View a specific review type',
    description: 'Roles: Copilot, Admin | Scopes: read:review_type',
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
    this.logger.log(`Getting review type with ID: ${reviewTypeId}`);
    try {
      const data = await this.prisma.reviewType.findUniqueOrThrow({
        where: { id: reviewTypeId },
      });

      this.logger.log(`Review type found: ${reviewTypeId}`);
      return data as ReviewTypeResponseDto;
    } catch (error) {
      throw this._rethrowError(
        error,
        reviewTypeId,
        `fetching review type ${reviewTypeId}`,
      );
    }
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
    this.logger.log(`Deleting review type with ID: ${reviewTypeId}`);
    try {
      await this.prisma.reviewType.delete({
        where: { id: reviewTypeId },
      });
      this.logger.log(`Review type deleted successfully: ${reviewTypeId}`);
      return { message: `Review type ${reviewTypeId} deleted successfully.` };
    } catch (error) {
      throw this._rethrowError(
        error,
        reviewTypeId,
        `deleting review type ${reviewTypeId}`,
      );
    }
  }

  /**
   * Build exception by error code
   */
  _rethrowError(error: any, reviewTypeId: string, message: string) {
    const errorResponse = this.prismaErrorService.handleError(error, message);

    if (errorResponse.code === 'RECORD_NOT_FOUND') {
      return new NotFoundException({
        message: `Review type with ID ${reviewTypeId} was not found`,
        code: errorResponse.code,
      });
    }

    return new InternalServerErrorException({
      message: errorResponse.message,
      code: errorResponse.code,
    });
  }
}
