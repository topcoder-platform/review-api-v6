import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { GiteaService } from './gitea.service';
import { PrismaService } from './prisma.service';
import { QueueSchedulerService } from './queue-scheduler.service';
import { Job } from 'pg-boss';
import { aiWorkflowRun } from '@prisma/client';

@Injectable()
export class WorkflowQueueHandler implements OnModuleInit {
  private readonly logger: Logger = new Logger(WorkflowQueueHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduler: QueueSchedulerService,
    private readonly giteaService: GiteaService,
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

    // return not-resolved promise,
    // this will put a pause on the job
    // until it is marked as completed via webhook call
    return new Promise<void>((resolve, reject) => {
      this.scheduler.registerJobHandler(
        job.id,
        (resolution: string = 'complete', result: any) => {
          (resolution === 'fail' ? reject : resolve)(result);
        },
      );
    });
  }

  async handleWorkflowRunEvents(event: {
    action: 'queued' | 'waiting' | 'in_progress' | 'completed';
    workflow_job: {
      id: number;
      run_id: string;
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

    let [aiWorkflowRun]: (aiWorkflowRun | null)[] = aiWorkflowRuns;

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

        if (conclusion === 'FAILURE') {
          await this.scheduler.completeJob(
            (aiWorkflowRun as any).workflow.gitWorkflowId,
            aiWorkflowRun.scheduledJobId as string,
            'fail',
          );

          this.logger.log({
            message: 'Workflow job failed. Calling retry.',
            aiWorkflowRunId: aiWorkflowRun.id,
            gitRunId: event.workflow_job.run_id,
            jobId: event.workflow_job.id,
            status: conclusion,
            timestamp: new Date().toISOString(),
          });
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
        await this.scheduler.completeJob(
          (aiWorkflowRun as any).workflow.gitWorkflowId,
          aiWorkflowRun.scheduledJobId as string,
        );

        this.logger.log({
          message: 'Workflow job completed',
          aiWorkflowRunId: aiWorkflowRun.id,
          gitRunId: event.workflow_job.run_id,
          jobId: event.workflow_job.id,
          status: conclusion,
          timestamp: new Date().toISOString(),
        });
        break;
      default:
        break;
    }
  }
}
