import {
  Injectable,
  BadRequestException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/modules/global/prisma.service';
import {
  CreateAiWorkflowDto,
  CreateAiWorkflowRunDto,
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
    const { scorecardId, llmId, ...rest } = createAiWorkflowDto;

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
        ...rest,
        scorecardId,
        llmId,
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

  async createWorkflowRun(workflowId: string, runData: CreateAiWorkflowRunDto) {
    try {
      return await this.prisma.aiWorkflowRun.create({
        data: {
          ...runData,
          workflowId,
        },
      });
    } catch (e) {
      if (e.code === 'P2003') {
        switch (e.meta.field_name) {
          case 'aiWorkflowRun_workflowId_fkey (index)':
            throw new BadRequestException(
              `Invalid workflow id provided! Workflow with id ${workflowId} does not exist!`,
            );
          case 'aiWorkflowRun_submissionId_fkey (index)':
            throw new BadRequestException(
              `Invalid submission id provided! Submission with id ${runData.submissionId} does not exist!`,
            );
          default:
            break;
        }
      }
      throw e;
    }
  }
}
