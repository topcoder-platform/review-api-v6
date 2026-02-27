import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/modules/global/prisma.service';
import { LoggerService } from 'src/shared/modules/global/logger.service';
import { ChallengePrismaService } from '../../shared/modules/global/challenge-prisma.service';
import {
  CreateAiReviewTemplateConfigDto,
  UpdateAiReviewTemplateConfigDto,
} from '../../dto/aiReviewTemplateConfig.dto';
import { AiReviewMode, Prisma } from '@prisma/client';

const TEMPLATE_INCLUDE = {
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
} as const;

@Injectable()
export class AiReviewTemplateService {
  private readonly logger: LoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly challengePrisma: ChallengePrismaService,
  ) {
    this.logger = LoggerService.forRoot('AiReviewTemplateService');
  }

  private async validateChallengeTrackExists(value: string): Promise<void> {
    const trimmed = value.trim();
    const rows = await this.challengePrisma.$queryRaw<{ exists: number }[]>`
      SELECT 1 AS exists
      FROM "ChallengeTrack"
      WHERE track::text = ${trimmed}
      LIMIT 1
    `;
    if (!rows?.length) {
      throw new BadRequestException(
        `Invalid challengeTrack: "${value}". Must match an existing track id, name, or abbreviation.`,
      );
    }
  }

  private async validateChallengeTypeExists(value: string): Promise<void> {
    const trimmed = value.trim();
    const rows = await this.challengePrisma.$queryRaw<{ exists: number }[]>`
      SELECT 1 AS exists
      FROM "ChallengeType"
      WHERE id = ${trimmed} OR name = ${trimmed} OR abbreviation = ${trimmed}
      LIMIT 1
    `;
    if (!rows?.length) {
      throw new BadRequestException(
        `Invalid challengeType: "${value}". Must match an existing type id, name, or abbreviation.`,
      );
    }
  }

  private validateFormulaNotEmpty(formula: unknown): void {
    if (
      formula != null &&
      typeof formula === 'object' &&
      !Array.isArray(formula) &&
      Object.keys(formula).length === 0
    ) {
      throw new BadRequestException('formula must not be an empty object');
    }
  }

  private validateWeightsSumTo100(
    workflows: { weightPercent: number }[],
  ): void {
    const sum = workflows.reduce((acc, w) => acc + w.weightPercent, 0);
    const rounded = Math.round(sum * 100) / 100;
    if (rounded !== 100) {
      throw new BadRequestException(
        `Workflow weights must sum to 100 (got ${sum}).`,
      );
    }
  }

  private validateNoDuplicateWorkflowIds(
    workflows: { workflowId: string }[],
  ): void {
    const workflowIds = workflows.map((w) => w.workflowId);
    if (workflowIds.length === new Set(workflowIds).size) return;
    const seen = new Set<string>();
    const duplicateIds = new Set<string>();
    for (const id of workflowIds) {
      if (seen.has(id)) duplicateIds.add(id);
      else seen.add(id);
    }
    throw new BadRequestException(
      `Duplicate workflow IDs are not allowed. Each workflow can only appear once. Duplicates: ${[...duplicateIds].join(', ')}.`,
    );
  }

  async create(dto: CreateAiReviewTemplateConfigDto) {
    await this.validateChallengeTrackExists(dto.challengeTrack);
    await this.validateChallengeTypeExists(dto.challengeType);
    if (dto.formula !== undefined) {
      this.validateFormulaNotEmpty(dto.formula);
    }

    const workflowIds = dto.workflows.map((w) => w.workflowId);
    if (workflowIds.length === 0) {
      throw new BadRequestException('At least one workflow is required.');
    }

    this.validateNoDuplicateWorkflowIds(dto.workflows);

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

    this.validateWeightsSumTo100(dto.workflows);

    const { workflows, ...configData } = dto;
    const existing = await this.prisma.aiReviewTemplateConfig.findFirst({
      where: {
        challengeTrack: configData.challengeTrack,
        challengeType: configData.challengeType,
      },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = (existing?.version ?? 0) + 1;

    const template = await this.prisma.aiReviewTemplateConfig.create({
      data: {
        challengeTrack: configData.challengeTrack,
        challengeType: configData.challengeType,
        version: nextVersion,
        title: configData.title,
        description: configData.description,
        minPassingThreshold: configData.minPassingThreshold,
        mode: configData.mode as AiReviewMode,
        autoFinalize: configData.autoFinalize,
        formula:
          configData.formula != null
            ? (configData.formula as Prisma.InputJsonValue)
            : undefined,
      },
    });

    await this.prisma.aiReviewTemplateConfigWorkflow.createMany({
      data: workflows.map((w) => ({
        configId: template.id,
        workflowId: w.workflowId,
        weightPercent: w.weightPercent,
        isGating: w.isGating,
      })),
    });

    return this.findById(template.id);
  }

  async findById(id: string) {
    const template = await this.prisma.aiReviewTemplateConfig.findUnique({
      where: { id },
      include: TEMPLATE_INCLUDE,
    });
    if (!template) {
      this.logger.error(`AI review template with id ${id} not found.`);
      throw new NotFoundException(
        `AI review template with id ${id} not found.`,
      );
    }
    return {
      ...template,
      minPassingThreshold:
        template.minPassingThreshold != null
          ? Number(template.minPassingThreshold)
          : template.minPassingThreshold,
      workflows: template.workflows.map((w) => ({
        ...w,
        weightPercent: Number(w.weightPercent),
      })),
    };
  }

  async findAll(filters: { challengeTrack?: string; challengeType?: string }) {
    const where: { challengeTrack?: string; challengeType?: string } = {};
    if (filters.challengeTrack?.trim()) {
      where.challengeTrack = filters.challengeTrack.trim();
    }
    if (filters.challengeType?.trim()) {
      where.challengeType = filters.challengeType.trim();
    }

    const results = await this.prisma.aiReviewTemplateConfig.findMany({
      where,
      include: TEMPLATE_INCLUDE,
    });

    return results.map((template) => ({
      ...template,
      minPassingThreshold:
        template.minPassingThreshold != null
          ? Number(template.minPassingThreshold)
          : template.minPassingThreshold,
      workflows: template.workflows.map((w) => ({
        ...w,
        weightPercent: Number(w.weightPercent),
      })),
    }));
  }

  async update(id: string, dto: UpdateAiReviewTemplateConfigDto) {
    await this.findById(id);

    if (dto.formula !== undefined) {
      this.validateFormulaNotEmpty(dto.formula);
    }

    const { workflows, ...rest } = dto;
    const configData: Parameters<
      typeof this.prisma.aiReviewTemplateConfig.update
    >[0]['data'] = {};
    if (rest.title !== undefined) configData.title = rest.title;
    if (rest.description !== undefined)
      configData.description = rest.description;
    if (rest.minPassingThreshold !== undefined)
      configData.minPassingThreshold = rest.minPassingThreshold;
    if (rest.mode !== undefined) configData.mode = rest.mode as AiReviewMode;
    if (rest.autoFinalize !== undefined)
      configData.autoFinalize = rest.autoFinalize;
    if (rest.formula !== undefined)
      configData.formula = rest.formula as Prisma.InputJsonValue;

    if (workflows !== undefined) {
      this.validateNoDuplicateWorkflowIds(workflows);
      const workflowIds = workflows.map((w) => w.workflowId);
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

      this.validateWeightsSumTo100(workflows);

      await this.prisma.$transaction(async (tx) => {
        await tx.aiReviewTemplateConfigWorkflow.deleteMany({
          where: { configId: id },
        });
        if (Object.keys(configData).length > 0) {
          await tx.aiReviewTemplateConfig.update({
            where: { id },
            data: configData,
          });
        }
        await tx.aiReviewTemplateConfigWorkflow.createMany({
          data: workflows.map((w) => ({
            configId: id,
            workflowId: w.workflowId,
            weightPercent: w.weightPercent,
            isGating: w.isGating,
          })),
        });
      });
    } else if (Object.keys(configData).length > 0) {
      await this.prisma.aiReviewTemplateConfig.update({
        where: { id },
        data: configData,
      });
    }

    return this.findById(id);
  }

  async delete(id: string) {
    try {
      await this.prisma.aiReviewTemplateConfig.delete({
        where: { id },
      });
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'code' in e && e.code === 'P2025') {
        throw new NotFoundException(
          `AI review template with id ${id} not found.`,
        );
      }
      throw e;
    }
  }
}
