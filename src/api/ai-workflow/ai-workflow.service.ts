import {
  Injectable,
  BadRequestException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/modules/global/prisma.service';
import {
  CreateAiWorkflowDto,
  UpdateAiWorkflowDto,
} from '../../dto/aiWorkflow.dto';
import { ScorecardStatus } from 'src/dto/scorecard.dto';

@Injectable()
export class AiWorkflowService {
  private readonly logger: Logger = new Logger(AiWorkflowService.name);
  constructor(private readonly prisma: PrismaService) {}

  async scorecardExists(scorecardId: string): Promise<boolean> {
    const count = await this.prisma.scorecard.count({
      where: { id: scorecardId, status: ScorecardStatus.ACTIVE },
    });
    return count > 0;
  }

  async llmModelExists(llmId: string): Promise<boolean> {
    const count = await this.prisma.llmModel.count({
      where: { id: llmId },
    });
    return count > 0;
  }

  async createWithValidation(createAiWorkflowDto: CreateAiWorkflowDto) {
    const { scorecardId, llmId, name, description, defUrl, gitId, gitOwner } =
      createAiWorkflowDto;

    const scorecardExists = await this.scorecardExists(scorecardId);
    if (!scorecardExists) {
      this.logger.error(
        `Active scorecard with id ${scorecardId} does not exist.`,
      );
      throw new BadRequestException(
        `Scorecard with id ${scorecardId} does not exist or is not active.`,
      );
    }

    const llmExists = await this.llmModelExists(llmId);
    if (!llmExists) {
      this.logger.error(`LLM model with id ${llmId} does not exist.`);
      throw new BadRequestException(
        `LLM model with id ${llmId} does not exist.`,
      );
    }

    return this.prisma.aiWorkflow.create({
      data: {
        defUrl,
        description,
        gitId,
        gitOwner,
        name,
        scorecardId,
        llmId,
        // TODO: This has to be removed once the prisma middleware is implemented
        createdBy: '',
        updatedAt: new Date(),
        updatedBy: '',
      },
    });
  }

  async getWorkflowById(id: string) {
    const workflow = await this.prisma.aiWorkflow.findUnique({
      where: { id },
      include: {
        llm: {
          include: {
            provider: true,
          },
        },
        scorecard: true,
      },
    });
    if (!workflow) {
      this.logger.error(`AI workflow with id ${id} not found.`);
      throw new NotFoundException(`AI workflow with id ${id} not found.`);
    }
    return workflow;
  }

  async updateWorkflow(id: string, updateDto: UpdateAiWorkflowDto) {
    const existingWorkflow = await this.prisma.aiWorkflow.findUnique({
      where: { id },
    });
    if (!existingWorkflow) {
      this.logger.error(`AI workflow with id ${id} not found.`);
      throw new NotFoundException(`AI workflow with id ${id} not found.`);
    }

    if (updateDto.scorecardId) {
      const scorecardExists = await this.scorecardExists(updateDto.scorecardId);
      if (!scorecardExists) {
        this.logger.error(
          `Active scorecard with id ${updateDto.scorecardId} does not exist.`,
        );
        throw new BadRequestException(
          `Active scorecard with id ${updateDto.scorecardId} does not exist.`,
        );
      }
    }

    if (updateDto.llmId) {
      const llmExists = await this.llmModelExists(updateDto.llmId);
      if (!llmExists) {
        this.logger.error(
          `LLM model with id ${updateDto.llmId} does not exist.`,
        );
        throw new BadRequestException(
          `LLM model with id ${updateDto.llmId} does not exist.`,
        );
      }
    }

    return this.prisma.aiWorkflow.update({
      where: { id },
      data: updateDto,
    });
  }

  async createRunItemsBatch(workflowId: string, runId: string, items: any[]) {
    const workflow = await this.prisma.aiWorkflow.findUnique({
      where: { id: workflowId },
    });
    if (!workflow) {
      this.logger.error(`Workflow with id ${workflowId} not found.`);
      throw new NotFoundException(`Workflow with id ${workflowId} not found.`);
    }

    const run = await this.prisma.aiWorkflowRun.findUnique({
      where: { id: runId },
      include: { workflow: true },
    });
    if (!run || run.workflowId !== workflowId) {
      this.logger.error(`Run with id ${runId} not found or does not belong to workflow ${workflowId}.`);
      throw new NotFoundException(`Run with id ${runId} not found or does not belong to workflow ${workflowId}.`);
    }

    for (const item of items) {
      if (!item.scorecardQuestionId || !item.content) {
        this.logger.error(`Invalid item: scorecardQuestionId and content are required.`);
        throw new BadRequestException(`Each item must have scorecardQuestionId and content.`);
      }
      const questionExists = await this.prisma.scorecardQuestion.findUnique({
        where: { id: item.scorecardQuestionId },
      });
      if (!questionExists) {
        this.logger.error(`ScorecardQuestion with id ${item.scorecardQuestionId} not found.`);
        throw new BadRequestException(`ScorecardQuestion with id ${item.scorecardQuestionId} not found.`);
      }
    }

    const createdItems = await this.prisma.aiWorkflowRunItem.createMany({
      data: items.map(item => ({
        workflowRunId: runId,
        scorecardQuestionId: item.scorecardQuestionId,
        content: item.content,
        upVotes: item.upVotes ?? 0,
        downVotes: item.downVotes ?? 0,
        questionScore: item.questionScore ?? null,
        createdAt: new Date(),
        // TODO: Remove this once prisma middleware implementation is done
        createdBy: '',
      })),
      skipDuplicates: true,
    });

    return { createdCount: createdItems.count };
  }
}
