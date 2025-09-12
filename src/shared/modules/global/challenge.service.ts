import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { plainToInstance } from 'class-transformer';
import { validateOrReject } from 'class-validator';
import { AxiosError } from 'axios';
import { M2MService } from './m2m.service';
import { Injectable, Logger } from '@nestjs/common';
import { CommonConfig } from 'src/shared/config/common.config';
import { ChallengeStatus } from 'src/shared/enums/challengeStatus.enum';

export class PhaseData {
  id: string;
  name: string;
  isOpen: boolean;
  scheduledStartTime?: string;
  scheduledEndTime?: string;
  actualStartTime?: string;
  actualEndTime?: string;
}

export class ChallengeData {
  id: string;
  name: string;
  legacy?: {
    track?: string | undefined;
    subTrack?: string | undefined;
  };
  status: ChallengeStatus;
  numOfSubmissions?: number | undefined;
  track: string;
  legacyId: number;
  tags?: string[] | undefined;
  workflows?: WorkflowData[] | undefined;
  phases?: PhaseData[] | undefined;
}

export class WorkflowData {
  workflowId: string;
  ref: string;
  params: Record<string, any>;
}

@Injectable()
export class ChallengeApiService {
  private readonly logger: Logger = new Logger(ChallengeApiService.name);

  constructor(
    private readonly m2mService: M2MService,
    private readonly httpService: HttpService,
  ) {}

  async getChallenges(challengeIds: string[]): Promise<ChallengeData[]> {
    // Get all challenge details at once.
    const results = await Promise.all(
      challengeIds.map((id) => this.getChallengeDetail(id)),
    );
    return results;
  }

  async getChallengeDetail(challengeId: string): Promise<ChallengeData> {
    // Get M2m token
    const token = await this.m2mService.getM2MToken();
    // Send request to challenge api
    const url = CommonConfig.apis.challengeApiUrl + challengeId;

    try {
      const response = await firstValueFrom(
        this.httpService.get<ChallengeData>(url, {
          headers: {
            Authorization: 'Bearer ' + token,
          },
        }),
      );
      const challenge = plainToInstance(ChallengeData, response.data);
      await validateOrReject(challenge);
      return challenge;
    } catch (e) {
      if (e instanceof AxiosError) {
        this.logger.error(`Http Error: ${e.message}`, e.response?.data);
        throw new Error('Cannot get data from Challenge API.');
      }
      this.logger.error(`Data validation error: ${e}`);
      throw new Error('Malformed data returned from Challenge API');
    }
  }

  /**
   * Check if a specific phase is currently open for a challenge
   */
  async isPhaseOpen(challengeId: string, phaseName: string): Promise<boolean> {
    try {
      const challenge = await this.getChallengeDetail(challengeId);

      if (!challenge.phases) {
        this.logger.warn(`No phases found for challenge ${challengeId}`);
        return false;
      }

      const phase = challenge.phases.find((p) => p.name === phaseName);
      if (!phase) {
        this.logger.warn(
          `Phase '${phaseName}' not found for challenge ${challengeId}`,
        );
        return false;
      }

      return phase.isOpen;
    } catch (error) {
      this.logger.error(
        `Error checking phase status for challenge ${challengeId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Validate if reviews can be submitted (Review or Iterative Review phase is open)
   */
  async validateReviewSubmission(challengeId: string): Promise<void> {
    const reviewPhaseOpen = await this.isPhaseOpen(challengeId, 'Review');
    const iterativeReviewPhaseOpen = await this.isPhaseOpen(
      challengeId,
      'Iterative Review',
    );

    if (!reviewPhaseOpen && !iterativeReviewPhaseOpen) {
      throw new Error(
        `Reviews cannot be submitted for challenge ${challengeId}. Neither Review nor Iterative Review phase is currently open.`,
      );
    }
  }

  /**
   * Validate if appeals can be submitted (Appeals phase is open)
   */
  async validateAppealSubmission(challengeId: string): Promise<void> {
    const appealsPhaseOpen = await this.isPhaseOpen(challengeId, 'Appeals');

    if (!appealsPhaseOpen) {
      throw new Error(
        `Appeals cannot be submitted for challenge ${challengeId}. Appeals phase is not currently open.`,
      );
    }
  }

  /**
   * Validate if appeal responses can be submitted (Appeals Response phase is open)
   */
  async validateAppealResponseSubmission(challengeId: string): Promise<void> {
    const appealsResponsePhaseOpen = await this.isPhaseOpen(
      challengeId,
      'Appeals Response',
    );

    if (!appealsResponsePhaseOpen) {
      throw new Error(
        `Appeal responses cannot be submitted for challenge ${challengeId}. Appeals Response phase is not currently open.`,
      );
    }
  }

  /**
   * Validate if submissions can be created (Submission phase is open)
   */
  async validateSubmissionCreation(challengeId: string): Promise<void> {
    const submissionPhaseOpen = await this.isPhaseOpen(
      challengeId,
      'Submission',
    );

    if (!submissionPhaseOpen) {
      throw new Error(
        `Submissions cannot be created for challenge ${challengeId}. Submission phase is not currently open.`,
      );
    }
  }

  /**
   * Validate if a challenge exists and is active
   */
  async validateChallengeExists(challengeId: string): Promise<ChallengeData> {
    try {
      const challenge = await this.getChallengeDetail(challengeId);

      // Basic validation that challenge exists
      if (!challenge || !challenge.id) {
        throw new Error(`Challenge ${challengeId} not found or is invalid.`);
      }

      return challenge;
    } catch (error) {
      this.logger.error(`Error validating challenge ${challengeId}:`, error);
      throw new Error(`Challenge ${challengeId} not found or is invalid.`);
    }
  }

  /**
   * Validate if checkpoint submissions can be created (Checkpoint Submission phase is open)
   */
  async validateCheckpointSubmissionCreation(
    challengeId: string,
  ): Promise<void> {
    const checkpointSubmissionPhaseOpen = await this.isPhaseOpen(
      challengeId,
      'Checkpoint Submission',
    );

    if (!checkpointSubmissionPhaseOpen) {
      throw new Error(
        `Checkpoint submissions cannot be created for challenge ${challengeId}. Checkpoint Submission phase is not currently open.`,
      );
    }
  }
}
