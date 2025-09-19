import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  ReviewTypeQueryDto,
  ReviewTypeRequestDto,
  ReviewTypeResponseDto,
  ReviewTypeUpdateRequestDto,
} from 'src/dto/reviewType.dto';
import { PaginationDto } from 'src/dto/pagination.dto';
import { SortDto } from 'src/dto/sort.dto';
import { PrismaService } from 'src/shared/modules/global/prisma.service';
import { LoggerService } from 'src/shared/modules/global/logger.service';
import { PrismaErrorService } from 'src/shared/modules/global/prisma-error.service';

@Injectable()
export class ReviewTypeService {
  private readonly logger = LoggerService.forRoot('ReviewTypeService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaErrorService: PrismaErrorService,
  ) {}

  async createReviewType(
    body: ReviewTypeRequestDto,
  ): Promise<ReviewTypeResponseDto> {
    this.logger.log(
      `Creating review type with request body: ${JSON.stringify(body)}`,
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

  async updateReviewType(
    reviewTypeId: string,
    body: ReviewTypeUpdateRequestDto | ReviewTypeRequestDto,
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
      throw this.rethrowError(
        error,
        reviewTypeId,
        `updating review type ${reviewTypeId}`,
      );
    }
  }

  async listReviewTypes(
    queryDto: ReviewTypeQueryDto,
    paginationDto?: PaginationDto,
    sortDto?: SortDto,
  ): Promise<ReviewTypeResponseDto[]> {
    this.logger.log(
      `Getting review types with filters - ${JSON.stringify(queryDto)}`,
    );

    const { page = 1, perPage = 10 } = paginationDto || {};
    const skip = (page - 1) * perPage;
    let orderBy: Record<string, 'asc' | 'desc'> | undefined;

    if (sortDto?.orderBy && sortDto?.sortBy) {
      const sortOrder = sortDto.orderBy.toLowerCase();
      if (sortOrder === 'asc' || sortOrder === 'desc') {
        orderBy = {
          [sortDto.sortBy]: sortOrder,
        };
      }
    }

    try {
      const reviewTypeWhereClause: Record<string, unknown> = {};

      if (queryDto.name) {
        reviewTypeWhereClause.name = queryDto.name;
      }

      if (queryDto.isActive !== undefined) {
        reviewTypeWhereClause.isActive =
          queryDto.isActive.toLowerCase() === 'true';
      }

      const reviewTypes = await this.prisma.reviewType.findMany({
        where: {
          ...reviewTypeWhereClause,
        },
        skip,
        take: perPage,
        orderBy,
      });

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

  async getReviewType(reviewTypeId: string): Promise<ReviewTypeResponseDto> {
    this.logger.log(`Getting review type with ID: ${reviewTypeId}`);

    try {
      const data = await this.prisma.reviewType.findUniqueOrThrow({
        where: { id: reviewTypeId },
      });

      this.logger.log(`Review type found: ${reviewTypeId}`);
      return data as ReviewTypeResponseDto;
    } catch (error) {
      throw this.rethrowError(
        error,
        reviewTypeId,
        `fetching review type ${reviewTypeId}`,
      );
    }
  }

  async deleteReviewType(reviewTypeId: string): Promise<{ message: string }> {
    this.logger.log(`Deleting review type with ID: ${reviewTypeId}`);

    try {
      await this.prisma.reviewType.delete({
        where: { id: reviewTypeId },
      });

      this.logger.log(`Review type deleted successfully: ${reviewTypeId}`);
      return { message: `Review type ${reviewTypeId} deleted successfully.` };
    } catch (error) {
      throw this.rethrowError(
        error,
        reviewTypeId,
        `deleting review type ${reviewTypeId}`,
      );
    }
  }

  private rethrowError(error: any, reviewTypeId: string, message: string) {
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
