import { Injectable } from "@nestjs/common";
import { ScorecardPaginatedResponseDto, ScorecardQueryDto, ScorecardResponseDto } from "src/dto/scorecard.dto";
import { PrismaService } from "src/shared/modules/global/prisma.service";

@Injectable()
export class ScoreCardService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Get list of score cards and send it in paginated way
   * @param authUser auth user
   * @param dto create data
   * @returns response dto
   */
  async getScoreCards(
    query: ScorecardQueryDto
  ): Promise<ScorecardPaginatedResponseDto> {
    const { page = 1, perPage = 10, challengeTrack, challengeType, name } = query;
    const skip = (page - 1) * perPage;
    const data = await this.prisma.scorecard.findMany({
      where: {
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
      },
      skip,
      take: perPage,
      orderBy: {
        name: 'asc',
      },
    });

    const totalCount = await this.prisma.scorecard.count({
      where: {
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
      },
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