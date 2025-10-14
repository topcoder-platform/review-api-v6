import { Injectable, Logger } from '@nestjs/common';
import { SubmissionBaseService } from './submission-base.service';
import { ChallengeApiService, ChallengeData } from './challenge.service';
import { SubmissionResponseDto } from 'src/dto/submission.dto';
import { WorkflowQueueHandler } from './workflow-queue.handler';

/**
 * Orchestrator for handling submission scan completion events.
 * This service coordinates the actions to be taken when a submission scan is complete.
 */
@Injectable()
export class SubmissionScanCompleteOrchestrator {
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
    private readonly submissionBaseService: SubmissionBaseService,
    private readonly challengeApiService: ChallengeApiService,
    private readonly workflowQueueHandler: WorkflowQueueHandler,
  ) {}

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

      await this.workflowQueueHandler.queueWorkflowRuns(
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
}
