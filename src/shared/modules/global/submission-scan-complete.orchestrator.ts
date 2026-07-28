import { Injectable, Logger } from '@nestjs/common';
import { AiWorkflowQueueService } from './ai-workflow-queue.service';

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

  constructor(
    private readonly aiWorkflowQueueService: AiWorkflowQueueService,
  ) {}

  async orchestrateScanComplete(submissionId: string): Promise<void> {
    this.logger.log(
      `Orchestrating scan complete for submission ID: ${submissionId}`,
    );

    try {
      await this.aiWorkflowQueueService.queueWorkflowsForSubmission(
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
}
