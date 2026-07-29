import { SubmissionStatus, SubmissionType } from '@prisma/client';
import { ChallengeStatus } from 'src/shared/enums/challengeStatus.enum';
import { JwtUser } from 'src/shared/modules/global/jwt.service';
import { ProjectResultService } from './projectResult.service';

jest.mock('src/shared/modules/global/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

describe('ProjectResultService', () => {
  const challengeApiServiceMock = {
    getChallengeDetailForUser: jest.fn(),
  };
  const prismaMock = {
    challengeResult: {
      findMany: jest.fn(),
    },
    submission: {
      findMany: jest.fn(),
    },
  };

  const authUser: JwtUser = { userId: 'requester-1', isMachine: false };
  const createdAt = new Date('2025-01-01T00:00:00.000Z');
  const updatedAt = new Date('2025-01-02T00:00:00.000Z');

  let service: ProjectResultService;

  beforeEach(() => {
    jest.resetAllMocks();
    challengeApiServiceMock.getChallengeDetailForUser.mockResolvedValue({
      id: 'challenge-1',
      name: 'Challenge With Winners',
      status: ChallengeStatus.COMPLETED,
      track: 'Development',
      legacyId: 1001,
      winners: [],
    });
    prismaMock.challengeResult.findMany.mockResolvedValue([]);
    prismaMock.submission.findMany.mockResolvedValue([]);
    service = new ProjectResultService(
      challengeApiServiceMock as any,
      prismaMock as any,
    );
  });

  it('returns the exact canonical result for a deduplicated final placement winner', async () => {
    challengeApiServiceMock.getChallengeDetailForUser.mockResolvedValue({
      id: 'challenge-1',
      name: 'Challenge With Winners',
      status: ChallengeStatus.COMPLETED,
      track: 'Development',
      legacyId: 1001,
      winners: [
        { userId: 12345, handle: 'winner', placement: 1, type: 'PLACEMENT' },
        { userId: 12345, handle: 'winner', placement: 1, type: 'PLACEMENT' },
        {
          userId: 54321,
          handle: 'checkpoint-winner',
          placement: 1,
          type: 'CHECKPOINT',
        },
      ],
    });
    prismaMock.challengeResult.findMany.mockResolvedValue([
      {
        challengeId: 'challenge-1',
        userId: '12345',
        paymentId: 'payment-1',
        submissionId: 'canonical-winning-submission',
        oldRating: 1500,
        newRating: 1525,
        initialScore: 91,
        finalScore: 94.5,
        placement: 1,
        rated: true,
        passedReview: true,
        validSubmission: true,
        pointAdjustment: 2.5,
        ratingOrder: 1,
        createdAt,
        createdBy: 'autopilot',
        updatedAt,
        updatedBy: 'autopilot',
      },
    ]);

    const results = await service.getProjectResultsFromChallenge(
      authUser,
      'challenge-1',
    );

    expect(
      challengeApiServiceMock.getChallengeDetailForUser,
    ).toHaveBeenCalledWith(authUser, 'challenge-1');
    expect(prismaMock.challengeResult.findMany).toHaveBeenCalledWith({
      where: {
        challengeId: 'challenge-1',
        userId: { in: ['12345'] },
      },
      select: {
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
      },
    });
    expect(prismaMock.submission.findMany).not.toHaveBeenCalled();
    expect(results).toEqual([
      {
        challengeId: 'challenge-1',
        userId: '12345',
        paymentId: 'payment-1',
        submissionId: 'canonical-winning-submission',
        oldRating: 1500,
        newRating: 1525,
        initialScore: 91,
        finalScore: 94.5,
        placement: 1,
        rated: true,
        passedReview: true,
        validSubmission: true,
        pointAdjustment: 2.5,
        ratingOrder: 1,
        createdAt,
        createdBy: 'autopilot',
        updatedAt,
        updatedBy: 'autopilot',
        reviews: [],
      },
    ]);
  });

  it.each([
    undefined,
    '',
    'CONTEST_SUBMISSION',
    'Contest Submission',
  ])(
    'accepts the legacy final-placement winner type %p',
    async (winnerType) => {
      challengeApiServiceMock.getChallengeDetailForUser.mockResolvedValue({
        id: 'challenge-1',
        name: 'Legacy Challenge With Winners',
        status: ChallengeStatus.COMPLETED,
        track: 'Development',
        legacyId: 1001,
        winners: [
          {
            userId: 12345,
            handle: 'legacy-winner',
            placement: 1,
            type: winnerType,
          },
        ],
      });
      prismaMock.challengeResult.findMany.mockResolvedValue([
        {
          challengeId: 'challenge-1',
          userId: '12345',
          paymentId: null,
          submissionId: 'canonical-winning-submission',
          oldRating: null,
          newRating: null,
          initialScore: 91,
          finalScore: 94.5,
          placement: 1,
          rated: false,
          passedReview: true,
          validSubmission: true,
          pointAdjustment: null,
          ratingOrder: null,
          createdAt,
          createdBy: 'autopilot',
          updatedAt,
          updatedBy: 'autopilot',
        },
      ]);

      const results = await service.getProjectResultsFromChallenge(
        authUser,
        'challenge-1',
      );

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        challengeId: 'challenge-1',
        userId: '12345',
        submissionId: 'canonical-winning-submission',
        placement: 1,
      });
      expect(prismaMock.submission.findMany).not.toHaveBeenCalled();
    },
  );

  it('treats a mismatching canonical row as decisive instead of selecting a sibling submission', async () => {
    challengeApiServiceMock.getChallengeDetailForUser.mockResolvedValue({
      id: 'challenge-1',
      status: ChallengeStatus.COMPLETED,
      winners: [
        { userId: 12345, handle: 'winner', placement: 1, type: 'PLACEMENT' },
      ],
    });
    prismaMock.challengeResult.findMany.mockResolvedValue([
      {
        challengeId: 'challenge-1',
        userId: '12345',
        paymentId: null,
        submissionId: 'canonical-other-placement-submission',
        oldRating: null,
        newRating: null,
        initialScore: 80,
        finalScore: 82,
        placement: 2,
        rated: false,
        passedReview: true,
        validSubmission: true,
        pointAdjustment: null,
        ratingOrder: null,
        createdAt,
        createdBy: 'autopilot',
        updatedAt,
        updatedBy: 'autopilot',
      },
    ]);
    prismaMock.submission.findMany.mockResolvedValue([
      {
        id: 'legacy-placement-one-sibling',
        memberId: '12345',
        initialScore: 95,
        finalScore: 97,
        placement: 1,
        createdAt,
        createdBy: 'legacy',
        updatedAt,
        updatedBy: 'legacy',
      },
    ]);

    const results = await service.getProjectResultsFromChallenge(
      authUser,
      'challenge-1',
    );

    expect(results).toEqual([]);
    expect(prismaMock.submission.findMany).not.toHaveBeenCalled();
  });

  it('uses one exact active contest placement submission when canonical data is absent', async () => {
    challengeApiServiceMock.getChallengeDetailForUser.mockResolvedValue({
      id: 'challenge-1',
      status: ChallengeStatus.COMPLETED,
      winners: [
        { userId: 12345, handle: 'winner', placement: 1, type: 'PLACEMENT' },
      ],
    });
    prismaMock.submission.findMany.mockResolvedValue([
      {
        id: 'exact-legacy-winning-submission',
        memberId: '12345',
        initialScore: 88,
        finalScore: 92,
        placement: 1,
        createdAt,
        createdBy: 'legacy-migration',
        updatedAt,
        updatedBy: 'legacy-migration',
      },
    ]);

    const results = await service.getProjectResultsFromChallenge(
      authUser,
      'challenge-1',
    );

    expect(prismaMock.submission.findMany).toHaveBeenCalledWith({
      where: {
        challengeId: 'challenge-1',
        memberId: { in: ['12345'] },
        type: SubmissionType.CONTEST_SUBMISSION,
        status: SubmissionStatus.ACTIVE,
        placement: { in: [1] },
      },
      select: {
        id: true,
        memberId: true,
        initialScore: true,
        finalScore: true,
        placement: true,
        createdAt: true,
        createdBy: true,
        updatedAt: true,
        updatedBy: true,
      },
    });
    expect(results).toEqual([
      {
        challengeId: 'challenge-1',
        userId: '12345',
        submissionId: 'exact-legacy-winning-submission',
        initialScore: 88,
        finalScore: 92,
        placement: 1,
        rated: false,
        passedReview: true,
        validSubmission: true,
        createdAt,
        createdBy: 'legacy-migration',
        updatedAt,
        updatedBy: 'legacy-migration',
        reviews: [],
      },
    ]);
  });

  it.each([
    ['missing', []],
    [
      'ambiguous',
      [
        {
          id: 'legacy-winner-one',
          memberId: '12345',
          initialScore: 88,
          finalScore: 92,
          placement: 1,
          createdAt,
          createdBy: 'legacy',
          updatedAt,
          updatedBy: 'legacy',
        },
        {
          id: 'legacy-winner-two',
          memberId: '12345',
          initialScore: 90,
          finalScore: 94,
          placement: 1,
          createdAt,
          createdBy: 'legacy',
          updatedAt,
          updatedBy: 'legacy',
        },
      ],
    ],
  ])(
    'omits a winner when canonical data is absent and legacy evidence is %s',
    async (_description, legacySubmissions) => {
      challengeApiServiceMock.getChallengeDetailForUser.mockResolvedValue({
        id: 'challenge-1',
        status: ChallengeStatus.COMPLETED,
        winners: [
          {
            userId: 12345,
            handle: 'winner',
            placement: 1,
            type: 'PLACEMENT',
          },
        ],
      });
      prismaMock.submission.findMany.mockResolvedValue(legacySubmissions);

      const results = await service.getProjectResultsFromChallenge(
        authUser,
        'challenge-1',
      );

      expect(results).toEqual([]);
    },
  );

  it('excludes checkpoint and non-positive placement winner rows before querying results', async () => {
    challengeApiServiceMock.getChallengeDetailForUser.mockResolvedValue({
      id: 'challenge-1',
      status: ChallengeStatus.COMPLETED,
      winners: [
        {
          userId: 54321,
          handle: 'checkpoint-winner',
          placement: 1,
          type: 'CHECKPOINT',
        },
        {
          userId: 12345,
          handle: 'invalid-placement',
          placement: 0,
          type: 'PLACEMENT',
        },
        {
          userId: 99999,
          handle: 'passed-review',
          placement: 1,
          type: 'PASSED_REVIEW',
        },
      ],
    });

    const results = await service.getProjectResultsFromChallenge(
      authUser,
      'challenge-1',
    );

    expect(results).toEqual([]);
    expect(prismaMock.challengeResult.findMany).not.toHaveBeenCalled();
    expect(prismaMock.submission.findMany).not.toHaveBeenCalled();
  });
});
