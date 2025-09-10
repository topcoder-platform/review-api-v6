import {
  Injectable,
  BadRequestException,
  Logger,
  NotFoundException,
  InternalServerErrorException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/modules/global/prisma.service';
import {
  CreateAiWorkflowDto,
  CreateAiWorkflowRunDto,
  UpdateAiWorkflowDto,
} from '../../dto/aiWorkflow.dto';
import { ScorecardStatus } from 'src/dto/scorecard.dto';
import { JwtUser } from 'src/shared/modules/global/jwt.service';
import {
  ChallengeApiService,
  ChallengeData,
} from 'src/shared/modules/global/challenge.service';
import { ResourceApiService } from 'src/shared/modules/global/resource.service';
import { UserRole } from 'src/shared/enums/userRole.enum';
import { ChallengeStatus } from 'src/shared/enums/challengeStatus.enum';

@Injectable()
export class AiWorkflowService {
  private readonly logger: Logger = new Logger(AiWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly challengeApiService: ChallengeApiService,
    private readonly resourceApiService: ResourceApiService,
  ) {}

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

  async getWorkflowRuns(
    workflowId: string,
    user: JwtUser,
    filter: { submissionId?: string; runId?: string },
  ) {
    // validate workflowId
    try {
      await this.getWorkflowById(workflowId);
    } catch (e) {
      if (e instanceof NotFoundException) {
        throw new BadRequestException(
          `Invalid workflow id provided! Workflow with id ${workflowId} does not exist!`,
        );
      }
    }

    const runs = await this.prisma.aiWorkflowRun.findMany({
      where: {
        workflowId,
        id: filter.runId,
        submissionId: filter.submissionId,
      },
      include: {
        submission: true,
      },
    });

    if (filter.runId && !runs.length) {
      throw new NotFoundException(
        `AI Workflow run with id ${filter.runId} not found!`,
      );
    }

    const submission = runs[0]?.submission;
    const challengeId = submission?.challengeId;
    const challenge: ChallengeData =
      await this.challengeApiService.getChallengeDetail(challengeId!);

    if (!challenge) {
      throw new InternalServerErrorException(
        `Challenge with id ${challengeId} was not found!`,
      );
    }

    if (!user.isMachine && !user.roles?.includes(UserRole.Admin)) {
      const requiredRoles = [
        UserRole.Reviewer,
        UserRole.Copilot,
        UserRole.Submitter,
      ].map((r) => r.toLowerCase());

      const memberRoles = (
        await this.resourceApiService.getMemberResourcesRoles(
          challengeId!,
          user.userId,
        )
      ).filter((resource) =>
        requiredRoles.some(
          (role) =>
            resource.roleName!.toLowerCase().indexOf(role.toLowerCase()) >= 0,
        ),
      );

      if (!memberRoles.length) {
        throw new ForbiddenException('Insufficient permissions');
      }

      if (
        challenge.status !== ChallengeStatus.COMPLETED &&
        memberRoles.some(
          (r) => r.roleName?.toLowerCase() === UserRole.Submitter.toLowerCase(),
        ) &&
        user.userId !== submission.memberId
      ) {
        this.logger.log(
          `Submitter ${user.userId} trying to access AI workflow run for other submitters.`,
        );
        throw new ForbiddenException('Insufficient permissions');
      }
    }

    return runs;
  }
}
