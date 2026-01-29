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

// A helper to generate a 32-bit integer hash from a string
function stringToHash(string: string): number {
  let hash = 0;
  if (string.length === 0) return hash;
  for (let i = 0; i < string.length; i++) {
    const char = string.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
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
    private readonly membersPrisma: MemberPrismaService,
    private readonly scheduler: QueueSchedulerService,
    private readonly giteaService: GiteaService,
    private readonly eventBusService: EventBusService,
  ) {}

  async onModuleInit() {
    const queues = (
      await this.prisma.aiWorkflow.groupBy({
        by: ['gitWorkflowId'],
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
        data: aiWorkflows.map((workflow) => ({
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
}
