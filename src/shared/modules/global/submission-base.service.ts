import { Injectable, Logger } from '@nestjs/common';
import { SubmissionService } from 'src/api/submission/submission.service';
import { SubmissionResponseDto } from 'src/dto/submission.dto';

/**
 * Service to handle submission-related operations.
 * This service provides methods to create, list, and retrieve submissions.
 */
@Injectable()
export class SubmissionBaseService {
  private readonly logger: Logger = new Logger(SubmissionBaseService.name);

  /**
   * Initializes the SubmissionBaseService with the SubmissionService.
   *
   * @param submissionService - The service to handle submission operations.
   */
  constructor(private readonly submissionService: SubmissionService) {}

  /**
   * Fetches a submission by its ID.
   *
   * @param submissionId - The ID of the submission to fetch.
   * @returns A promise that resolves to the submission details.
   * @throws NotFoundException if the submission is not found.
   * @throws Error if there is an issue fetching the submission.
   */
  async getSubmissionById(
    submissionId: string,
  ): Promise<SubmissionResponseDto> {
    this.logger.log(`Fetching submission with ID: ${submissionId}`);
    try {
      return await this.submissionService.getSubmission(submissionId);
    } catch (error) {
      this.logger.error(
        `Error fetching submission with ID ${submissionId}`,
        error,
      );
      throw error;
    }
  }
}
