import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/modules/global/prisma.service';
import { LoggerService } from '../../shared/modules/global/logger.service';
import { PrismaErrorService } from '../../shared/modules/global/prisma-error.service';
import {
  WebhookEventDto,
  WebhookResponseDto,
} from '../../dto/webhook-event.dto';
import { QueueSchedulerService } from 'src/shared/modules/global/queue-scheduler.service';
import { GiteaService } from 'src/shared/modules/global/gitea.service';
import { aiWorkflowRun } from '@prisma/client';

@Injectable()
export class WebhookService {
  private readonly logger = LoggerService.forRoot('WebhookService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaErrorService: PrismaErrorService,
    private readonly scheduler: QueueSchedulerService,
    private readonly giteaService: GiteaService,
  ) {}

  async processWebhook(
    webhookEvent: WebhookEventDto,
  ): Promise<WebhookResponseDto> {
    try {
      this.logger.log({
        message: 'Processing GitHub webhook event',
        eventId: webhookEvent.eventId,
        event: webhookEvent.event,
        timestamp: new Date().toISOString(),
      });

      // Store webhook event in database
      const storedEvent = await this.prisma.gitWebhookLog.create({
        data: {
          eventId: webhookEvent.eventId,
          event: webhookEvent.event,
          eventPayload: webhookEvent.eventPayload,
        },
      });

      this.logger.log({
        message: 'Successfully stored webhook event',
        eventId: webhookEvent.eventId,
        event: webhookEvent.event,
        storedId: storedEvent.id,
        createdAt: storedEvent.createdAt,
      });

      // Future extensibility: Add event-specific handlers here
      await this.handleEventSpecificProcessing(
        webhookEvent.event,
        webhookEvent.eventPayload,
      );

      return {
        success: true,
        message: 'Webhook processed successfully',
      };
    } catch (error) {
      this.logger.error({
        message: 'Failed to process webhook event',
        eventId: webhookEvent.eventId,
        event: webhookEvent.event,
        error: error.message,
        stack: error.stack,
      });

      // Handle Prisma errors with the existing error service
      if (error.code) {
        this.prismaErrorService.handleError(error);
      }

      throw error;
    }
  }

  /**
   * Placeholder for future event-specific processing logic
   * This method can be extended to handle different GitHub events differently
   */
  private async handleEventSpecificProcessing(
    event: string,
    payload: any,
  ): Promise<void> {
    this.logger.log({
      message: 'Event-specific processing placeholder',
      event,
      payloadSize: JSON.stringify(payload).length,
    });

    // Future implementation examples:
    switch (event) {
      case 'workflow_job':
        await this.handleWorkflowEvents(event, payload);
        break;
      // case 'push':
      //   await this.handlePushEvent(payload);
      //   break;
      // case 'pull_request':
      //   await this.handlePullRequestEvent(payload);
      //   break;
      // case 'issues':
      //   await this.handleIssuesEvent(payload);
      //   break;
      default:
        this.logger.log(`No specific handler for event type: ${event}`);
    }
  }

  /**
   * Get webhook logs with pagination and filtering
   * This method provides basic querying capabilities for webhook events
   */
  async getWebhookLogs(options: {
    eventId?: string;
    event?: string;
    limit?: number;
    offset?: number;
    startDate?: Date;
    endDate?: Date;
  }) {
    try {
      const {
        eventId,
        event,
        limit = 50,
        offset = 0,
        startDate,
        endDate,
      } = options;

      const where: any = {};

      if (eventId) {
        where.eventId = eventId;
      }

      if (event) {
        where.event = event;
      }

      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) {
          where.createdAt.gte = startDate;
        }
        if (endDate) {
          where.createdAt.lte = endDate;
        }
      }

      const [logs, total] = await this.prisma.$transaction([
        this.prisma.gitWebhookLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        this.prisma.gitWebhookLog.count({ where }),
      ]);

      return {
        logs,
        total,
        limit,
        offset,
      };
    } catch (error) {
      this.logger.error({
        message: 'Failed to retrieve webhook logs',
        error: error.message,
        options,
      });

      if (error.code) {
        this.prismaErrorService.handleError(error);
      }

      throw error;
    }
  }

  async handleWorkflowEvents(event: string, payload: any) {
    const aiWorkflowRuns = await this.prisma.aiWorkflowRun.findMany({
      where: {
        status: { in: ['DISPATCHED', 'IN_PROGRESS'] },
        gitRunId: `${payload.workflow_job.run_id}`,
      },
      include: {
        workflow: true,
      },
    });

    if (aiWorkflowRuns.length > 1) {
      this.logger.error(
        `ERROR! There are more than 1 workflow runs in DISPATCHED status and workflow.gitWorkflowId=${payload.workflow_job.name}!`,
      );
      return;
    }

    let [aiWorkflowRun]: (aiWorkflowRun | null)[] = aiWorkflowRuns;

    if (
      !aiWorkflowRun &&
      payload.action === 'in_progress' &&
      payload.workflow_job.name === 'dump-workflow-context'
    ) {
      const [owner, repo] = payload.repository.full_name.split('/');
      const { aiWorkflowRunId, jobsCount } =
        (await this.giteaService.getAiWorkflowDataFromLogs(
          owner,
          repo,
          payload.workflow_job.id as number,
        )) ?? ({} as any);

      if (!aiWorkflowRunId) {
        this.logger.error(
          `Failed to find workflow run ID from logs for job with id ${payload.workflow_job.id}`,
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
          gitRunId: `${payload.workflow_job.run_id}`,
          jobsCount,
          completedJobs: { increment: 1 },
        },
      });

      this.logger.log({
        message: 'Updated aiWorkflowRun with gitRunId after lookup',
        aiWorkflowRunId,
        gitRunId: payload.workflow_job.run_id,
        jobId: payload.workflow_job.id,
      });
    }

    if (!aiWorkflowRun) {
      this.logger.error({
        message: 'No matching aiWorkflowRun found for workflow_job event',
        event,
        workflowJobId: payload.workflow_job.id,
        gitRunId: payload.workflow_job.run_id,
        gitJobStatus: payload.action,
      });

      return;
    }

    if (payload.workflow_job.name === 'dump-workflow-context') {
      // no further processing needed, this job is meant to sync our db run with the git run
      return;
    }

    switch (payload.action) {
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
          gitRunId: payload.workflow_job.run_id,
          jobId: payload.workflow_job.id,
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
            status: payload.workflow_job.conclusion.toUpperCase(),
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
          gitRunId: payload.workflow_job.run_id,
          jobId: payload.workflow_job.id,
          status: payload.workflow_job.conclusion.toUpperCase(),
          timestamp: new Date().toISOString(),
        });
        break;
      default:
        break;
    }
  }
}
