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
  UpdateAiWorkflowRunItemDto,
  UpdateRunItemCommentDto,
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
import { GiteaService } from 'src/shared/modules/global/gitea.service';
import { MemberPrismaService } from 'src/shared/modules/global/member-prisma.service';
import { VoteType } from '@prisma/client';

@Injectable()
export class AiWorkflowService {
  private readonly logger: LoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly memberPrisma: MemberPrismaService,
    private readonly challengeApiService: ChallengeApiService,
    private readonly resourceApiService: ResourceApiService,
    private readonly giteaService: GiteaService,
  ) {
    this.logger = LoggerService.forRoot('AiWorkflowService');
  }

  async updateCommentById(
    user: JwtUser,
    workflowId: string,
    runId: string,
    itemId: string,
    commentId: string,
    patchData: UpdateRunItemCommentDto,
  ) {
    this.logger.log(
      `Updating comment ${commentId} for workflow ${workflowId}, run ${runId}, item ${itemId}`,
    );

    try {
      const workflow = await this.prisma.aiWorkflow.findUnique({
        where: { id: workflowId },
      });
      if (!workflow) {
        throw new NotFoundException(
          `Workflow with id ${workflowId} not found.`,
        );
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

      const comment = await this.prisma.aiWorkflowRunItemComment.findUnique({
        where: { id: commentId },
      });
      if (!comment || comment.workflowRunItemId !== itemId) {
        throw new NotFoundException(
          `Comment with id ${commentId} not found or does not belong to item ${itemId}.`,
        );
      }

      if (String(comment.userId) !== String(user.userId)) {
        throw new ForbiddenException(
          'User is not the creator of this comment and cannot update it.',
        );
      }

      // Handle vote updates
      if (patchData.upVote !== undefined || patchData.downVote !== undefined) {
        if (!user.userId) {
          throw new BadRequestException('User id is not available');
        }

        // Remove existing votes by this user for this comment
        await this.prisma.aiWorkflowRunItemCommentVote.deleteMany({
          where: {
            workflowRunItemCommentId: commentId,
            createdBy: user.userId.toString(),
          },
        });

        // Add new vote if upVote or downVote is true
        if (patchData.upVote) {
          await this.prisma.aiWorkflowRunItemCommentVote.create({
            data: {
              workflowRunItemCommentId: commentId,
              voteType: VoteType.UPVOTE,
              createdBy: user.userId.toString(),
            },
          });
        } else if (patchData.downVote) {
          await this.prisma.aiWorkflowRunItemCommentVote.create({
            data: {
              workflowRunItemCommentId: commentId,
              voteType: VoteType.DOWNVOTE,
              createdBy: user.userId.toString(),
            },
          });
        }

        delete patchData.downVote;
        delete patchData.upVote;
      }

      // No other fields to update apart from likes
      if (Object.keys(patchData).length === 0) {
        return;
      }

      const allowedFields = ['content'];
      const updateData: any = {};
      for (const key of allowedFields) {
        if (key in patchData) {
          updateData[key] = patchData[key];
        }
      }

      if (Object.keys(updateData).length === 0) {
        throw new BadRequestException('No valid fields provided for update.');
      }

      const updatedComment = await this.prisma.aiWorkflowRunItemComment.update({
        where: { id: commentId },
        data: updateData,
      });

      return updatedComment;
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      this.logger.error(`Failed to update comment ${commentId}`, error);
      throw new InternalServerErrorException('Failed to update comment');
    }
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

    if (!user.userId) {
      throw new BadRequestException(`User id is not available`);
    }

    try {
      const createdComment = await this.prisma.aiWorkflowRunItemComment.create({
        data: {
          workflowRunItemId: itemId,
          content: body.content,
          parentId: body.parentId ?? null,
          userId: user.userId.toString(),
        },
      });
      return createdComment;
    } catch (e) {
      if (e.code === 'P2003') {
        if (
          e.meta.field_name === 'aiWorkflowRunItemComment_parentId_fkey (index)'
        ) {
          throw new BadRequestException(
            `Invalid parent id provided! Parent comment with id ${body.parentId} does not exist!`,
          );
        }
      }
    }
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
    const {
      scorecardId,
      llmId,
      name,
      description,
      defUrl,
      gitWorkflowId,
      gitOwnerRepo,
    } = createAiWorkflowDto;

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
          gitWorkflowId,
          gitOwnerRepo,
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
      const submission = runData.submissionId
        ? await this.prisma.submission.findUnique({
            where: { id: runData.submissionId },
          })
        : null;
      const challengeId = submission?.challengeId;

      if (!challengeId) {
        this.logger.error(
          `Challenge ID not found for submission ${runData.submissionId}`,
        );
        throw new InternalServerErrorException(
          `Challenge ID not found for submission ${runData.submissionId}`,
        );
      }

      const challenge: ChallengeData =
        await this.challengeApiService.getChallengeDetail(challengeId);

      if (!challenge) {
        throw new InternalServerErrorException(
          `Challenge with id ${challengeId} was not found!`,
        );
      }

      const allowedPhases = ['Submission', 'Review', 'Iterative Review'];
      const phases = challenge.phases || [];
      const isInAllowedPhase = phases.some(
        (phase) => allowedPhases.includes(phase.name) && phase.isOpen,
      );

      if (!isInAllowedPhase) {
        if (challenge.status !== ChallengeStatus.COMPLETED) {
          throw new InternalServerErrorException(
            `Challenge ${submission.challengeId} is not in an allowed phase and is not completed.`,
          );
        }
      }

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
    });

    if (filter.runId && !runs.length) {
      throw new NotFoundException(
        `AI Workflow run with id ${filter.runId} not found!`,
      );
    }

    const submission = runs[0]?.submission;
    if ((!submission || !submission.challengeId) && filter.submissionId) {
      this.logger.log(
        `No runs have been found for submission ${filter.submissionId}`,
      );
      return [];
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
        UserRole.IterativeReviewer,
        UserRole.Reviewer,
        UserRole.Screener,
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

    return runs.map((r) => ({ ...r, submission: undefined }));
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

  /**
   * Fetches the workflow & run data for the specified workflowId and runId
   * It also makes sure the specified user has the right permissions to access the run
   * @param user
   * @param workflowId
   * @param runId
   * @returns
   */
  private async getWorkflowRunWithGuards(
    user: JwtUser,
    workflowId: string,
    runId: string,
  ) {
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

      const userRoles = await this.resourceApiService.getMemberResourcesRoles(
        challengeId,
        user.userId,
      );

      const memberRoles = userRoles.filter((resource) =>
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

    return { workflow, run };
  }

  async getWorkflowRunAttachments(
    workflowId: string,
    runId: string,
    user: JwtUser,
  ) {
    const { workflow, run } = await this.getWorkflowRunWithGuards(
      user,
      workflowId,
      runId,
    );

    const [owner, repo] = workflow.gitOwnerRepo.split('/');
    const artifacts = await this.giteaService.getWorkflowRunArtifacts(
      owner,
      repo,
      +run.gitRunId,
    );
    return artifacts;
  }

  async downloadWorkflowRunAttachment(
    workflowId: string,
    runId: string,
    attachmentId: string,
    user: JwtUser,
  ) {
    const { workflow } = await this.getWorkflowRunWithGuards(
      user,
      workflowId,
      runId,
    );

    const [owner, repo] = workflow.gitOwnerRepo.split('/');
    return this.giteaService.downloadWorkflowRunArtifact(
      owner,
      repo,
      attachmentId,
    );
  }

  async getRunItems(workflowId: string, runId: string, user: JwtUser) {
    await this.getWorkflowRunWithGuards(user, workflowId, runId);

    const items = await this.prisma.aiWorkflowRunItem.findMany({
      where: { workflowRunId: runId },
      include: {
        comments: {
          include: {
            votes: true,
          },
        },
        votes: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    const createdByList = items
      .map((item) => item.comments)
      .flat()
      .map((item) => item.createdBy as string);

    const members = await this.memberPrisma.member.findMany({
      where: { userId: { in: createdByList.map((id) => BigInt(id)) } },
      select: {
        userId: true,
        handle: true,
        maxRating: { select: { rating: true } },
      },
    });

    const membersMap = members.reduce(
      (acc, item) => {
        if (item.userId) {
          acc[item.userId.toString()] = item;
        }
        return acc;
      },
      {} as Record<string, (typeof members)[0]>,
    );

    return items.map((item) => ({
      ...item,
      comments: item.comments.map((comment) => ({
        ...comment,
        createdUser: membersMap[comment.createdBy as string],
      })),
    }));
  }

  async updateRunItem(
    workflowId: string,
    runId: string,
    itemId: string,
    patchData: UpdateAiWorkflowRunItemDto,
    user: JwtUser,
  ) {
    const workflow = await this.prisma.aiWorkflow.findUnique({
      where: { id: workflowId },
    });
    if (!workflow) {
      this.logger.error(`Workflow with id ${workflowId} not found.`);
      throw new NotFoundException(`Workflow with id ${workflowId} not found.`);
    }

    const run = await this.prisma.aiWorkflowRun.findUnique({
      where: { id: runId },
    });
    if (!run || run.workflowId !== workflowId) {
      this.logger.error(
        `Run with id ${runId} not found or does not belong to workflow ${workflowId}.`,
      );
      throw new NotFoundException(
        `Run with id ${runId} not found or does not belong to workflow ${workflowId}.`,
      );
    }

    const runItem = await this.prisma.aiWorkflowRunItem.findUnique({
      where: { id: itemId },
    });
    if (!runItem || runItem.workflowRunId !== runId) {
      this.logger.error(
        `Run item with id ${itemId} not found or does not belong to run ${runId}.`,
      );
      throw new NotFoundException(
        `Run item with id ${itemId} not found or does not belong to run ${runId}.`,
      );
    }

    if (!user.isMachine) {
      const keys = Object.keys(patchData);
      const prohibitedKeys = ['content', 'questionScore'];
      if (keys.some((key) => prohibitedKeys.includes(key))) {
        throw new BadRequestException(
          `Users cannot update one of these properties - ${prohibitedKeys.join(',')}`,
        );
      }
    }

    if (patchData.upVote !== undefined || patchData.downVote !== undefined) {
      // Remove existing votes by this user for this item
      if (!user.userId) {
        throw new BadRequestException('User id is not available');
      }

      await this.prisma.aiWorkflowRunItemVote.deleteMany({
        where: {
          workflowRunItemId: itemId,
          createdBy: user.userId.toString(),
        },
      });

      // Add new vote if upVote or downVote is true
      if (patchData.upVote) {
        await this.prisma.aiWorkflowRunItemVote.create({
          data: {
            workflowRunItemId: itemId,
            voteType: VoteType.UPVOTE,
            createdBy: user.userId.toString(),
          },
        });
      } else if (patchData.downVote) {
        await this.prisma.aiWorkflowRunItemVote.create({
          data: {
            workflowRunItemId: itemId,
            voteType: VoteType.DOWNVOTE,
            createdBy: user.userId.toString(),
          },
        });
      }

      delete patchData.downVote;
      delete patchData.upVote;
    }

    // Update other properties only allowed for machine users
    const updateData: any = {};
    if (user.isMachine) {
      if (patchData.content) {
        updateData.content = patchData.content;
      }
      if (patchData.questionScore) {
        updateData.questionScore = patchData.questionScore;
      }
    }

    // If there are no other fields to update
    // just return the run item
    if (Object.keys(updateData).length === 0) {
      return this.prisma.aiWorkflowRunItem.findUnique({
        where: { id: itemId },
        include: {
          comments: true,
          votes: true,
        },
      });
    }

    return this.prisma.aiWorkflowRunItem.update({
      where: { id: itemId },
      include: {
        comments: true,
        votes: true,
      },
      data: updateData,
    });
  }
}
