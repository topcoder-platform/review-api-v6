import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  mapScorecardRequestToDto,
  ScorecardGroupBaseDto,
  ScorecardPaginatedResponseDto,
  ScorecardQueryDto,
  ScorecardQuestionBaseDto,
  ScorecardRequestDto,
  ScorecardResponseDto,
  ScorecardSectionBaseDto,
  ScorecardWithGroupResponseDto,
} from 'src/dto/scorecard.dto';
import { PrismaService } from 'src/shared/modules/global/prisma.service';

@Injectable()
export class ScoreCardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Adds score card
   * @param body body from request
   * @returns ScorecardWithGroupResponseDto
   */
  async addScorecard(
    body: ScorecardRequestDto,
  ): Promise<ScorecardWithGroupResponseDto> {
    const data = await this.prisma.scorecard.create({
      data: mapScorecardRequestToDto(body),
      include: {
        scorecardGroups: {
          include: {
            sections: {
              include: {
                questions: true,
              },
            },
          },
        },
      },
    });

    return data as ScorecardWithGroupResponseDto;
  }

  /**
   * Edit score card
   * @param body body from request
   * @returns ScorecardWithGroupResponseDto
   */
  async editScorecard(
    id: string,
    body: ScorecardWithGroupResponseDto,
  ): Promise<ScorecardWithGroupResponseDto> {
    const data = await this.prisma.scorecard
      .update({
        where: { id },
        data: mapScorecardRequestToDto(body),
        include: {
          scorecardGroups: {
            include: {
              sections: {
                include: {
                  questions: true,
                },
              },
            },
          },
        },
      })
      .catch((error) => {
        if (error.code !== 'P2025') {
          throw new NotFoundException({ message: `Scorecard not found.` });
        }
        throw new InternalServerErrorException({
          message: `Error: ${error.code}`,
        });
      });

    return data as ScorecardWithGroupResponseDto;
  }

  /**
   * Delete score card
   * @param id score card id
   * @returns
   */
  async deleteScorecard(id: string): Promise<{ message: string }> {
    await this.prisma.scorecard
      .delete({
        where: { id },
      })
      .catch((error) => {
        if (error.code !== 'P2025') {
          throw new NotFoundException({ message: `Scorecard not found.` });
        }
        throw new InternalServerErrorException({
          message: `Error: ${error.code}`,
        });
      });
    return { message: `Scorecard ${id} deleted successfully.` };
  }

  /**
   * View score card
   * @param id score card id
   * @returns
   */
  async viewScorecard(id: string): Promise<ScorecardWithGroupResponseDto> {
    const data = await this.prisma.scorecard
      .findUniqueOrThrow({
        where: { id },
        include: {
          scorecardGroups: {
            include: {
              sections: {
                include: {
                  questions: true,
                },
              },
            },
          },
        },
      })
      .catch((error) => {
        if (error.code !== 'P2025') {
          throw new NotFoundException({ message: `Scorecard not found.` });
        }
        throw new InternalServerErrorException({
          message: `Error: ${error.code}`,
        });
      });
    return data as ScorecardWithGroupResponseDto;
  }

  /**
   * Get list of score cards and send it in paginated way
   * @param query query params
   * @returns response dto
   */
  async getScoreCards(
    query: ScorecardQueryDto,
  ): Promise<ScorecardPaginatedResponseDto> {
    const {
      page = 1,
      perPage = 10,
      challengeTrack,
      challengeType,
      name,
    } = query;
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
        totalPages: Math.ceil(totalCount / perPage),
      },
      scoreCards: data as ScorecardResponseDto[],
    };
  }

  async cloneScorecard(
    id: string
  ): Promise<ScorecardResponseDto> {
    const original = await this.prisma.scorecard
      .findUnique({
        where: { id },
        include: {
          scorecardGroups: {
            include: {
              sections: {
                include: {
                  questions: true,
                },
              },
            },
          },
        },
      });

    if (!original) {
      throw new NotFoundException({ message: `Scorecard not found.` });
    }

    // Remove id fields from nested objects for cloning
    const cloneGroups = original.scorecardGroups.map((group: ScorecardGroupBaseDto) => ({
      ...group,
      id: undefined,
      createdAt: undefined,
      updatedAt: undefined,
      scorecardId: undefined,
      sections: group.sections.map((section: ScorecardSectionBaseDto) => ({
        ...section,
        id: undefined,
        createdAt: undefined,
        updatedAt: undefined,
        scorecardGroupId: undefined,
        questions: section.questions.map((question: ScorecardQuestionBaseDto) => ({
          ...question,
          id: undefined,
          createdAt: undefined,
          updatedAt: undefined,
          sectionId: undefined,
          scorecardSectionId: undefined,
        })),
      })),
    }));

    const clonedScorecard = await this.prisma.scorecard.create({
      data: {
        ...original,
        id: undefined,
        name: `${original.name} (Clone)`,
        createdAt: undefined,
        updatedAt: undefined,
        scorecardGroups: {
          create: cloneGroups,
        },
      },
      include: {
        scorecardGroups: {
          include: {
            sections: {
              include: {
                questions: true,
              },
            },
          },
        },
      },
    });

    return clonedScorecard as ScorecardResponseDto;
  }
}
