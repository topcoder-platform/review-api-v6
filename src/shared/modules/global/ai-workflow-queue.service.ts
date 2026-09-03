import { Injectable, Logger } from '@nestjs/common';
import { SubmissionBaseService } from './submission-base.service';
import { ChallengeApiService } from './challenge.service';
import { WorkflowQueueHandler } from './workflow-queue.handler';
import { PrismaService } from './prisma.service';

/** Phases whose opening allows AI workflows to be dispatched for a submission. */
const AI_PHASE_NAMES = ['AI Screening', 'AI Review'];

export interface QueueWorkflowsOptions {
  /** The AI phase is known to have just opened (event-driven dispatch). */
  aiPhaseOpened?: boolean;
  /**
   * Look up whether an AI phase is currently open before deciding to skip.
   * Used by flows (e.g. virus scan completion) that can happen after the AI
   * phase already opened, which would otherwise never get queued.
   */
  detectAiPhaseOpened?: boolean;
}

@Injectable()
export class AiWorkflowQueueService {
  private readonly logger = new Logger(AiWorkflowQueueService.name);

  constructor(
    private readonly submissionBaseService: SubmissionBaseService,
    private readonly challengeApiService: ChallengeApiService,
    private readonly workflowQueueHandler: WorkflowQueueHandler,
    private readonly prisma: PrismaService,
  ) {}

  async queueWorkflowsForSubmission(
    submissionId: string,
    options?: QueueWorkflowsOptions,
  ): Promise<void> {
    this.logger.log(`Queueing AI workflows for submission ${submissionId}`);

    const submission = await this.submissionBaseService.getSubmissionById(
      submissionId,
    );
    const challengeId = String(submission.challengeId ?? '').trim();
    if (!challengeId) {
      this.logger.warn(
        `Skipping AI workflow queueing because submission ${submissionId} is missing challengeId.`,
      );
      return;
    }

    const workflowIds = await this.resolveWorkflowIdsForChallenge(
      challengeId,
      options,
    );
    if (!workflowIds.length) {
      this.logger.log(
        `No AI workflows configured for challenge ${challengeId}; skipping queueing for submission ${submissionId}.`,
      );
      return;
    }

    await this.workflowQueueHandler.queueWorkflowRuns(
      workflowIds.map((id) => ({ id })),
      challengeId,
      submissionId,
    );
  }

  private async resolveWorkflowIdsForChallenge(
    challengeId: string,
    options?: QueueWorkflowsOptions,
  ): Promise<string[]> {
    const configured = await this.getConfiguredAiWorkflowIds(challengeId);
    if (configured) {
      if (configured.templateDisabled) {
        return [];
      }

      if (!configured.workflowIds.length) {
        return [];
      }

      if (
        configured.instantReviewEnabled ||
        (await this.isAiPhaseOpened(challengeId, options))
      ) {
        return configured.workflowIds;
      }

      return [];
    }

    const challenge = await this.challengeApiService.getChallengeDetail(
      challengeId,
    );

    return Array.from(
      new Set(
        (challenge.workflows ?? [])
          .map((workflow) => workflow?.id)
          .filter((workflowId): workflowId is string => Boolean(workflowId)),
      ),
    );
  }

  private async isAiPhaseOpened(
    challengeId: string,
    options?: QueueWorkflowsOptions,
  ): Promise<boolean> {
    if (options?.aiPhaseOpened) {
      return true;
    }

    if (!options?.detectAiPhaseOpened) {
      return false;
    }

    try {
      const isOpen = await this.challengeApiService.isPhaseOpen(
        challengeId,
        AI_PHASE_NAMES,
      );
      this.logger.log(
        `AI phase is ${isOpen ? 'open' : 'not open'} for challenge ${challengeId}.`,
      );
      return isOpen;
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Failed to determine AI phase open state for challenge ${challengeId}: ${err.message}`,
        err.stack,
      );
      return false;
    }
  }

  private async getConfiguredAiWorkflowIds(
    challengeId: string,
  ): Promise<
    | {
        instantReviewEnabled: boolean;
        templateDisabled: boolean;
        workflowIds: string[];
      }
    | null
  > {
    if (!challengeId) {
      return null;
    }

    const config = await this.prisma.aiReviewConfig.findFirst({
      where: { challengeId },
      orderBy: { version: 'desc' },
      select: {
        template: {
          select: {
            disabled: true,
          },
        },
        instantReview: true,
        workflows: {
          where: {
            workflow: {
              disabled: false,
            },
          },
          select: { workflowId: true },
        },
      },
    });

    if (!config) {
      return null;
    }

    const workflowIds = Array.from(
      new Set(
        (config.workflows ?? [])
          .map((workflow: { workflowId?: unknown }) =>
            typeof workflow.workflowId === 'string'
              ? workflow.workflowId
              : undefined,
          )
          .filter((workflowId): workflowId is string => Boolean(workflowId)),
      ),
    );

    return {
      instantReviewEnabled: config.instantReview === true,
      templateDisabled: !!config.template?.disabled,
      workflowIds,
    };
  }
}
