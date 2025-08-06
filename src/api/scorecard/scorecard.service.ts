import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ScorecardPaginatedResponseDto, ScorecardQueryDto, ScorecardResponseDto } from "src/dto/scorecard.dto";
import { PrismaService } from "src/shared/modules/global/prisma.service";

@Injectable()
export class ScoreCardService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Get list of score cards and send it in paginated way
   * @param query query params
   * @returns response dto
   */
  async getScoreCards(
    query: ScorecardQueryDto
  ): Promise<ScorecardPaginatedResponseDto> {
    const { page = 1, perPage = 10, challengeTrack, challengeType, name } = query;
    const skip = (page - 1) * perPage;
    const where: Prisma.scorecardWhereInput = {
      ...(challengeTrack?.length && {
        challengeTrack: {
          in: challengeTrack,
        },
      }),
      ...(challengeType?.length && {
        challengeType: {
          in: challengeType,
        },
      }),
      ...(name && { name: { contains: name, mode: 'insensitive' } }),
    };
    const data = await this.prisma.scorecard.findMany({
      where,
      skip,
      take: perPage,
      orderBy: {
        name: 'asc',
      },
    });

    const totalCount = await this.prisma.scorecard.count({
      where,
    });

    return {
      metadata: {
        total: totalCount,
        page,
        perPage,
        totalPages: Math.ceil(totalCount/perPage),
      },
      scoreCards: data as ScorecardResponseDto[],
    };
  }
}