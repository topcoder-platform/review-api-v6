import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/modules/global/prisma.service';
import { LoggerService } from 'src/shared/modules/global/logger.service';
import { ChallengeApiService } from 'src/shared/modules/global/challenge.service';
import { ChallengeStatus } from 'src/shared/enums/challengeStatus.enum';
import {
  CreateAiReviewConfigDto,
  UpdateAiReviewConfigDto,
  ListAiReviewConfigQueryDto,
} from '../../dto/aiReviewConfig.dto';
import { AiReviewMode, Prisma } from '@prisma/client';

const CONFIG_INCLUDE = {
  workflows: {
    include: {
      workflow: {
        include: {
          llm: {
            include: {
              provider: true,
            },
          },
          scorecard: {
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
          },
        },
      },
    },
  },
  decisions: true,
} as const;

@Injectable()
export class AiReviewConfigService {
  private readonly logger: LoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly challengeApiService: ChallengeApiService,
  ) {
    this.logger = LoggerService.forRoot('AiReviewConfigService');
  }

  private async validateChallengeExists(challengeId: string): Promise<void> {
    try {
      await this.challengeApiService.getChallengeDetail(challengeId);
    } catch {
      throw new NotFoundException(
        `Challenge with id ${challengeId} not found.`,
      );
    }
  }

  private async validateNoSubmissionsExistForChallenge(
    challengeId: string,
  ): Promise<void> {
    const count = await this.prisma.submission.count({
      where: { challengeId },
    });
    if (count > 0) {
      throw new ConflictException(
        `Cannot create AI review config: challenge ${challengeId} already has submissions.`,
      );
    }
  }

  private async validateWorkflowIdsExist(workflowIds: string[]): Promise<void> {
    const found = await this.prisma.aiWorkflow.findMany({
      where: { id: { in: workflowIds } },
      select: { id: true },
    });
    const foundIds = new Set(found.map((w) => w.id));
    const missing = workflowIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Workflow(s) not found: ${missing.join(', ')}`,
      );
    }
  }

  private validateWeightsSumTo100(
    workflows: { weightPercent: number }[],
  ): void {
    const sum = workflows.reduce((acc, w) => acc + w.weightPercent, 0);
    if (sum !== 100) {
      throw new BadRequestException(
        `Workflow weights must sum to 100 (got ${sum}).`,
      );
    }
  }

  private async validateChallengeNotCompleted(
    challengeId: string,
  ): Promise<void> {
    const challenge =
      await this.challengeApiService.getChallengeDetail(challengeId);
    if (challenge.status === ChallengeStatus.COMPLETED) {
      throw new ForbiddenException(
        `Cannot update or delete AI review config: challenge ${challengeId} is completed.`,
      );
    }
  }

  private async validateNoDecisionsForConfig(configId: string): Promise<void> {
    const count = await this.prisma.aiReviewDecision.count({
      where: { configId },
    });
    if (count > 0) {
      throw new ConflictException(
        `Cannot update or delete AI review config: config has ${count} decision(s).`,
      );
    }
  }

  async create(dto: CreateAiReviewConfigDto) {
    await this.validateChallengeExists(dto.challengeId);
    await this.validateNoSubmissionsExistForChallenge(dto.challengeId);

    let payload: {
      challengeId: string;
      minPassingThreshold: number;
      mode: AiReviewMode;
      autoFinalize: boolean;
      formula?: Prisma.InputJsonValue;
      templateId?: string;
      workflows: CreateAiReviewConfigDto['workflows'];
    } = {
      challengeId: dto.challengeId,
      minPassingThreshold: dto.minPassingThreshold,
      mode: dto.mode as AiReviewMode,
      autoFinalize: dto.autoFinalize,
      formula:
        dto.formula != null
          ? (dto.formula as Prisma.InputJsonValue)
          : undefined,
      templateId: dto.templateId?.trim() || undefined,
      workflows: dto.workflows,
    };

    if (dto.templateId?.trim()) {
      const template = await this.prisma.aiReviewTemplateConfig.findUnique({
        where: { id: dto.templateId.trim() },
        include: {
          workflows: true,
        },
      });
      if (!template) {
        throw new NotFoundException(
          `Template with id ${dto.templateId} not found.`,
        );
      }
      const templateWorkflowIds = template.workflows.map((w) => w.workflowId);
      await this.validateWorkflowIdsExist(templateWorkflowIds);
      payload = {
        challengeId: dto.challengeId,
        minPassingThreshold:
          dto.minPassingThreshold ?? Number(template.minPassingThreshold),
        mode: (dto.mode ?? template.mode) as AiReviewMode,
        autoFinalize: dto.autoFinalize ?? template.autoFinalize,
        formula:
          dto.formula != null
            ? (dto.formula as Prisma.InputJsonValue)
            : (template.formula as Prisma.InputJsonValue | undefined),
        templateId: template.id,
        workflows: dto.workflows.length
          ? dto.workflows
          : template.workflows.map((w) => ({
              workflowId: w.workflowId,
              weightPercent: Number(w.weightPercent),
              isGating: w.isGating,
            })),
      };
    }

    if (!payload.workflows?.length) {
      throw new BadRequestException('At least one workflow is required.');
    }
    await this.validateWorkflowIdsExist(
      payload.workflows.map((w) => w.workflowId),
    );
    this.validateWeightsSumTo100(payload.workflows);

    const { workflows, ...configData } = payload;
    let config;
    try {
      config = await this.prisma.aiReviewConfig.create({
        data: {
          challengeId: configData.challengeId,
          minPassingThreshold: configData.minPassingThreshold,
          mode: configData.mode,
          autoFinalize: configData.autoFinalize,
          formula: configData.formula,
          templateId: configData.templateId,
        },
      });
    } catch (e: unknown) {
      if (
        e &&
        typeof e === 'object' &&
        'code' in e &&
        (e as { code: string }).code === 'P2002'
      ) {
        throw new ConflictException(
          `An AI review config already exists for challenge ${configData.challengeId}. Use update or a different challenge.`,
        );
      }
      throw e;
    }

    await this.prisma.aiReviewConfigWorkflow.createMany({
      data: workflows.map((w) => ({
        configId: config.id,
        workflowId: w.workflowId,
        weightPercent: w.weightPercent,
        isGating: w.isGating,
      })),
    });

    return this.getById(config.id);
  }

  async getByChallengeId(challengeId: string) {
    const config = await this.prisma.aiReviewConfig.findFirst({
      where: { challengeId },
      orderBy: { version: 'desc' },
      include: CONFIG_INCLUDE,
    });
    if (!config) {
      this.logger.error(
        `AI review config for challenge ${challengeId} not found.`,
      );
      throw new NotFoundException(
        `AI review config for challenge ${challengeId} not found.`,
      );
    }
    return config;
  }

  async getById(id: string) {
    const config = await this.prisma.aiReviewConfig.findUnique({
      where: { id },
      include: CONFIG_INCLUDE,
    });
    if (!config) {
      this.logger.error(`AI review config with id ${id} not found.`);
      throw new NotFoundException(`AI review config with id ${id} not found.`);
    }
    return config;
  }

  async update(id: string, dto: UpdateAiReviewConfigDto) {
    const config = await this.getById(id);
    const challengeId = config.challengeId;

    await this.validateChallengeNotCompleted(challengeId);
    await this.validateNoDecisionsForConfig(id);

    const { workflows, ...rest } = dto;
    const configData: Parameters<
      typeof this.prisma.aiReviewConfig.update
    >[0]['data'] = {};
    if (rest.minPassingThreshold !== undefined)
      configData.minPassingThreshold = rest.minPassingThreshold;
    if (rest.mode !== undefined) configData.mode = rest.mode as AiReviewMode;
    if (rest.autoFinalize !== undefined)
      configData.autoFinalize = rest.autoFinalize;
    if (rest.formula !== undefined)
      configData.formula = rest.formula as Prisma.InputJsonValue;

    if (workflows !== undefined && workflows.length > 0) {
      await this.validateWorkflowIdsExist(workflows.map((w) => w.workflowId));
      this.validateWeightsSumTo100(workflows);

      await this.prisma.$transaction(async (tx) => {
        await tx.aiReviewConfigWorkflow.deleteMany({
          where: { configId: id },
        });
        if (Object.keys(configData).length > 0) {
          await tx.aiReviewConfig.update({
            where: { id },
            data: configData,
          });
        }
        await tx.aiReviewConfigWorkflow.createMany({
          data: workflows.map((w) => ({
            configId: id,
            workflowId: w.workflowId,
            weightPercent: w.weightPercent,
            isGating: w.isGating,
          })),
        });
      });
    } else if (Object.keys(configData).length > 0) {
      await this.prisma.aiReviewConfig.update({
        where: { id },
        data: configData,
      });
    }

    return this.getById(id);
  }

  async delete(id: string): Promise<void> {
    const config = await this.getById(id);
    await this.validateChallengeNotCompleted(config.challengeId);
    await this.validateNoDecisionsForConfig(id);

    try {
      await this.prisma.aiReviewConfig.delete({
        where: { id },
      });
    } catch (e: unknown) {
      if (
        e &&
        typeof e === 'object' &&
        'code' in e &&
        (e as { code: string }).code === 'P2025'
      ) {
        throw new NotFoundException(
          `AI review config with id ${id} not found.`,
        );
      }
      throw e;
    }
  }

  async list(filters: ListAiReviewConfigQueryDto) {
    const where: { challengeId?: string; mode?: AiReviewMode } = {};
    if (filters.challengeId?.trim()) {
      where.challengeId = filters.challengeId.trim();
    }
    if (filters.mode !== undefined) {
      where.mode = filters.mode as AiReviewMode;
    }

    return this.prisma.aiReviewConfig.findMany({
      where,
      include: CONFIG_INCLUDE,
      orderBy: [{ challengeId: 'asc' }, { version: 'desc' }],
    });
  }
}
