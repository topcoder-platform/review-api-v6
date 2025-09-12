import {
  Injectable,
  Logger,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PaginationDto } from 'src/dto/pagination.dto';
import {
  ReviewSummationQueryDto,
  ReviewSummationRequestDto,
  ReviewSummationResponseDto,
  ReviewSummationUpdateRequestDto,
} from 'src/dto/reviewSummation.dto';
import { SortDto } from 'src/dto/sort.dto';
import { JwtUser } from 'src/shared/modules/global/jwt.service';
import { PrismaService } from 'src/shared/modules/global/prisma.service';
import { PrismaErrorService } from 'src/shared/modules/global/prisma-error.service';

@Injectable()
export class ReviewSummationService {
  private readonly logger = new Logger(ReviewSummationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaErrorService: PrismaErrorService,
  ) {}

  async createSummation(authUser: JwtUser, body: ReviewSummationRequestDto) {
    try {
      const data = await this.prisma.reviewSummation.create({
        data: {
          ...body,
        },
      });
      this.logger.log(`Review summation created with ID: ${data.id}`);
      return data as ReviewSummationResponseDto;
    } catch (error) {
      const errorResponse = this.prismaErrorService.handleError(
        error,
        `creating review summation for submission ${body.submissionId}`,
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  async searchSummation(
    queryDto: ReviewSummationQueryDto,
    paginationDto?: PaginationDto,
    sortDto?: SortDto,
  ) {
    try {
      const { page = 1, perPage = 10 } = paginationDto || {};
      const skip = (page - 1) * perPage;
      let orderBy;

      if (sortDto && sortDto.orderBy && sortDto.sortBy) {
        orderBy = {
          [sortDto.sortBy]: sortDto.orderBy.toLowerCase(),
        };
      }

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
        `searching review summations with filters - submissionId: ${queryDto.submissionId}, scorecardId: ${queryDto.scorecardId}`,
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  async getSummation(id: string) {
    try {
      return this.checkSummation(id);
    } catch (error) {
      // Re-throw NotFoundException from checkSummation as-is
      if (error instanceof NotFoundException) {
        throw error;
      }

      const errorResponse = this.prismaErrorService.handleError(
        error,
        `fetching review summation ${id}`,
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  async updateSummation(
    authUser: JwtUser,
    id: string,
    body: ReviewSummationUpdateRequestDto,
  ) {
    try {
      await this.checkSummation(id);
      const data = await this.prisma.reviewSummation.update({
        where: { id },
        data: {
          ...body,
        },
      });
      this.logger.log(`Review type updated successfully: ${id}`);
      return data as ReviewSummationResponseDto;
    } catch (error) {
      // Re-throw NotFoundException from checkSummation as-is
      if (error instanceof NotFoundException) {
        throw error;
      }

      const errorResponse = this.prismaErrorService.handleError(
        error,
        `updating review summation ${id}`,
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  async deleteSummation(id: string) {
    try {
      await this.checkSummation(id);
      await this.prisma.reviewSummation.delete({
        where: { id },
      });
    } catch (error) {
      // Re-throw NotFoundException from checkSummation as-is
      if (error instanceof NotFoundException) {
        throw error;
      }

      const errorResponse = this.prismaErrorService.handleError(
        error,
        `deleting review summation ${id}`,
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  private async checkSummation(id: string) {
    try {
      const data = await this.prisma.reviewSummation.findUnique({
        where: { id },
      });
      if (!data || !data.id) {
        throw new NotFoundException(
          `Review summation with ID ${id} not found. Please verify the summation ID is correct.`,
        );
      }
      return data;
    } catch (error) {
      // Re-throw NotFoundException as-is
      if (error instanceof NotFoundException) {
        throw error;
      }

      const errorResponse = this.prismaErrorService.handleError(
        error,
        `checking existence of review summation ${id}`,
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }
}
