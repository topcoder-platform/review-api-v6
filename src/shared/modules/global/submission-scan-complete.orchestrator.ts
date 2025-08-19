import { Injectable, Logger } from '@nestjs/common';
import { SubmissionBaseService } from './submission-base.service';
import { ChallengeApiService, ChallengeData } from './challenge.service';
import { GiteaService } from './gitea.service';
import { SubmissionResponseDto } from 'src/dto/submission.dto';

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
    private readonly giteaService: GiteaService,
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

      await this.giteaService.checkAndCreateRepository(challenge.id);
      this.logger.log(`Retrieved or created repository`);

      // iterate available workflows for the challenge
      if (Array.isArray(challenge?.workflows)) {
        let allErrors = '';
        for (const workflow of challenge.workflows) {
          try {
            await this.giteaService.runDispatchWorkflow(workflow, challenge.id);
          } catch (error) {
            const errorMessage = `Error processing workflow: ${workflow.workflowId}. Error: ${error.message}.`;
            this.logger.error(errorMessage, error);
            // don't rethrow error as we want to continue processing other workflows
            allErrors += `${errorMessage}. `;
          }
        }
        if (allErrors !== '') {
          this.logger.error(
            `Errors occurred while processing workflows: ${allErrors}`,
          );
          throw new Error(allErrors);
        } else {
          this.logger.log('All workflows processed successfully.');
        }
      }
    } catch (error) {
      this.logger.error(
        `Error orchestrating scan complete for submission ID ${submissionId}`,
        error,
      );
      throw error;
    }
  }
}
