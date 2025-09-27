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

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MyReviewService(challengePrismaMock as any);
  });

  it('returns mapped summaries for admin users', async () => {
    const now = new Date();
    const future = new Date(now.getTime() + 60_000);

    challengePrismaMock.$queryRaw
      .mockResolvedValueOnce([{ total: BigInt(1) }])
      .mockResolvedValueOnce([
        {
          challengeId: 'challenge-1',
          challengeName: 'Test Challenge',
          challengeTypeId: 'type-1',
          challengeTypeName: 'Development',
          currentPhaseName: 'Review',
          currentPhaseScheduledEnd: future,
          currentPhaseActualEnd: null,
          resourceRoleName: null,
          challengeEndDate: future,
          totalReviews: BigInt(4),
          completedReviews: BigInt(2),
        },
      ]);

    const result = await service.getMyReviews({ isMachine: true }, {});

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      challengeId: 'challenge-1',
      challengeName: 'Test Challenge',
      challengeTypeId: 'type-1',
      challengeTypeName: 'Development',
      currentPhaseName: 'Review',
      resourceRoleName: 'Admin',
      reviewProgress: 0.5,
    });
    expect(result.data[0].timeLeftInCurrentPhase).toBeGreaterThan(0);
    expect(result.meta).toEqual({
      page: 1,
      perPage: 10,
      totalCount: 1,
      totalPages: 1,
    });
  });

  it('throws when user context is missing', async () => {
    await expect(
      service.getMyReviews({ isMachine: false }, {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('short-circuits when no challenges are found', async () => {
    challengePrismaMock.$queryRaw.mockResolvedValueOnce([{ total: 0n }]);

    const result = await service.getMyReviews(
      { isMachine: true },
      { challengeTypeId: 'type-2' },
    );

    expect(result).toEqual({
      data: [],
      meta: {
        page: 1,
        perPage: 10,
        totalCount: 0,
        totalPages: 0,
      },
    });
  });

  it('queries past challenge statuses when past filter is true', async () => {
    const pastStatuses = [
      'COMPLETED',
      'CANCELLED',
      'CANCELLED_FAILED_REVIEW',
      'CANCELLED_FAILED_SCREENING',
      'CANCELLED_ZERO_SUBMISSIONS',
      'CANCELLED_CLIENT_REQUEST',
    ];

    challengePrismaMock.$queryRaw.mockResolvedValueOnce([{ total: 0n }]);

    const result = await service.getMyReviews(
      { isMachine: false, userId: '123' },
      { past: 'true' },
    );

    expect(result).toEqual({
      data: [],
      meta: {
        page: 1,
        perPage: 10,
        totalCount: 0,
        totalPages: 0,
      },
    });
    const query = challengePrismaMock.$queryRaw.mock.calls[0][0];
    const queryDetails = query.inspect();

    expect(queryDetails.sql).toContain('c.status IN');
    expect(queryDetails.values).toEqual(expect.arrayContaining(pastStatuses));
  });

  it('applies requested sorting for active challenges', async () => {
    const future = new Date(Date.now() + 60_000);

    challengePrismaMock.$queryRaw
      .mockResolvedValueOnce([{ total: 1n }])
      .mockResolvedValueOnce([
        {
          challengeId: 'challenge-1',
          challengeName: 'Alpha',
          challengeTypeId: null,
          challengeTypeName: null,
          currentPhaseName: 'Review',
          currentPhaseScheduledEnd: future,
          currentPhaseActualEnd: null,
          resourceRoleName: null,
          challengeEndDate: future,
          totalReviews: 0n,
          completedReviews: 0n,
        },
      ]);

    await service.getMyReviews(
      { isMachine: true },
      { sortBy: 'projectName', sortOrder: 'desc' },
    );

    const query = challengePrismaMock.$queryRaw.mock.calls[1][0];
    const sql = query.inspect().sql.replace(/\s+/g, ' ');
    expect(sql).toContain('ORDER BY');
    expect(sql).toContain('c.name DESC NULLS LAST');
    expect(sql).toContain('c."createdAt" DESC NULLS LAST');
  });

  it('enables time left and challenge end sorting options', async () => {
    const future = new Date(Date.now() + 120_000);

    challengePrismaMock.$queryRaw
      .mockResolvedValueOnce([{ total: 1n }])
      .mockResolvedValueOnce([
        {
          challengeId: 'challenge-2',
          challengeName: 'Beta',
          challengeTypeId: null,
          challengeTypeName: null,
          currentPhaseName: 'Review',
          currentPhaseScheduledEnd: future,
          currentPhaseActualEnd: null,
          resourceRoleName: null,
          challengeEndDate: future,
          totalReviews: 0n,
          completedReviews: 0n,
        },
      ]);

    await service.getMyReviews(
      { isMachine: true },
      {
        past: 'true',
        sortBy: 'challengeEndDate',
        sortOrder: 'asc',
      },
    );

    const rowQueryCall = challengePrismaMock.$queryRaw.mock.calls[1][0];
    const sql = rowQueryCall.inspect().sql.replace(/\s+/g, ' ');
    expect(sql).toContain('c."endDate" ASC NULLS LAST');

    challengePrismaMock.$queryRaw.mockClear();
    challengePrismaMock.$queryRaw
      .mockResolvedValueOnce([{ total: 1n }])
      .mockResolvedValueOnce([
        {
          challengeId: 'challenge-3',
          challengeName: 'Gamma',
          challengeTypeId: null,
          challengeTypeName: null,
          currentPhaseName: 'Review',
          currentPhaseScheduledEnd: future,
          currentPhaseActualEnd: null,
          resourceRoleName: null,
          challengeEndDate: future,
          totalReviews: 0n,
          completedReviews: 0n,
        },
      ]);

    await service.getMyReviews(
      { isMachine: true },
      { sortBy: 'timeLeft', sortOrder: 'asc' },
    );

    const activeQuery = challengePrismaMock.$queryRaw.mock.calls[1][0];
    const activeSql = activeQuery.inspect().sql.replace(/\s+/g, ' ');
    expect(activeSql).toMatch(
      /GREATEST\(EXTRACT\(EPOCH FROM \( ?COALESCE\(cp\."actualEndDate", cp\."scheduledEndDate"\) - NOW\(\)\)\), 0\) ASC NULLS LAST/,
    );
  });
});
