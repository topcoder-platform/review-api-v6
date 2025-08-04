import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PaginationDto } from "src/dto/pagination.dto";
import { ReviewSummationQueryDto, ReviewSummationRequestDto, ReviewSummationResponseDto, ReviewSummationUpdateRequestDto } from "src/dto/reviewSummation.dto";
import { SortDto } from "src/dto/sort.dto";
import { JwtUser } from "src/shared/modules/global/jwt.service";
import { PrismaService } from "src/shared/modules/global/prisma.service";



@Injectable()
export class ReviewSummationService {
  private readonly logger = new Logger(ReviewSummationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createSummation(authUser: JwtUser, body: ReviewSummationRequestDto) {
    const data = await this.prisma.reviewSummation.create({
      data: {
        ...body,
        createdBy: String(authUser.userId) || '',
        createdAt: new Date(),
        updatedBy: String(authUser.userId) || '',
      }
    });
    this.logger.log(`Review summation created with ID: ${data.id}`);
    return data as ReviewSummationResponseDto;
  }

  async searchSummation(
    queryDto: ReviewSummationQueryDto,
    paginationDto?: PaginationDto,
    sortDto?: SortDto,
  ) {
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
  }

  async getSummation(id: string) {
    return this.checkSummation(id);
  }

  async updateSummation(
    authUser: JwtUser,
    id: string,
    body: ReviewSummationUpdateRequestDto
  ) {
    await this.checkSummation(id);
    const data = await this.prisma.reviewSummation.update({
      where: { id },
      data: {
        ...body,
        updatedBy: String(authUser.userId) || '',
        updatedAt: new Date()
      }
    });
    this.logger.log(`Review type updated successfully: ${id}`);
    return data as ReviewSummationResponseDto;
  }

  async deleteSummation(id: string) {
    await this.checkSummation(id);
    await this.prisma.reviewSummation.delete({
      where: { id }
    });
  }

  private async checkSummation(id: string) {
    const data = await this.prisma.reviewSummation.findUnique({
      where: { id }
    });
    if (!data || !data.id) {
      throw new NotFoundException(`Review summation not found with id ${id}`);
    }
    return data;
  }
}
