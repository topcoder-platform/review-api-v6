import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
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
    const { scorecardId, llmId, createdBy, updatedBy, updatedAt, ...rest } =
      createAiWorkflowDto;

    const scorecardExists = await this.scorecardExists(scorecardId);
    if (!scorecardExists) {
      this.logger.error(
        `Active scorecard with id ${scorecardId} does not exist.`,
      );
      throw new BadRequestException(
        `Active scorecard with id ${scorecardId} does not exist.`,
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
        createdBy,
        updatedBy: updatedBy || createdBy,
        updatedAt: updatedAt || new Date(),
      },
    });
  }

  async getWorkflowById(id: string) {
    const workflow = await this.prisma.aiWorkflow.findUnique({
      where: { id },
    });
    if (!workflow) {
      this.logger.error(`AI workflow with id ${id} not found.`);
      throw new NotFoundException(`AI workflow with id ${id} not found.`);
    }
    return workflow;
  }

  async updateWorkflow(
    id: string,
    updateDto: UpdateAiWorkflowDto,
    updatedBy?: string,
  ) {
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
      data: {
        ...updateDto,
        updatedBy,
        updatedAt: new Date(),
      },
    });
  }
}
