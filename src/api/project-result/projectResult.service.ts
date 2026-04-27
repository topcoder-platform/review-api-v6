import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../shared/modules/global/logger.service';
import { ChallengeApiService } from '../../shared/modules/global/challenge.service';
import { PrismaService } from '../../shared/modules/global/prisma.service';
import { ProjectResultResponseDto } from '../../dto/projectResult.dto';
import { JwtUser } from 'src/shared/modules/global/jwt.service';

@Injectable()
export class ProjectResultService {
  private readonly logger: LoggerService;

  constructor(
    private readonly challengeApiService: ChallengeApiService,
    private readonly prisma: PrismaService,
  ) {
    this.logger = LoggerService.forRoot('ProjectResultService');
  }

  /**
   * Load project results from challenge winners after applying challenge
   * whitelist access for interactive callers.
   *
   * @param authUser - The authenticated request user.
   * @param challengeId - Challenge id whose results should be returned.
   * @returns Project result rows visible to the caller.
   */
  async getProjectResultsFromChallenge(
    authUser: JwtUser,
    challengeId: string,
  ): Promise<ProjectResultResponseDto[]> {
    this.logger.log(`Fetching challenge details for ${challengeId}`);

    const challenge = await this.challengeApiService.getChallengeDetailForUser(
      authUser,
      challengeId,
    );

    if (!challenge || !challenge.id) {
      this.logger.warn(`Challenge ${challengeId} not found`);
      return [];
    }

    const results: ProjectResultResponseDto[] = [];

    const auditCreatedAt = challenge.createdAt ?? new Date();
    const auditUpdatedAt = challenge.updatedAt ?? auditCreatedAt;

    for (const winner of challenge.winners ?? []) {
      const winnerUserId =
        winner.userId !== undefined && winner.userId !== null
          ? winner.userId.toString()
          : winner.handle || 'unknown';

      // Query the submission table to find the actual submission ID
      const submission = await this.prisma.submission.findFirst({
        where: {
          memberId: winnerUserId,
          challengeId: challenge.id,
        },
        select: {
          id: true,
        },
      });

      // Query reviews for initial and final scores if submission exists
      let initialScore = 0;
      let finalScore = 0;
      if (submission) {
        const reviews = await this.prisma.review.findMany({
          where: {
            submissionId: submission.id,
          },
          select: {
            initialScore: true,
            finalScore: true,
          },
        });

        // Calculate aggregate scores from all reviews
        if (reviews.length > 0) {
          const validInitialScores = reviews
            .map((r) => r.initialScore)
            .filter((score): score is number => score !== null);
          const validFinalScores = reviews
            .map((r) => r.finalScore)
            .filter((score): score is number => score !== null);

          initialScore =
            validInitialScores.length > 0
              ? validInitialScores.reduce((sum, score) => sum + score, 0) /
                validInitialScores.length
              : 0;
          finalScore =
            validFinalScores.length > 0
              ? validFinalScores.reduce((sum, score) => sum + score, 0) /
                validFinalScores.length
              : initialScore; // Use initial score as fallback if no final scores
        }
      }

      const result: ProjectResultResponseDto = {
        challengeId: challenge.id,
        userId: winnerUserId,
        initialScore,
        finalScore,
        placement: winner.placement,
        rated: false,
        passedReview: true,
        validSubmission: true,
        createdAt: auditCreatedAt,
        createdBy: challenge.createdBy || 'system',
        updatedAt: auditUpdatedAt,
        updatedBy: challenge.updatedBy || 'system',
        reviews: [],
      };

      // Only include submissionId if we found a submission
      if (submission) {
        result.submissionId = submission.id;
      }

      results.push(result);
    }

    this.logger.log(
      `Found ${results.length} results for challenge ${challengeId}`,
    );
    return results;
  }
}
