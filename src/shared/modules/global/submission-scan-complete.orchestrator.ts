import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SubmissionBaseService } from './submission-base.service';
import { ChallengeApiService, ChallengeData } from './challenge.service';
import { GiteaService } from './gitea.service';
import { SubmissionResponseDto } from 'src/dto/submission.dto';
import { PrismaService } from './prisma.service';
import { QueueSchedulerService } from './queue-scheduler.service';
import { Job } from 'pg-boss';

/**
 * Orchestrator for handling submission scan completion events.
 * This service coordinates the actions to be taken when a submission scan is complete.
 */
@Injectable()
export class SubmissionScanCompleteOrchestrator implements OnModuleInit {
  private readonly logger: Logger = new Logger(
    SubmissionScanCompleteOrchestrator.name,
  );

  /**
   * Orchestrates the actions to be taken when a submission scan is complete.
   * It fetches the submission details, retrieves challenge information,
   * and checks or creates a repository in Gitea.
   *
   * @param submissionBaseService - Service to fetch submission details.
   * @param challengeApiService - Service to fetch challenge details.
   * @param giteaService - Service to interact with Gitea.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduler: QueueSchedulerService,
    private readonly submissionBaseService: SubmissionBaseService,
    private readonly challengeApiService: ChallengeApiService,
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

  async orchestrateScanComplete(submissionId: string): Promise<void> {
    this.logger.log(
      `Orchestrating scan complete for submission ID: ${submissionId}`,
    );
    try {
      const submission: SubmissionResponseDto =
        await this.submissionBaseService.getSubmissionById(submissionId);
      this.logger.log(`Submission details: ${JSON.stringify(submission)}`);

      const challenge: ChallengeData =
        await this.challengeApiService.getChallengeDetail(
          submission.challengeId!,
        );
      this.logger.log(`Challenge details: ${JSON.stringify(challenge)}`);

      if (!Array.isArray(challenge?.workflows)) {
        // no ai workflow defined for challenge, return
        return;
      }

      await this.queueWorkflowRuns(
        challenge.workflows,
        challenge.id,
        submissionId,
      );
    } catch (error) {
      this.logger.error(
        `Error orchestrating scan complete for submission ID ${submissionId}`,
        error,
      );
      throw error;
    }
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
          status: 'QUEUED',
          gitRunId: '',
        })),
        include: {
          workflow: { select: { gitWorkflowId: true } },
        },
      });

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
      },
    });

    // return not-resolved promise,
    // this will put a pause on the job
    // until it is marked as completed via webhook call
    return new Promise<void>((resolve) => {
      this.scheduler.trackTask(job.id, () => resolve());
    });
  }
}
