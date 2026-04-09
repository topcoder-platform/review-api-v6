import { Injectable, Logger } from '@nestjs/common';
import { SubmissionBaseService } from './submission-base.service';
import { ChallengeApiService } from './challenge.service';
import { SubmissionResponseDto } from 'src/dto/submission.dto';
import { WorkflowQueueHandler } from './workflow-queue.handler';
import { PrismaService } from './prisma.service';

/**
 * Orchestrator for handling submission scan completion events.
 * This service coordinates the AI workflow queueing that should happen once a
 * submission clears malware scanning.
 */
@Injectable()
export class SubmissionScanCompleteOrchestrator {
  private readonly logger: Logger = new Logger(
    SubmissionScanCompleteOrchestrator.name,
  );

  /**
   * Orchestrates the actions to be taken when a submission scan is complete.
   * It fetches the submission details, resolves the workflows that should run
   * for the challenge, and queues them for execution.
   *
   * @param submissionBaseService - Service to fetch submission details.
   * @param challengeApiService - Service to fetch challenge details for legacy workflow fallback.
   * @param workflowQueueHandler - Service that persists and schedules workflow runs.
   * @param prisma - Review database service used to resolve the active AI review config.
   */
  constructor(
    private readonly submissionBaseService: SubmissionBaseService,
    private readonly challengeApiService: ChallengeApiService,
    private readonly workflowQueueHandler: WorkflowQueueHandler,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Determine whether the challenge has AI workflows configured via the active
   * AI review config.
   *
   * @param challengeId - Challenge identifier associated with the submission.
   * @returns True when the active AI review config defines at least one workflow.
   */
  async hasConfiguredAiReviewWorkflows(challengeId: string): Promise<boolean> {
    const workflowIds = await this.getConfiguredAiWorkflowIds(challengeId);
    return workflowIds.length > 0;
  }

  async orchestrateScanComplete(submissionId: string): Promise<void> {
    this.logger.log(
      `Orchestrating scan complete for submission ID: ${submissionId}`,
    );
    try {
      const submission: SubmissionResponseDto =
        await this.submissionBaseService.getSubmissionById(submissionId);
      this.logger.log(`Submission details: ${JSON.stringify(submission)}`);

      const challengeId = String(submission.challengeId ?? '').trim();
      if (!challengeId) {
        this.logger.warn(
          `Skipping AI workflow queueing because submission ${submissionId} is missing challengeId.`,
        );
        return;
      }

      const workflowIds = await this.getWorkflowIdsForScanComplete(challengeId);
      if (!workflowIds.length) {
        // no ai workflow defined for challenge, return
        return;
      }

      await this.workflowQueueHandler.queueWorkflowRuns(
        workflowIds.map((id) => ({ id })),
        challengeId,
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

  /**
   * Resolve the workflow ids that should run after a clean scan completes.
   * AI review config is the primary source of truth, with challenge-linked
   * workflows preserved as a fallback for legacy flows.
   *
   * @param challengeId - Challenge identifier associated with the submission.
   * @returns Workflow ids that should be queued for the submission.
   */
  private async getWorkflowIdsForScanComplete(
    challengeId: string,
  ): Promise<string[]> {
    const configuredWorkflowIds =
      await this.getConfiguredAiWorkflowIds(challengeId);
    if (configuredWorkflowIds.length) {
      return configuredWorkflowIds;
    }

    const challenge =
      await this.challengeApiService.getChallengeDetail(challengeId);
    this.logger.log(`Challenge details: ${JSON.stringify(challenge)}`);

    return Array.from(
      new Set(
        (challenge.workflows ?? [])
          .map((workflow) => workflow.id)
          .filter((workflowId): workflowId is string => Boolean(workflowId)),
      ),
    );
  }

  /**
   * Resolve workflow ids from the latest AI review config for a challenge.
   *
   * @param challengeId - Challenge identifier associated with the submission.
   * @returns Workflow ids declared on the active AI review config.
   */
  private async getConfiguredAiWorkflowIds(
    challengeId: string,
  ): Promise<string[]> {
    if (!challengeId) {
      return [];
    }

    const config = await this.prisma.aiReviewConfig.findFirst({
      where: { challengeId },
      orderBy: { version: 'desc' },
      select: {
        workflows: {
          select: { workflowId: true },
        },
      },
    });

    return Array.from(
      new Set(
        (config?.workflows ?? [])
          .map((workflow) => workflow.workflowId)
          .filter((workflowId): workflowId is string => Boolean(workflowId)),
      ),
    );
  }
}
