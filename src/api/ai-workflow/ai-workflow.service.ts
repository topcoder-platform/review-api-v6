import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../shared/modules/global/prisma.service';
import { CreateAiWorkflowDto } from '../../dto/aiWorkflow.dto';
import { ScorecardStatus } from 'src/dto/scorecard.dto';

@Injectable()
export class AiWorkflowService {
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
    const { scorecardId, llmId, name, description, defUrl, gitId, gitOwner  } = createAiWorkflowDto;

    const scorecardExists = await this.scorecardExists(scorecardId);
    if (!scorecardExists) {
      throw new BadRequestException(
        `Scorecard with id ${scorecardId} does not exist or is not active.`,
      );
    }

    const llmExists = await this.llmModelExists(llmId);
    if (!llmExists) {
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
        updatedAt: '',
        updatedBy: '',
      },
    });
  }
}
