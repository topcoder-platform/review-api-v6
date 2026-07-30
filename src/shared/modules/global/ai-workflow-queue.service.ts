import { Injectable, Logger } from '@nestjs/common';
import { SubmissionBaseService } from './submission-base.service';
import { ChallengeApiService } from './challenge.service';
import { WorkflowQueueHandler } from './workflow-queue.handler';
import { PrismaService } from './prisma.service';

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
    options?: { aiPhaseOpened?: boolean },
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
    options?: { aiPhaseOpened?: boolean },
  ): Promise<string[]> {
    const configured = await this.getConfiguredAiWorkflowIds(challengeId);
    if (configured) {
      if (configured.templateDisabled) {
        return [];
      }

      if (configured.instantReviewEnabled || options?.aiPhaseOpened) {
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
