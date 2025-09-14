import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../shared/modules/global/logger.service';
import { ChallengeApiService } from '../../shared/modules/global/challenge.service';
import { ProjectResultResponseDto } from '../../dto/projectResult.dto';

@Injectable()
export class ProjectResultService {
  private readonly logger: LoggerService;

  constructor(private readonly challengeApiService: ChallengeApiService) {
    this.logger = LoggerService.forRoot('ProjectResultService');
  }

  async getProjectResultsFromChallenge(
    challengeId: string,
  ): Promise<ProjectResultResponseDto[]> {
    this.logger.log(`Fetching challenge details for ${challengeId}`);

    const challenge =
      await this.challengeApiService.getChallengeDetail(challengeId);

    if (!challenge || !challenge.id) {
      this.logger.warn(`Challenge ${challengeId} not found`);
      return [];
    }

    const results: ProjectResultResponseDto[] = [];

    if (challenge['winners'] && Array.isArray(challenge['winners'])) {
      for (const winner of challenge['winners']) {
        const result: ProjectResultResponseDto = {
          challengeId: challenge.id,
          userId: winner.userId?.toString() || winner.handle || 'unknown',
          submissionId: `submission-${winner.userId}-${challenge.id}`,
          initialScore: 100 - (winner.placement - 1) * 10,
          finalScore: 100 - (winner.placement - 1) * 10,
          placement: winner.placement,
          rated: false,
          passedReview: true,
          validSubmission: true,
          createdAt: new Date(challenge['created'] || new Date()),
          createdBy: challenge['createdBy'] || 'system',
          updatedAt: new Date(challenge['updated'] || new Date()),
          updatedBy: challenge['updatedBy'] || 'system',
          reviews: [],
        };

        results.push(result);
      }
    }

    this.logger.log(
      `Found ${results.length} results for challenge ${challengeId}`,
    );
    return results;
  }
}
