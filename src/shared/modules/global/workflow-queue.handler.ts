import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { GiteaService } from './gitea.service';
import { PrismaService } from './prisma.service';
import { QueueSchedulerService } from './queue-scheduler.service';
import { Job } from 'pg-boss';
import { aiWorkflow, aiWorkflowRun } from '@prisma/client';
import { EventBusSendEmailPayload, EventBusService } from './eventBus.service';
import { CommonConfig } from 'src/shared/config/common.config';
import { ChallengePrismaService } from './challenge-prisma.service';
import { MemberPrismaService } from './member-prisma.service';
import { AiReviewerDecisionMakerService } from './ai-reviewer-decision-maker.service';
import { ChallengeApiService, PhaseData } from './challenge.service';
import { SubmissionService } from 'src/api/submission/submission.service';

// A helper to generate a 32-bit integer hash from a string
function stringToHash(string: string): number {
  let hash = 0;
  if (string.length === 0) return hash;
  for (let i = 0; i < string.length; i++) {
    const char = string.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash;
}

@Injectable()
export class WorkflowQueueHandler implements OnModuleInit {
  private readonly logger: Logger = new Logger(WorkflowQueueHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly challengesPrisma: ChallengePrismaService,
    private readonly challengeApiService: ChallengeApiService,
    private readonly membersPrisma: MemberPrismaService,
    private readonly scheduler: QueueSchedulerService,
    private readonly giteaService: GiteaService,
    private readonly eventBusService: EventBusService,
    private readonly aiReviewerDecisionMaker: AiReviewerDecisionMakerService,
    private readonly submissionService: SubmissionService,
  ) {}

  private async triggerEvaluateSubmission(submissionId: string): Promise<void> {
    try {
      const decision =
        await this.aiReviewerDecisionMaker.evaluateSubmission(submissionId);
      const decisionStatus = String((decision as any)?.status ?? '')
        .trim()
        .toUpperCase();
      if (
        decisionStatus &&
        ['PASSED', 'HUMAN_OVERRIDE'].includes(decisionStatus)
      ) {
        await this.submissionService.ensurePendingReviewsForSubmission(
          submissionId,
          {
            requireAiDecisionPass: true,
            triggerSource: 'ai-decision',
          },
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : JSON.stringify(error);
      this.logger.error(
        `Failed to evaluate submission ${submissionId}. error=${errorMessage}`,
      );
      try {
        await this.aiReviewerDecisionMaker.markDecisionError(
          submissionId,
          `Failed to evaluate AI decision: ${errorMessage}`,
        );
      } catch (markError) {
        const markErrorMessage =
          markError instanceof Error
            ? markError.message
            : JSON.stringify(markError);
        this.logger.error(
          `Failed to mark AI decision error for submission ${submissionId}: ${markErrorMessage}`,
        );
      }
    }
  }

  async onModuleInit() {
    const queues = (
      await this.prisma.aiWorkflow.groupBy({
        by: ['gitWorkflowId'],
        where: {
          disabled: false,
        },
      })
    ).map((d) => d.gitWorkflowId);

    await this.scheduler.handleWorkForQueues<{ data: any }>(
      queues,
      this.handleQueuedWorkflowRun.bind(this),
    );
  }

  async queueWorkflowRuns(
    aiWorkflows: { id: string }[],
    challengeId: string,
    submissionId: string,
  ) {
    const requestedWorkflowIds = aiWorkflows
      .map((workflow) => workflow.id)
      .filter((id): id is string => Boolean(id));

    const activeWorkflows = await this.prisma.aiWorkflow.findMany({
      where: {
        id: { in: requestedWorkflowIds },
        disabled: false,
      },
      select: {
        id: true,
      },
    });

    if (!activeWorkflows.length) {
      this.logger.log(
        `No active AI workflows to queue for challenge ${challengeId}, submission ${submissionId}.`,
      );
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      // get a lock for the challengeId, submissionId pair
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${stringToHash(`queueWorkflowRuns, ${challengeId}:${submissionId}`)})`;

      // check if workflow runs have already been queued for this submission
      const alreadyQueued = await this.hasQueuedWorkflowRuns(submissionId);

      if (alreadyQueued) {
        this.logger.log(
          `AI workflow runs already queued for submission ${submissionId}. Skipping queueing.`,
        );
        return;
      }

      const workflowRuns = await tx.aiWorkflowRun.createManyAndReturn({
        data: activeWorkflows.map((workflow) => ({
          workflowId: workflow.id,
          submissionId,
          status: 'INIT',
          gitRunId: '',
        })),
        include: {
          workflow: { select: { gitWorkflowId: true } },
        },
      });

      if (!this.scheduler.isEnabled) {
        this.logger.log(
          'Scheduler is disabled, skipping scheduling workflowRuns for now!',
        );
        return;
      }

      for (const run of workflowRuns) {
        await this.scheduler.queueJob(run.workflow.gitWorkflowId, run.id, {
          workflowId: run.workflowId,
          params: {
            challengeId,
            submissionId,
            aiWorkflowId: run.workflowId,
            aiWorkflowRunId: run.id,
          },
        });

        await tx.aiWorkflowRun.update({
          where: { id: run.id },
          data: { status: 'QUEUED' },
        });
      }
    });
  }

  async hasQueuedWorkflowRuns(submissionId: string): Promise<boolean> {
    if (!submissionId) return false;

    const existing = await this.prisma.aiWorkflowRun.findFirst({
      where: {
        submissionId,
      },
    });

    return !!existing;
  }

  async handleQueuedWorkflowRun([job]: [Job]) {
    this.logger.log(`Processing job ${job.id}`);

    const workflow = await this.prisma.aiWorkflow.findUniqueOrThrow({
      where: { id: (job.data as { workflowId: string })?.workflowId },
    });

    if (workflow.disabled) {
      const queuedRunId = (job.data as { jobId?: string })?.jobId;
      if (queuedRunId) {
        await this.prisma.aiWorkflowRun.update({
          where: { id: queuedRunId },
          data: {
            status: 'CANCELLED',
            completedAt: new Date(),
          },
        });
      }

      this.logger.warn(
        `Skipping dispatch for disabled workflow ${workflow.id}. job=${job.id}`,
      );
      return;
    }

    const workflowRun = await this.prisma.aiWorkflowRun.findUniqueOrThrow({
      where: { id: (job.data as { jobId: string })?.jobId },
    });

    await this.giteaService.runDispatchWorkflow(
      workflow,
      workflowRun,
      (job.data as { params: any })?.params,
    );

    await this.prisma.aiWorkflowRun.update({
      where: { id: workflowRun.id },
      data: {
        status: 'DISPATCHED',
        scheduledJobId: job.id,
        completedJobs: 0,
      },
    });

    this.logger.log(`Job ${job.id} promise finished.`);
  }

  async handleWorkflowRunEvents(event: {
    action: 'queued' | 'waiting' | 'in_progress' | 'completed';
    workflow_job: {
      id: number;
      run_id: string;
      html_url: string;
      name: string;
      conclusion: string;
    };
    repository: { full_name: string };
  }) {
    if (!['in_progress', 'completed'].includes(event.action)) {
      this.logger.log(
        `Skipping ${event.action} event for git workflow id ${event.workflow_job.id}.`,
      );
      return;
    }

    const aiWorkflowRuns = await this.prisma.aiWorkflowRun.findMany({
      where: {
        status: { in: ['DISPATCHED', 'IN_PROGRESS'] },
        gitRunId: `${event.workflow_job.run_id}`,
      },
      include: {
        workflow: true,
      },
    });

    if (aiWorkflowRuns.length > 1) {
      this.logger.error(
        `ERROR! There are more than 1 workflow runs in DISPATCHED status and workflow.gitWorkflowId=${event.workflow_job.name}!`,
      );
      return;
    }

    let [aiWorkflowRun]: ((typeof aiWorkflowRuns)[0] | null)[] = aiWorkflowRuns;

    if (
      !aiWorkflowRun &&
      event.action === 'in_progress' &&
      event.workflow_job.name === 'dump-workflow-context'
    ) {
      const [owner, repo] = event.repository.full_name.split('/');
      const { aiWorkflowRunId, jobsCount } =
        (await this.giteaService.getAiWorkflowDataFromLogs(
          owner,
          repo,
          event.workflow_job.id,
        )) ?? ({} as any);

      if (!aiWorkflowRunId) {
        this.logger.error(
          `Failed to find workflow run ID from logs for job with id ${event.workflow_job.id}`,
        );
        return;
      }

      if (!jobsCount) {
        this.logger.error(
          `Failed to find jobs count from logs for job with id ${event.workflow_job.id}`,
        );
        return;
      }

      aiWorkflowRun = await this.prisma.aiWorkflowRun.findUnique({
        where: {
          id: aiWorkflowRunId,
        },
        include: {
          workflow: true,
        },
      });

      if (!aiWorkflowRun || aiWorkflowRun.status !== 'DISPATCHED') {
        this.logger.error(
          `Workflow run with id ${aiWorkflowRunId} is not in DISPATCHED status or not found. Status: ${aiWorkflowRun?.status}`,
        );
        return;
      }

      await this.prisma.aiWorkflowRun.update({
        where: { id: aiWorkflowRunId },
        data: {
          gitRunId: `${event.workflow_job.run_id}`,
          gitRunUrl: `${event.workflow_job.html_url}`,
          jobsCount,
          completedJobs: { increment: 1 },
        },
      });

      this.logger.log({
        message: 'Updated aiWorkflowRun with gitRunId after lookup',
        aiWorkflowRunId,
        gitRunId: event.workflow_job.run_id,
        jobId: event.workflow_job.id,
      });
    }

    if (!aiWorkflowRun) {
      this.logger.error({
        message: 'No matching aiWorkflowRun found for workflow_job event',
        workflowJobId: event.workflow_job.id,
        gitRunId: event.workflow_job.run_id,
        gitJobStatus: event.action,
      });

      return;
    }

    if (event.workflow_job.name === 'dump-workflow-context') {
      // no further processing needed, this job is meant to sync our db run with the git run
      return;
    }

    const conclusion = event.workflow_job.conclusion?.toUpperCase();
    switch (event.action) {
      case 'in_progress':
        if (aiWorkflowRun.status !== 'DISPATCHED') {
          break;
        }

        await this.prisma.aiWorkflowRun.update({
          where: { id: aiWorkflowRun.id },
          data: {
            status: 'IN_PROGRESS',
            startedAt: new Date(),
          },
        });
        this.logger.log({
          message: 'Workflow job is now in progress',
          aiWorkflowRunId: aiWorkflowRun.id,
          gitRunId: event.workflow_job.run_id,
          jobId: event.workflow_job.id,
          status: 'IN_PROGRESS',
          timestamp: new Date().toISOString(),
        });
        break;
      case 'completed':
        // we need to mark the run as completed only when the last job in the run has been completed
        if (
          (aiWorkflowRun.completedJobs ?? 0) + 1 !==
          aiWorkflowRun.jobsCount
        ) {
          await this.prisma.aiWorkflowRun.update({
            where: { id: aiWorkflowRun.id },
            data: {
              completedJobs: { increment: 1 },
            },
          });
          this.logger.log(
            `Workflow job ${(aiWorkflowRun.completedJobs ?? 0) + 1}/${aiWorkflowRun.jobsCount} completed.`,
          );
          await this.triggerEvaluateSubmission(aiWorkflowRun.submissionId);
          break;
        }

        await this.prisma.aiWorkflowRun.update({
          where: { id: aiWorkflowRun.id },
          data: {
            status: conclusion,
            completedAt: new Date(),
            completedJobs: { increment: 1 },
          },
        });

        await this.triggerEvaluateSubmission(aiWorkflowRun.submissionId);

        try {
          await this.scheduler.completeJob(
            (aiWorkflowRun as any).workflow.gitWorkflowId,
            aiWorkflowRun.scheduledJobId as string,
            conclusion === 'FAILURE' ? 'fail' : 'complete',
          );

          if (conclusion === 'FAILURE') {
            this.logger.log({
              message: `Workflow job ${aiWorkflowRun.id} failed. Retrying!`,
              aiWorkflowRunId: aiWorkflowRun.id,
              gitRunId: event.workflow_job.run_id,
              jobId: event.workflow_job.id,
              status: conclusion,
              timestamp: new Date().toISOString(),
            });
            return;
          }
        } catch (e) {
          this.logger.log(aiWorkflowRun.id, e.message);
          return;
        }

        this.logger.log({
          message: `Workflow job ${aiWorkflowRun.id} completed with conclusion: ${conclusion}`,
          aiWorkflowRunId: aiWorkflowRun.id,
          gitRunId: event.workflow_job.run_id,
          jobId: event.workflow_job.id,
          status: conclusion,
          timestamp: new Date().toISOString(),
        });

        try {
          await this.sendWorkflowRunCompletedNotification(aiWorkflowRun);
        } catch (e) {
          this.logger.log(
            `Failed to send workflowRun completed notification for aiWorkflowRun ${aiWorkflowRun.id}. Got error ${e.message ?? e}!`,
          );
        }

        // Check if all AI workflows for the challenge are complete and publish phase completion event
        try {
          if (aiWorkflowRun.submissionId) {
            const submission = await this.prisma.submission.findUnique({
              where: { id: aiWorkflowRun.submissionId },
              select: { challengeId: true },
            });

            if (submission?.challengeId) {
              await this.publishAiWorkflowPhaseCompletedEvent(
                submission.challengeId,
                aiWorkflowRun.submissionId,
              );
            }
          }
        } catch (e) {
          this.logger.error(
            `Failed to publish AI workflow phase completion event for aiWorkflowRun ${aiWorkflowRun.id}. Got error ${e.message ?? e}!`,
          );
        }
        break;
      default:
        break;
    }
  }

  async sendWorkflowRunCompletedNotification(
    aiWorkflowRun: aiWorkflowRun & { workflow: aiWorkflow },
  ) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: aiWorkflowRun.submissionId },
    });

    if (!submission) {
      this.logger.log(
        `Failed to send workflowRun completed notification for aiWorkflowRun ${aiWorkflowRun.id}. Submission ${aiWorkflowRun.submissionId} is missing!`,
      );
      return;
    }

    const [challenge] = await this.challengesPrisma.$queryRaw<
      { id: string; name: string }[]
    >`
      SELECT
        id,
        name
      FROM challenges."Challenge" c
      WHERE c.id=${submission.challengeId}
    `;

    if (!challenge) {
      this.logger.log(
        `Failed to send workflowRun completed notification for aiWorkflowRun ${aiWorkflowRun.id}. Challenge ${submission.challengeId} couldn't be fetched!`,
      );
      return;
    }

    const [user] = await this.membersPrisma.$queryRaw<
      {
        handle: string;
        email: string;
        firstName?: string;
        lastName?: string;
      }[]
    >`
      SELECT
        handle,
        email,
        "firstName",
        "lastName"
      FROM members.member u
      WHERE u."userId"::text=${submission.memberId}
    `;

    if (!user) {
      this.logger.log(
        `Failed to send workflowRun completed notification for aiWorkflowRun ${aiWorkflowRun.id}. User ${submission.memberId} couldn't be fetched!`,
      );
      return;
    }

    await this.eventBusService.sendEmail({
      ...new EventBusSendEmailPayload(),
      sendgrid_template_id:
        CommonConfig.sendgridConfig.aiWorkflowRunCompletedEmailTemplate,
      recipients: [user.email],
      data: {
        userName:
          [user.firstName, user.lastName].filter(Boolean).join(' ') ||
          user.handle,
        aiWorkflowName: aiWorkflowRun.workflow.name,
        reviewLink: `${CommonConfig.ui.reviewUIUrl}/active-challenges/${challenge.id}/reviews/${submission.id}?workflowId=${aiWorkflowRun.workflowId}`,
        submissionId: submission.id,
        challengeName: challenge.name,
      },
    });
  }

  /**
   * Count the number of in-progress AI workflow runs for a challenge.
   * Used to determine if the AI Screening phase can be closed.
   */
  async getInProgressAiWorkflowRunCount(
    challengeId: string,
    aiWorkflowIds: string[],
    submissionId?: string,
  ): Promise<number> {
    if (!aiWorkflowIds || aiWorkflowIds.length === 0) {
      return 0;
    }

    const inProgressStatuses = ['INIT', 'QUEUED', 'DISPATCHED', 'IN_PROGRESS'];

    const count = await this.prisma.aiWorkflowRun.count({
      where: {
        workflowId: { in: aiWorkflowIds },
        status: { in: inProgressStatuses },
        submissionId: submissionId || undefined,
        submission: submissionId
          ? undefined
          : {
              challengeId,
            },
      },
    });

    return count;
  }

  /**
   * Check if all AI workflow runs are complete for a challenge.
   * Returns true if there are no in-progress runs.
   */
  private async areAllAiWorkflowsComplete(
    challengeId: string,
    aiWorkflowIds: string[],
    submissionId?: string,
  ): Promise<boolean> {
    if (!aiWorkflowIds || aiWorkflowIds.length === 0) {
      return true;
    }

    const inProgressCount = await this.getInProgressAiWorkflowRunCount(
      challengeId,
      aiWorkflowIds,
      submissionId,
    );

    return inProgressCount === 0;
  }

  /**
   * Publish an event when AI workflow runs for a submission have completed.
   * For F2F challenges, publishes immediately per-submission.
   * For non-F2F challenges, waits for all AI workflows to complete.
   */
  async publishAiWorkflowPhaseCompletedEvent(
    challengeId: string,
    submissionId: string,
  ): Promise<void> {
    try {
      // Get challenge details to find AI Screening phase
      const challenge =
        await this.challengeApiService.getChallengeDetail(challengeId);

      if (!challenge || !challenge.phases) {
        this.logger.warn(
          `[publishAiWorkflowPhaseCompletedEvent] Challenge ${challengeId} not found or has no phases`,
        );
        return;
      }

      // Find the latest AI Screening phase iteration
      const latestAiScreeningPhase =
        [...challenge.phases]
          .filter((phase) => phase.name === 'AI Screening')
          .sort((a, b) => this.getPhaseSortTime(a) - this.getPhaseSortTime(b))
          .at(-1) ?? null;

      if (!latestAiScreeningPhase) {
        this.logger.debug(
          `[publishAiWorkflowPhaseCompletedEvent] No AI Screening phase found for challenge ${challengeId}`,
        );
        return;
      }

      // Check if AI Screening phase is still open
      if (!latestAiScreeningPhase.isOpen) {
        this.logger.debug(
          `[publishAiWorkflowPhaseCompletedEvent] AI Screening phase ${latestAiScreeningPhase.id} is not open for challenge ${challengeId}`,
        );
        return;
      }

      // Get all AI workflow IDs configured for this challenge
      const aiWorkflowIds: string[] = Array.from(
        new Set(
          (challenge.workflows ?? [])
            .map((workflow) => workflow.id)
            .filter((workflowId): workflowId is string => Boolean(workflowId)),
        ),
      );

      if (aiWorkflowIds.length === 0) {
        this.logger.debug(
          `[publishAiWorkflowPhaseCompletedEvent] No AI workflows configured for challenge ${challengeId}`,
        );
        return;
      }

      // For F2F challenges, publish immediately per-submission without waiting for all workflows.
      // The autopilot will close the AI Screening phase and process submissions one at a time.
      // We still need to ensure all workflows for this submission have completed.
      const isF2F = this.isFirst2FinishChallenge(challenge.type);

      if (isF2F) {
        const submissionComplete = await this.areAllAiWorkflowsComplete(
          challengeId,
          aiWorkflowIds,
          submissionId,
        );

        if (!submissionComplete) {
          this.logger.debug(
            `[publishAiWorkflowPhaseCompletedEvent] Not all AI workflows complete for submission ${submissionId} in challenge ${challengeId}`,
          );
          return;
        }
      } else {
        // For non-F2F challenges, wait for all AI workflows to complete
        const allComplete = await this.areAllAiWorkflowsComplete(
          challengeId,
          aiWorkflowIds,
        );

        if (!allComplete) {
          this.logger.debug(
            `[publishAiWorkflowPhaseCompletedEvent] Not all AI workflows complete for challenge ${challengeId}`,
          );
          return;
        }
      }

      // Get the most recent completed workflow run for this submission to use as representative data
      const recentWorkflowRun = await this.prisma.aiWorkflowRun.findFirst({
        where: {
          submissionId,
          status: { in: ['SUCCESS', 'FAILURE', 'CANCELLED'] },
        },
        orderBy: {
          completedAt: 'desc',
        },
        select: {
          id: true,
          workflowId: true,
          status: true,
          score: true,
          completedAt: true,
        },
      });

      if (!recentWorkflowRun) {
        this.logger.warn(
          `[publishAiWorkflowPhaseCompletedEvent] No completed workflow run found for submission ${submissionId}`,
        );
        return;
      }

      const payload = {
        challengeId,
        submissionId,
        aiWorkflowRunId: recentWorkflowRun.id,
        aiWorkflowId: recentWorkflowRun.workflowId,
        status: recentWorkflowRun.status,
        score: recentWorkflowRun.score ?? 0,
        completedAt: recentWorkflowRun.completedAt
          ? recentWorkflowRun.completedAt.toISOString()
          : new Date().toISOString(),
      };

      await this.eventBusService.publish(
        'aiworkflow.action.completed',
        payload,
      );
      this.logger.log(
        `[publishAiWorkflowPhaseCompletedEvent] Published AI workflow completion for challenge ${challengeId}, submission ${submissionId}${isF2F ? ' (F2F)' : ', all AI workflows completed'}`,
      );
    } catch (error) {
      this.logger.error(
        `[publishAiWorkflowPhaseCompletedEvent] Failed to publish AI workflow phase completion event for challenge ${challengeId}`,
        error,
      );
      // Don't throw - this is a non-critical notification
    }
  }

  private getPhaseSortTime(phase: PhaseData): number {
    const timestamp = new Date(
      phase.actualStartTime ?? phase.scheduledStartTime ?? '',
    ).getTime();

    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  private isFirst2FinishChallenge(typeName?: string): boolean {
    const normalized = (typeName ?? '').trim().toLowerCase();
    return normalized === 'first2finish' || normalized === 'first 2 finish';
  }
}
