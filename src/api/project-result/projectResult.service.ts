import { Injectable } from '@nestjs/common';
import { Prisma, SubmissionStatus, SubmissionType } from '@prisma/client';
import { LoggerService } from '../../shared/modules/global/logger.service';
import { ChallengeApiService } from '../../shared/modules/global/challenge.service';
import { PrismaService } from '../../shared/modules/global/prisma.service';
import { ProjectResultResponseDto } from '../../dto/projectResult.dto';
import { JwtUser } from 'src/shared/modules/global/jwt.service';

const CANONICAL_PROJECT_RESULT_SELECT = {
  challengeId: true,
  userId: true,
  paymentId: true,
  submissionId: true,
  oldRating: true,
  newRating: true,
  initialScore: true,
  finalScore: true,
  placement: true,
  rated: true,
  passedReview: true,
  validSubmission: true,
  pointAdjustment: true,
  ratingOrder: true,
  createdAt: true,
  createdBy: true,
  updatedAt: true,
  updatedBy: true,
} as const;

const LEGACY_PROJECT_RESULT_SUBMISSION_SELECT = {
  id: true,
  memberId: true,
  initialScore: true,
  finalScore: true,
  placement: true,
  createdAt: true,
  createdBy: true,
  updatedAt: true,
  updatedBy: true,
} as const;

type CanonicalProjectResultRow = Prisma.challengeResultGetPayload<{
  select: typeof CANONICAL_PROJECT_RESULT_SELECT;
}>;

