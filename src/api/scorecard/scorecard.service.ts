import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  scorecardGroup,
  scorecardQuestion,
  scorecardSection,
} from '@prisma/client';
import {
  mapScorecardRequestForCreate,
  ScorecardGroupBaseDto,
  ScorecardPaginatedResponseDto,
  ScorecardQueryDto,
  ScorecardQuestionBaseDto,
  ScorecardRequestDto,
  ScorecardResponseDto,
  ScorecardSectionBaseDto,
  ScorecardWithGroupResponseDto,
} from 'src/dto/scorecard.dto';
import { JwtUser } from 'src/shared/modules/global/jwt.service';
import { PrismaService } from 'src/shared/modules/global/prisma.service';
import { omit } from 'lodash';
import { LoggerService } from 'src/shared/modules/global/logger.service';

type ChildEntity = scorecardGroup | scorecardSection | scorecardQuestion;

interface SyncChildrenParams<T extends ChildEntity> {
  parentId: string;
  parentField: keyof T; // "scorecardId" | "groupId" | "sectionId"
  model: {
    create: (args: { data: any }) => Promise<T>;
    update: (args: { where: { id: string }; data: any }) => Promise<T>;
    deleteMany: (args: { where: { id: { in: string[] } } }) => Promise<any>;
    findMany: (args: { where: any }) => Promise<T[]>;
  };
  incoming: (T & {
    sections?: scorecardSection[];
    questions?: scorecardQuestion[];
  })[];
  existing: T[];
  cascade?: (child: any) => Promise<void>;
  userId: string;
}

@Injectable()
export class ScoreCardService {
  private readonly logger: LoggerService;

  constructor(private readonly prisma: PrismaService) {
    this.logger = LoggerService.forRoot('ScorecardService');
  }

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
    scorecardId: string,
    scorecardInput: ScorecardRequestDto,
    user: JwtUser,
  ): Promise<ScorecardWithGroupResponseDto> {
    const original = await this.prisma.scorecard.findUnique({
      where: { id: scorecardId },
    });

    if (!original) {
      throw new NotFoundException({ message: `Scorecard not found.` });
    }

    const userId = user.isMachine ? 'System' : (user.userId as string);

    this.logger.log(
      `[updateScorecard] Updating scorecard with id: ${scorecardId}`,
    );

    return this.prisma.$transaction(async (tx) => {
      // Update scorecard basic info
      const updatedScorecard = await tx.scorecard.update({
        where: { id: scorecardId },
        data: {
          ...omit(scorecardInput, 'scorecardGroups'),
        },
      });
      this.logger.log(
        `[updateScorecard] Updated scorecard basic info: ${JSON.stringify(updatedScorecard)}`,
      );

      // Sync groups
      await this.syncChildren<scorecardGroup>({
        parentId: scorecardId,
        parentField: 'scorecardId',
        model: tx.scorecardGroup,
        incoming: scorecardInput.scorecardGroups as any,
        existing: await tx.scorecardGroup.findMany({
          where: { scorecardId: scorecardId },
        }),
        userId,
        cascade: async (groupInput) => {
          // Sync sections
          await this.syncChildren<scorecardSection>({
            parentId: groupInput.id,
            parentField: 'scorecardGroupId',
            model: tx.scorecardSection,
            incoming: groupInput.sections ?? [],
            existing: await tx.scorecardSection.findMany({
              where: { scorecardGroupId: groupInput.id },
            }),
            userId,
            cascade: async (sectionInput) => {
              // Sync questions
              await this.syncChildren<scorecardQuestion>({
                parentId: sectionInput.id,
                parentField: 'scorecardSectionId',
                model: tx.scorecardQuestion,
                incoming: sectionInput.questions ?? [],
                existing: await tx.scorecardQuestion.findMany({
                  where: { scorecardSectionId: sectionInput.id },
                }),
                userId,
              });
            },
          });
        },
      });

      this.logger.log(
        `[updateScorecard] Finished syncing groups, sections, and questions for scorecard ${scorecardId}`,
      );

      return this.prisma.scorecard.findUnique({
        where: { id: scorecardId },
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
      }) as Promise<ScorecardWithGroupResponseDto>;
    });
  }

  async syncChildren<T extends ChildEntity>({
    parentId,
    parentField,
    model,
    incoming,
    existing,
    cascade,
    userId,
  }: SyncChildrenParams<T>): Promise<void> {
    const incomingIds = incoming.filter((c) => c.id).map((c) => c.id);
    const existingIds = existing.map((e) => e.id);

    // Delete removed children
    const toDelete = existingIds.filter((id) => !incomingIds.includes(id));
    if (toDelete.length > 0) {
      this.logger.log(
        `[syncChildren] Deleting children with ids: ${toDelete.join(',')}`,
      );
      await model.deleteMany({ where: { id: { in: toDelete } } });
    }

    // Upsert incoming
    for (const child of incoming) {
      if (child.id) {
        this.logger.log(`[syncChildren] Updating child with id: ${child.id}`);
        await model.update({
          where: { id: child.id },
          data: {
            ...omit(child, ['sections', 'questions']),
            updatedBy: userId,
          },
        });
      } else {
        this.logger.log(
          `[syncChildren] Creating new child for parentId: ${parentId}`,
        );
        const created = await model.create({
          data: {
            ...omit(child, ['sections', 'questions']),
            [parentField]: parentId,
            createdBy: userId,
            updatedBy: userId,
          },
        });
        child.id = created.id; // assign id back to input
        this.logger.log(
          `[syncChildren] Created child with new id: ${created.id}`,
        );
      }

      // Cascade to nested children
      if (cascade) {
        await cascade(child);
      }
    }
    this.logger.log(
      `[syncChildren] Finished syncing children for parentId: ${parentId}`,
    );
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
      scorecardTypesArray,
      statusArray,
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
      ...(scorecardTypesArray?.length && {
        type: {
          in: scorecardTypesArray,
        },
      }),
      ...(statusArray?.length && {
        status: {
          in: statusArray,
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
