import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  mapScorecardRequestForCreate,
  mapScorecardRequestToDto,
  ScorecardGroupBaseDto,
  ScorecardPaginatedResponseDto,
  ScorecardQuestionBaseDto,
  ScorecardRequestDto,
  ScorecardResponseDto,
  ScorecardSectionBaseDto,
  ScorecardWithGroupResponseDto,
  SearchScorecardQuery,
} from 'src/dto/scorecard.dto';
import { JwtUser } from 'src/shared/modules/global/jwt.service';
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
    user: JwtUser,
  ): Promise<ScorecardWithGroupResponseDto> {
    const data = await this.prisma.scorecard.create({
      data: {
        ...(mapScorecardRequestForCreate({
          ...body,
          createdBy: user.isMachine ? 'System' : (user.userId as string),
          updatedBy: user.isMachine ? 'System' : (user.userId as string),
        }) as any),
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

    return data as unknown as ScorecardWithGroupResponseDto;
  }

  /**
   * Edit score card
   * @param body body from request
   * @returns ScorecardWithGroupResponseDto
   */
  async editScorecard(
    id: string,
    body: ScorecardRequestDto,
    user: JwtUser,
  ): Promise<ScorecardWithGroupResponseDto> {
    const original = await this.prisma.scorecard.findUnique({
      where: { id },
    });

    if (!original) {
      throw new NotFoundException({ message: `Scorecard not found.` });
    }

    const data = await this.prisma.scorecard
      .update({
        where: { id },
        data: mapScorecardRequestToDto({
          ...body,
          createdBy: user.isMachine ? 'System' : (user.userId as string),
          updatedBy: user.isMachine ? 'System' : (user.userId as string),
        }) as any,
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

    return data as unknown as ScorecardWithGroupResponseDto;
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
          message: `Invalid scorecard id - ${id}`,
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
    query: SearchScorecardQuery,
  ): Promise<ScorecardPaginatedResponseDto> {
    const {
      page = 1,
      perPage = 10,
      challengeTrack,
      challengeType,
      scorecardType,
      status,
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
      ...(scorecardType?.length && {
        type: {
          in: scorecardType,
        },
      }),
      ...(status?.length && {
        status: {
          in: status,
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
    id: string,
    user: { userId?: string; isMachine: boolean },
  ): Promise<ScorecardResponseDto> {
    const original = await this.prisma.scorecard.findUnique({
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

    const auditFields = {
      createdBy: user.isMachine ? 'System' : (user.userId as string),
      updatedBy: user.isMachine ? 'System' : (user.userId as string),
      createdAt: undefined,
      updatedAt: undefined,
    };

    // Remove id fields from nested objects for cloning
    const cloneGroups = original.scorecardGroups.map(
      (group: ScorecardGroupBaseDto) => ({
        ...group,
        id: undefined,
        ...auditFields,
        scorecardId: undefined,
        sections: {
          create: group.sections.map((section: ScorecardSectionBaseDto) => ({
            ...section,
            id: undefined,
            ...auditFields,
            scorecardGroupId: undefined,
            questions: {
              create: section.questions.map(
                (question: ScorecardQuestionBaseDto) => ({
                  ...question,
                  id: undefined,
                  ...auditFields,
                  sectionId: undefined,
                  scorecardSectionId: undefined,
                }),
              ),
            },
          })),
        },
      }),
    ) as any;

    const clonedScorecard = await this.prisma.scorecard.create({
      data: {
        ...original,
        id: undefined,
        name: `${original.name} (Clone)`,
        ...auditFields,
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