type LegacyProjectResultSubmission = Prisma.submissionGetPayload<{
  select: typeof LEGACY_PROJECT_RESULT_SUBMISSION_SELECT;
}>;

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
   * Loads exact project results for final placement winners after applying the
   * challenge whitelist for interactive callers.
   *
   * Canonical `challengeResult` rows are loaded in one batch and keyed by
   * challenge and user. A row is returned only when its positive placement
   * matches a final `PLACEMENT` winner for the same member. Canonical rows are
   * decisive: mismatches never fall through to legacy lookup. When a canonical
   * row is genuinely absent, compatibility fallback accepts only one ACTIVE
   * contest submission carrying the exact member and placement; ambiguous or
   * missing direct evidence is omitted rather than reconstructed from reviews.
   *
   * @param authUser - The authenticated request user.
   * @param challengeId - Challenge id whose results should be returned.
   * @returns Exact final-placement result rows visible to the caller.
   * @throws Error when challenge or result storage cannot be queried.
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

    const placementsByUserId = new Map<string, Set<number>>();
    for (const winner of challenge.winners ?? []) {
      const winnerType = String(winner.type ?? '')
        .trim()
        .toUpperCase();
      const userId = String(winner.userId ?? '').trim();
      const placement = Number(winner.placement);

      if (
        winnerType !== 'PLACEMENT' ||
        !userId ||
        !Number.isInteger(placement) ||
        placement <= 0
      ) {
        continue;
      }

      const placements = placementsByUserId.get(userId) ?? new Set<number>();
      placements.add(placement);
      placementsByUserId.set(userId, placements);
    }

    const winnerUserIds = Array.from(placementsByUserId.keys());
    if (!winnerUserIds.length) {
      this.logger.log(`Found 0 results for challenge ${challengeId}`);
      return [];
    }

    const canonicalRows = await this.prisma.challengeResult.findMany({
      where: {
        challengeId: challenge.id,
        userId: { in: winnerUserIds },
      },
      select: CANONICAL_PROJECT_RESULT_SELECT,
    });
    const canonicalByUserId = new Map(
      canonicalRows.map((row) => [row.userId, row]),
    );
    const resultByUserId = new Map<string, ProjectResultResponseDto>();
    const missingCanonicalPlacements = new Map<string, Set<number>>();

    for (const [userId, placements] of placementsByUserId.entries()) {
      const canonicalRow = canonicalByUserId.get(userId);
      if (!canonicalRow) {
        missingCanonicalPlacements.set(userId, placements);
        continue;
      }

      if (
        !canonicalRow.submissionId ||
        canonicalRow.placement <= 0 ||
        !placements.has(canonicalRow.placement)
      ) {
        this.logger.warn(
          `Canonical project result for challenge ${challenge.id} and user ${userId} does not match a final placement winner; omitting it`,
        );
        continue;
      }

      resultByUserId.set(userId, this.mapCanonicalProjectResult(canonicalRow));
    }

    if (missingCanonicalPlacements.size) {
      const unresolvedUserIds = Array.from(missingCanonicalPlacements.keys());
      const unresolvedPlacements = Array.from(
        new Set(
          Array.from(missingCanonicalPlacements.values()).flatMap(
            (placements) => Array.from(placements),
          ),
        ),
      );
      const legacySubmissions = await this.prisma.submission.findMany({
        where: {
          challengeId: challenge.id,
          memberId: { in: unresolvedUserIds },
          type: SubmissionType.CONTEST_SUBMISSION,
          status: SubmissionStatus.ACTIVE,
          placement: { in: unresolvedPlacements },
        },
        select: LEGACY_PROJECT_RESULT_SUBMISSION_SELECT,
      });
      const legacyByUserId = new Map<string, LegacyProjectResultSubmission[]>();

      for (const submission of legacySubmissions) {
        const userId = String(submission.memberId ?? '').trim();
        const placements = missingCanonicalPlacements.get(userId);
        if (
          !placements ||
          submission.placement == null ||
          !placements.has(submission.placement)
        ) {
          continue;
        }

        const candidates = legacyByUserId.get(userId) ?? [];
        candidates.push(submission);
        legacyByUserId.set(userId, candidates);
      }

      for (const [userId] of missingCanonicalPlacements.entries()) {
        const candidates = legacyByUserId.get(userId) ?? [];
        if (candidates.length !== 1) {
          this.logger.warn(
            `No unambiguous legacy project result for challenge ${challenge.id} and user ${userId}; omitting it`,
          );
          continue;
        }

        resultByUserId.set(
          userId,
          this.mapLegacyProjectResult(challenge.id, userId, candidates[0]),
        );
      }
    }

    const results = winnerUserIds
      .map((userId) => resultByUserId.get(userId))
      .filter((result): result is ProjectResultResponseDto => Boolean(result));

    this.logger.log(
      `Found ${results.length} results for challenge ${challengeId}`,
    );
    return results;
  }

  /**
   * Maps an authoritative challenge-result row into the project-result response.
   *
   * This preserves the canonical submission identity, scores, rating data, and
   * audit timestamps used by winner consumers. Nullable optional result fields
   * remain absent, while nullable audit actors use the response contract's
   * historical `system` fallback.
   *
   * @param row - Canonical result selected for a final placement winner.
   * @returns A project-result response backed by the exact canonical row.
   * @throws Never.
   */
  private mapCanonicalProjectResult(
    row: CanonicalProjectResultRow,
  ): ProjectResultResponseDto {
    const result: ProjectResultResponseDto = {
      challengeId: row.challengeId,
      userId: row.userId,
      submissionId: row.submissionId,
      initialScore: row.initialScore,
      finalScore: row.finalScore,
      placement: row.placement,
      rated: row.rated,
      passedReview: row.passedReview,
      validSubmission: row.validSubmission,
      createdAt: row.createdAt,
      createdBy: row.createdBy ?? 'system',
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy ?? 'system',
      reviews: [],
    };

    if (row.paymentId != null) {
      result.paymentId = row.paymentId;
    }
    if (row.oldRating != null) {
      result.oldRating = row.oldRating;
    }
    if (row.newRating != null) {
      result.newRating = row.newRating;
    }
    if (row.pointAdjustment != null) {
      result.pointAdjustment = row.pointAdjustment;
    }
    if (row.ratingOrder != null) {
      result.ratingOrder = row.ratingOrder;
    }

    return result;
  }

  /**
   * Maps one unambiguous legacy placement submission into a compatibility row.
   *
   * This method is used only when no canonical result exists and the caller has
   * already proven there is exactly one ACTIVE contest submission with the
   * winner's exact user and positive placement. It uses only persisted
   * submission scores and audit fields; it never reconstructs scores from
   * reviews. Rating-specific fields remain at their historical safe defaults.
   *
   * @param challengeId - Challenge containing the legacy submission.
   * @param userId - Final placement winner owning the submission.
   * @param submission - Sole exact legacy placement candidate.
   * @returns A compatibility project-result response for that submission.
   * @throws Never.
   */
  private mapLegacyProjectResult(
    challengeId: string,
    userId: string,
    submission: LegacyProjectResultSubmission,
  ): ProjectResultResponseDto {
    const initialScore = Number(submission.initialScore ?? 0);

    return {
      challengeId,
      userId,
      submissionId: submission.id,
      initialScore,
      finalScore: Number(submission.finalScore ?? initialScore),
      placement: submission.placement as number,
      rated: false,
      passedReview: true,
      validSubmission: true,
      createdAt: submission.createdAt,
      createdBy: submission.createdBy ?? 'system',
      updatedAt: submission.updatedAt ?? submission.createdAt,
      updatedBy: submission.updatedBy ?? 'system',
      reviews: [],
    };
  }
}
