jest.mock('nanoid', () => ({
  __esModule: true,
  nanoid: () => 'mock-nanoid',
}));

import { UnauthorizedException } from '@nestjs/common';
import { MyReviewService } from './myReview.service';

describe('MyReviewService', () => {
  let service: MyReviewService;
  const challengePrismaMock = {
    $queryRaw: jest.fn(),
  };
  const prismaMock = {
    $queryRaw: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MyReviewService(
      challengePrismaMock as any,
      prismaMock as any,
    );
  });

  it('returns mapped summaries for admin users', async () => {
    const now = new Date();
    const future = new Date(now.getTime() + 60_000);

    challengePrismaMock.$queryRaw.mockResolvedValue([
      {
        challengeId: 'challenge-1',
        challengeName: 'Test Challenge',
        challengeTypeId: 'type-1',
        challengeTypeName: 'Development',
        currentPhaseName: 'Review',
        currentPhaseScheduledEnd: future,
        currentPhaseActualEnd: null,
        resourceRoleName: null,
      },
    ]);

    prismaMock.$queryRaw.mockResolvedValue([
      {
        challengeId: 'challenge-1',
        totalReviews: BigInt(4),
        completedReviews: BigInt(2),
      },
    ]);

    const result = await service.getMyReviews({ isMachine: true }, {});

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      challengeId: 'challenge-1',
      challengeName: 'Test Challenge',
      challengeTypeId: 'type-1',
      challengeTypeName: 'Development',
      currentPhaseName: 'Review',
      resourceRoleName: 'Admin',
      reviewProgress: 0.5,
    });
    expect(result[0].timeLeftInCurrentPhase).toBeGreaterThan(0);
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('throws when user context is missing', async () => {
    await expect(
      service.getMyReviews({ isMachine: false }, {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('short-circuits when no challenges are found', async () => {
    challengePrismaMock.$queryRaw.mockResolvedValue([]);

    const result = await service.getMyReviews(
      { isMachine: true },
      { challengeTypeId: 'type-2' },
    );

    expect(result).toEqual([]);
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });
});
