import {
  Injectable,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/modules/global/prisma.service';
import {
  CreateAiWorkflowDto,
  CreateAiWorkflowRunDto,
  CreateRunItemCommentDto,
  UpdateAiWorkflowDto,
  UpdateAiWorkflowRunDto,
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
import { LoggerService } from 'src/shared/modules/global/logger.service';

@Injectable()
export class AiWorkflowService {
  private readonly logger: LoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly challengeApiService: ChallengeApiService,
    private readonly resourceApiService: ResourceApiService,
  ) {
    this.logger = LoggerService.forRoot('AiWorkflowService');
  }

  async createRunItemComment(
    workflowId: string,
    runId: string,
    itemId: string,
    body: CreateRunItemCommentDto,
    user: JwtUser,
  ) {
    const workflow = await this.prisma.aiWorkflow.findUnique({
      where: { id: workflowId },
    });
    if (!workflow) {
      throw new NotFoundException(`Workflow with id ${workflowId} not found.`);
    }

    const run = await this.prisma.aiWorkflowRun.findUnique({
      where: { id: runId },
    });
    if (!run || run.workflowId !== workflowId) {
      throw new NotFoundException(
        `Run with id ${runId} not found or does not belong to workflow ${workflowId}.`,
      );
    }

    const item = await this.prisma.aiWorkflowRunItem.findUnique({
      where: { id: itemId },
    });
    if (!item || item.workflowRunId !== runId) {
      throw new NotFoundException(
        `Item with id ${itemId} not found or does not belong to run ${runId}.`,
      );
    }

    const createdComment = await this.prisma.aiWorkflowRunItemComment.create({
      data: {
        workflowRunItemId: itemId,
        content: body.content,
        parentId: body.parentId ?? null,
        userId: user.userId!,
        createdAt: new Date(),
      },
    });

    return createdComment;
  }

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

    return this.prisma.aiWorkflow
      .create({
        data: {
          defUrl,
          description,
          gitId,
          gitOwner,
          name,
          scorecardId,
          llmId,
        },
      })
      .catch((e) => {
        if (e.code === 'P2002') {
          throw new ConflictException(
            `Unique constraint failed on the fields - ${e.meta.target.join(',')}`,
          );
        }
      });
  }

  async getWorkflows(filters: { name: string }) {
    const workflows = await this.prisma.aiWorkflow.findMany({
      where: filters.name
        ? { name: { contains: filters.name, mode: 'insensitive' } }
        : {},
      include: {
        llm: {
          include: {
            provider: true,
          },
        },
        scorecard: true,
      },
    });

    return workflows;
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
      this.logger.error(
        `Run with id ${runId} not found or does not belong to workflow ${workflowId}.`,
      );
      throw new NotFoundException(
        `Run with id ${runId} not found or does not belong to workflow ${workflowId}.`,
      );
    }

    for (const item of items) {
      if (!item.scorecardQuestionId || !item.content) {
        this.logger.error(
          `Invalid item: scorecardQuestionId and content are required.`,
        );
        throw new BadRequestException(
          `Each item must have scorecardQuestionId and content.`,
        );
      }
      const questionExists = await this.prisma.scorecardQuestion.findUnique({
        where: { id: item.scorecardQuestionId },
      });
      if (!questionExists) {
        this.logger.error(
          `ScorecardQuestion with id ${item.scorecardQuestionId} not found.`,
        );
        throw new BadRequestException(
          `ScorecardQuestion with id ${item.scorecardQuestionId} not found.`,
        );
      }
    }

    const createdItems = await this.prisma.aiWorkflowRunItem.createMany({
      data: items.map((item) => ({
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
    });

    return { createdCount: createdItems.count };
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
    this.logger.log(
      `fetching workflow runs for workflowId ${workflowId} and ${JSON.stringify(filter)}`,
    );

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
    if ((!submission || !submission.challengeId) && filter.submissionId) {
      throw new BadRequestException(`Invalid submissionId provided!`);
    }

    const challengeId = submission.challengeId;
    const challenge: ChallengeData =
      await this.challengeApiService.getChallengeDetail(challengeId!);

    if (!challenge) {
      throw new InternalServerErrorException(
        `Challenge with id ${challengeId} was not found!`,
      );
    }

    const isM2mOrAdmin = user.isMachine || user.roles?.includes(UserRole.Admin);
    if (!isM2mOrAdmin) {
      const requiredRoles = [
        UserRole.Reviewer,
        UserRole.ProjectManager,
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
          (role) => resource.roleName!.toLowerCase() === role.toLowerCase(),
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
        String(user.userId) !== String(submission.memberId)
      ) {
        this.logger.log(
          `Submitter ${user.userId} trying to access AI workflow run for other submitters.`,
        );
        throw new ForbiddenException('Insufficient permissions');
      }
    }

    return runs.map((r) => ({ ...r, submission: undefined, test: true }));
  }

  async updateWorkflowRun(
    workflowId: string,
    runId: string,
    patchData: UpdateAiWorkflowRunDto,
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

    try {
      await this.prisma.aiWorkflowRun.update({
        where: {
          workflowId,
          id: runId,
        },
        data: { ...patchData },
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error as any).code === 'P2025' // Record not found
      ) {
        throw new NotFoundException(
          `Workflow run with id "${runId}" does not exist!`,
        );
      }

      throw error;
    }
  }

  async getRunItems(workflowId: string, runId: string, user: JwtUser) {
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
      this.logger.error(
        `Run with id ${runId} not found or does not belong to workflow ${workflowId}.`,
      );
      throw new NotFoundException(
        `Run with id ${runId} not found or does not belong to workflow ${workflowId}.`,
      );
    }

    const submission = run.submissionId
      ? await this.prisma.submission.findUnique({
          where: { id: run.submissionId },
        })
      : null;
    const challengeId = submission?.challengeId;

    if (!challengeId) {
      this.logger.error(
        `Challenge ID not found for submission ${run.submissionId}`,
      );
      throw new InternalServerErrorException(
        `Challenge ID not found for submission ${run.submissionId}`,
      );
    }

    const challenge: ChallengeData =
      await this.challengeApiService.getChallengeDetail(challengeId);

    if (!challenge) {
      throw new InternalServerErrorException(
        `Challenge with id ${challengeId} was not found!`,
      );
    }

    const isM2mOrAdmin = user.isMachine || user.roles?.includes(UserRole.Admin);
    if (!isM2mOrAdmin) {
      const requiredRoles = [
        UserRole.Reviewer,
        UserRole.ProjectManager,
        UserRole.Copilot,
        UserRole.Submitter,
      ].map((r) => r.toLowerCase());

      const memberRoles = (
        await this.resourceApiService.getMemberResourcesRoles(
          challengeId,
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
        user.userId?.toString() !== submission?.memberId
      ) {
        this.logger.log(
          `Submitter ${user.userId} trying to access AI workflow run for other submitters.`,
        );
        throw new ForbiddenException('Insufficient permissions');
      }
    }

    const items = await this.prisma.aiWorkflowRunItem.findMany({
      where: { workflowRunId: runId },
      include: {
        comments: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    return items;
  }
}
