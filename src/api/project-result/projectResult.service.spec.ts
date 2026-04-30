import { ChallengeStatus } from 'src/shared/enums/challengeStatus.enum';
import { ChallengeApiService } from 'src/shared/modules/global/challenge.service';
import { JwtUser } from 'src/shared/modules/global/jwt.service';
import { ProjectResultService } from './projectResult.service';

jest.mock('src/shared/modules/global/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

describe('ProjectResultService', () => {
  const challengePrismaMock = {
    $queryRaw: jest.fn(),
  };
  const prismaMock = {
    submission: {
      findFirst: jest.fn(),
    },
    review: {
      findMany: jest.fn(),
    },
  };

  let service: ProjectResultService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new ProjectResultService(
      new ChallengeApiService(challengePrismaMock as any),
      prismaMock as any,
    );
  });

  it('returns populated project results for a whitelisted caller when the challenge has winners', async () => {
    const authUser: JwtUser = { userId: '12345', isMachine: false };
    const createdAt = new Date('2025-01-01T00:00:00.000Z');
    const updatedAt = new Date('2025-01-02T00:00:00.000Z');

    challengePrismaMock.$queryRaw
      .mockResolvedValueOnce([
        { challengeId: 'challenge-1', userId: authUser.userId },
      ])
      .mockResolvedValueOnce([
        {
          id: 'challenge-1',
          name: 'Challenge With Winners',
          status: ChallengeStatus.COMPLETED,
          typeId: null,
          trackId: null,
          numOfSubmissions: 1,
          tags: [],
          legacyId: 1001,
          createdAt,
          createdBy: 'creator-user',
          updatedAt,
          updatedBy: 'updater-user',
        },
      ])
      .mockResolvedValueOnce([
        {
          track: 'DEVELOP',
          subTrack: 'CODE',
          legacySystemId: 1001,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          userId: 12345,
          handle: 'winner_handle',
          placement: 1,
          type: 'CHALLENGE_PRIZE',
        },
      ]);
    prismaMock.submission.findFirst.mockResolvedValue({ id: 'submission-1' });
    prismaMock.review.findMany.mockResolvedValue([
      { initialScore: 80, finalScore: 90 },
      { initialScore: 90, finalScore: 96 },
    ]);

    const results = await service.getProjectResultsFromChallenge(
      authUser,
      'challenge-1',
    );

    expect(prismaMock.submission.findFirst.mock.calls[0]?.[0]).toEqual({
      where: {
        memberId: '12345',
        challengeId: 'challenge-1',
      },
      select: {
        id: true,
      },
    });
    expect(results).toEqual([
      {
        challengeId: 'challenge-1',
        userId: '12345',
        submissionId: 'submission-1',
        initialScore: 85,
        finalScore: 93,
        placement: 1,
        rated: false,
        passedReview: true,
        validSubmission: true,
        createdAt,
        createdBy: 'creator-user',
        updatedAt,
        updatedBy: 'updater-user',
        reviews: [],
      },
    ]);
  });
});
