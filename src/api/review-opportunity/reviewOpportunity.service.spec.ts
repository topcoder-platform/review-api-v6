jest.mock('nanoid', () => ({
  __esModule: true,
  nanoid: () => 'mock-nanoid',
}));

import { ReviewApplicationStatus } from '@prisma/client';
import {
  QueryReviewOpportunityDto,
  ReviewOpportunityCanApplyReason,
  ReviewOpportunityStatus,
  ReviewOpportunityType,
} from 'src/dto/reviewOpportunity.dto';
import { ChallengeStatus } from 'src/shared/enums/challengeStatus.enum';
import { UserRole } from 'src/shared/enums/userRole.enum';
import { ReviewOpportunityService } from './reviewOpportunity.service';

describe('ReviewOpportunityService search', () => {
  const prismaMock = {
    reviewOpportunity: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  } as any;
  const challengeServiceMock = {
    ensureChallengeWhitelistAccess: jest.fn(),
    filterChallengeIdsByWhitelist: jest.fn(),
    getChallengeSummaries: jest.fn(),
    getChallengeDetailForUser: jest.fn(),
  } as any;
  const challengeCatalogMock = {
    ensureTracksLoaded: jest.fn(),
    ensureTypesLoaded: jest.fn(),
    getTrackIdByName: jest.fn(),
    getTypeIdByName: jest.fn(),
  } as any;
  const challengePrismaMock = { $queryRaw: jest.fn() } as any;
  const prismaErrorServiceMock = {
    handleError: jest.fn((error) => ({
      message: error instanceof Error ? error.message : String(error),
      code: 'TEST_ERROR',
    })),
  } as any;
  let service: ReviewOpportunityService;

  const dto = (): QueryReviewOpportunityDto =>
    ({
      sortBy: 'startDate',
      sortOrder: 'asc',
      limit: 10,
      offset: 0,
    }) as QueryReviewOpportunityDto;

  beforeEach(() => {
    jest.clearAllMocks();
    challengeServiceMock.ensureChallengeWhitelistAccess.mockResolvedValue(
      undefined,
    );
    prismaMock.$transaction.mockImplementation((operations) =>
      Promise.all(operations),
    );
    service = new ReviewOpportunityService(
      prismaMock,
      challengeServiceMock,
      challengeCatalogMock,
      challengePrismaMock,
      prismaErrorServiceMock,
    );
  });

  it('returns total metadata and caller-specific application eligibility', async () => {
    const opportunity = {
      id: 'opportunity-1',
      challengeId: 'challenge-1',
      status: ReviewOpportunityStatus.OPEN,
      type: ReviewOpportunityType.REGULAR_REVIEW,
      openPositions: 2,
      startDate: new Date('2026-08-20T00:00:00Z'),
      duration: 86400,
      basePayment: 150,
      incrementalPayment: 25,
      applications: [],
      _count: { applications: 4 },
    };
    prismaMock.reviewOpportunity.findMany
      .mockResolvedValueOnce([{ challengeId: 'challenge-1' }])
      .mockResolvedValueOnce([opportunity])
      .mockResolvedValueOnce([
        { id: 'opportunity-1', _count: { applications: 1 } },
      ]);
    prismaMock.reviewOpportunity.count.mockResolvedValue(1);
    challengePrismaMock.$queryRaw.mockResolvedValue([
      { id: 'challenge-1', status: ChallengeStatus.ACTIVE },
    ]);
    challengeServiceMock.filterChallengeIdsByWhitelist.mockResolvedValue([
      'challenge-1',
    ]);
    challengeServiceMock.getChallengeSummaries.mockResolvedValue([
      {
        id: 'challenge-1',
        legacyId: 123,
        name: 'Design Dashboard',
        description: '# Review the dashboard',
        status: ChallengeStatus.ACTIVE,
        track: 'Design',
        numOfSubmissions: 4,
        tags: ['Figma'],
      },
    ]);

    const result = await service.search(dto(), {
      userId: 'reviewer-1',
      handle: 'reviewer-one',
      roles: [UserRole.Reviewer],
      isMachine: false,
    });

    expect(result.metadata).toEqual({
      total: 1,
      offset: 0,
      limit: 10,
      page: 1,
      totalPages: 1,
    });
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        id: 'opportunity-1',
        canApply: true,
        canApplyReason: ReviewOpportunityCanApplyReason.CAN_APPLY,
        myApplications: [],
        applicationCount: 4,
        approvedApplicationCount: 1,
        remainingPositions: 1,
        applicationRoles: ['REVIEWER'],
        defaultApplicationRole: 'REVIEWER',
      }),
    );
    expect(result.items[0].challengeData).toEqual(
      expect.objectContaining({
        name: 'Design Dashboard',
        title: 'Design Dashboard',
        description: '# Review the dashboard',
        overview: '# Review the dashboard',
      }),
    );
    expect(prismaMock.reviewOpportunity.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        include: {
          applications: { where: { userId: 'reviewer-1' } },
          _count: {
            select: {
              applications: true,
            },
          },
        },
      }),
    );
    expect(prismaMock.reviewOpportunity.findMany).toHaveBeenNthCalledWith(
      3,
      {
        where: { id: { in: ['opportunity-1'] } },
        select: {
          id: true,
          _count: {
            select: {
              applications: {
                where: { status: ReviewApplicationStatus.APPROVED },
              },
            },
          },
        },
      },
    );
  });

  it('sorts newest opportunities by creation date before database pagination', async () => {
    prismaMock.reviewOpportunity.findMany
      .mockResolvedValueOnce([{ challengeId: 'challenge-1' }])
      .mockResolvedValueOnce([]);
    prismaMock.reviewOpportunity.count.mockResolvedValue(0);
    challengePrismaMock.$queryRaw.mockResolvedValue([
      { id: 'challenge-1', status: ChallengeStatus.ACTIVE },
    ]);
    challengeServiceMock.filterChallengeIdsByWhitelist.mockResolvedValue([
      'challenge-1',
    ]);

    await service.search({
      ...dto(),
      limit: 5,
      offset: 10,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });

    expect(prismaMock.reviewOpportunity.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: 10,
        take: 5,
      }),
    );
    const pagedWhere =
      prismaMock.reviewOpportunity.findMany.mock.calls[1][0].where;
    expect(prismaMock.reviewOpportunity.count).toHaveBeenCalledWith({
      where: pagedWhere,
    });
  });

  it('returns anonymous aggregate counts without loading applicant rows', async () => {
    const opportunity = {
      id: 'opportunity-public',
      challengeId: 'challenge-public',
      status: ReviewOpportunityStatus.OPEN,
      type: ReviewOpportunityType.REGULAR_REVIEW,
      openPositions: 3,
      startDate: new Date('2026-08-20T00:00:00Z'),
      duration: 86400,
      basePayment: 150,
      incrementalPayment: 25,
      _count: { applications: 7 },
    };
    prismaMock.reviewOpportunity.findMany
      .mockResolvedValueOnce([{ challengeId: 'challenge-public' }])
      .mockResolvedValueOnce([opportunity])
      .mockResolvedValueOnce([
        { id: 'opportunity-public', _count: { applications: 2 } },
      ]);
    prismaMock.reviewOpportunity.count.mockResolvedValue(1);
    challengePrismaMock.$queryRaw.mockResolvedValue([
      { id: 'challenge-public', status: ChallengeStatus.ACTIVE },
    ]);
    challengeServiceMock.filterChallengeIdsByWhitelist.mockResolvedValue([
      'challenge-public',
    ]);
    challengeServiceMock.getChallengeSummaries.mockResolvedValue([
      {
        id: 'challenge-public',
        name: 'Public Review Challenge',
        status: ChallengeStatus.ACTIVE,
      },
    ]);

    const result = await service.search(dto());

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        applications: [],
        myApplications: [],
        applicationCount: 7,
        approvedApplicationCount: 2,
        remainingPositions: 1,
      }),
    );
    expect(prismaMock.reviewOpportunity.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        include: expect.objectContaining({ applications: false }),
      }),
    );
  });

  it('returns the same total and approved aggregates on detail responses', async () => {
    prismaMock.reviewOpportunity.findUnique.mockResolvedValue({
      id: 'opportunity-detail',
      challengeId: 'challenge-detail',
      status: ReviewOpportunityStatus.OPEN,
      type: ReviewOpportunityType.REGULAR_REVIEW,
      openPositions: 2,
      startDate: new Date('2026-08-20T00:00:00Z'),
      duration: 86400,
      basePayment: 150,
      incrementalPayment: 25,
      _count: { applications: 2 },
      applications: [
        {
          id: 'application-approved',
          userId: 'reviewer-1',
          handle: 'reviewer-one',
          role: 'REVIEWER',
          status: ReviewApplicationStatus.APPROVED,
          createdAt: new Date('2026-08-13T00:00:00Z'),
        },
        {
          id: 'application-pending',
          userId: 'reviewer-2',
          handle: 'reviewer-two',
          role: 'REVIEWER',
          status: ReviewApplicationStatus.PENDING,
          createdAt: new Date('2026-08-14T00:00:00Z'),
        },
      ],
    });
    challengeServiceMock.getChallengeDetailForUser.mockResolvedValue({
      id: 'challenge-detail',
      name: 'Review Detail Challenge',
      status: ChallengeStatus.ACTIVE,
    });
    challengePrismaMock.$queryRaw.mockResolvedValue([
      {
        memberId: 'reviewer-1',
        openReviews: 2n,
        latestCompletedReviews: 8n,
      },
      {
        memberId: 'reviewer-2',
        openReviews: 4n,
        latestCompletedReviews: 5n,
      },
    ]);

    const result = await service.get('opportunity-detail');

    expect(result).toEqual(
      expect.objectContaining({
        applicationCount: 2,
        approvedApplicationCount: 1,
        remainingPositions: 1,
        applications: [
          expect.objectContaining({
            userId: 'reviewer-1',
            openReviews: 2,
            latestCompletedReviews: 8,
          }),
          expect.objectContaining({
            userId: 'reviewer-2',
            openReviews: 4,
            latestCompletedReviews: 5,
          }),
        ],
      }),
    );
    expect(challengePrismaMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prismaMock.reviewOpportunity.findUnique).toHaveBeenCalledWith({
      where: { id: 'opportunity-detail' },
      include: {
        applications: true,
        _count: { select: { applications: true } },
      },
    });
  });

  it('hydrates challenge-route applicant metrics in one batch', async () => {
    const authUser = {
      userId: 'group-member',
      roles: [UserRole.Reviewer],
      isMachine: false,
    };
    prismaMock.reviewOpportunity.findMany.mockResolvedValue([
      {
        id: 'opportunity-1',
        challengeId: 'challenge-group',
        status: ReviewOpportunityStatus.OPEN,
        type: ReviewOpportunityType.REGULAR_REVIEW,
        openPositions: 2,
        startDate: new Date('2026-08-20T00:00:00Z'),
        duration: 86400,
        basePayment: 150,
        incrementalPayment: 25,
        applications: [
          {
            id: 'application-1',
            userId: 'reviewer-1',
            handle: 'reviewer-one',
            role: 'REVIEWER',
            status: ReviewApplicationStatus.PENDING,
            createdAt: new Date('2026-08-13T00:00:00Z'),
          },
        ],
        _count: { applications: 1 },
      },
      {
        id: 'opportunity-2',
        challengeId: 'challenge-group',
        status: ReviewOpportunityStatus.OPEN,
        type: ReviewOpportunityType.REGULAR_REVIEW,
        openPositions: 1,
        startDate: new Date('2026-08-21T00:00:00Z'),
        duration: 86400,
        basePayment: 100,
        incrementalPayment: 20,
        applications: [
          {
            id: 'application-2',
            userId: 'reviewer-2',
            handle: 'reviewer-two',
            role: 'REVIEWER',
            status: ReviewApplicationStatus.APPROVED,
            createdAt: new Date('2026-08-12T00:00:00Z'),
          },
        ],
        _count: { applications: 1 },
      },
    ]);
    challengeServiceMock.getChallengeSummaries.mockResolvedValue([
      {
        id: 'challenge-group',
        name: 'Group Review Challenge',
        status: ChallengeStatus.ACTIVE,
      },
    ]);
    challengePrismaMock.$queryRaw.mockResolvedValue([
      {
        memberId: 'reviewer-1',
        openReviews: 1n,
        latestCompletedReviews: 6n,
      },
      {
        memberId: 'reviewer-2',
        openReviews: 3n,
        latestCompletedReviews: 9n,
      },
    ]);

    const result = await service.getByChallengeId(
      'challenge-group',
      authUser,
    );

    expect(
      challengeServiceMock.ensureChallengeWhitelistAccess,
    ).toHaveBeenCalledWith(authUser, 'challenge-group');
    expect(challengePrismaMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(result[0].applications?.[0]).toEqual(
      expect.objectContaining({
        userId: 'reviewer-1',
        openReviews: 1,
        latestCompletedReviews: 6,
      }),
    );
    expect(result[1].applications?.[0]).toEqual(
      expect.objectContaining({
        userId: 'reviewer-2',
        openReviews: 3,
        latestCompletedReviews: 9,
      }),
    );
  });

  it('applies authenticated member application filters in the database', async () => {
    prismaMock.reviewOpportunity.findMany.mockResolvedValue([]);
    const query = dto();
    query.appliedByMe = true;
    query.applicationStatuses = ['PENDING' as any];

    await service.search(query, {
      userId: 'reviewer-1',
      roles: [UserRole.Reviewer],
      isMachine: false,
    });

    expect(prismaMock.reviewOpportunity.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        applications: {
          some: {
            userId: 'reviewer-1',
            status: { in: ['PENDING'] },
          },
        },
      }),
      select: { challengeId: true },
      distinct: ['challengeId'],
    });
  });

  it('requires authentication for appliedByMe filtering', async () => {
    const query = dto();
    query.appliedByMe = true;

    await expect(service.search(query)).rejects.toMatchObject({
      response: {
        code: 'REVIEW_OPPORTUNITY_APPLICATION_FILTER_AUTH_REQUIRED',
      },
    });
  });

  it('marks the CTA inactive for an authenticated non-reviewer', async () => {
    const reason = (service as any).resolveCanApplyReason(
      { status: ReviewOpportunityStatus.OPEN },
      { status: ChallengeStatus.ACTIVE },
      {
        userId: 'member-1',
        roles: [UserRole.User],
        isMachine: false,
      },
      false,
      1,
    );

    expect(reason).toBe(ReviewOpportunityCanApplyReason.NOT_REVIEWER);
  });

  it('keeps closed opportunities discoverable after the challenge completes', async () => {
    const opportunity = {
      id: 'opportunity-closed',
      challengeId: 'challenge-completed',
      status: ReviewOpportunityStatus.CLOSED,
      type: ReviewOpportunityType.REGULAR_REVIEW,
      openPositions: 1,
      startDate: new Date('2026-07-20T00:00:00Z'),
      duration: 86400,
      basePayment: 100,
      incrementalPayment: 0,
      applications: [],
      _count: { applications: 3 },
    };
    prismaMock.reviewOpportunity.findMany
      .mockResolvedValueOnce([{ challengeId: 'challenge-completed' }])
      .mockResolvedValueOnce([opportunity])
      .mockResolvedValueOnce([
        { id: 'opportunity-closed', _count: { applications: 1 } },
      ]);
    prismaMock.reviewOpportunity.count.mockResolvedValue(1);
    challengePrismaMock.$queryRaw.mockResolvedValue([
      { id: 'challenge-completed', status: ChallengeStatus.COMPLETED },
    ]);
    challengeServiceMock.filterChallengeIdsByWhitelist.mockResolvedValue([
      'challenge-completed',
    ]);
    challengeServiceMock.getChallengeSummaries.mockResolvedValue([
      {
        id: 'challenge-completed',
        legacyId: 456,
        name: 'Completed Design Challenge',
        status: ChallengeStatus.COMPLETED,
      },
    ]);
    const query = dto();
    query.statuses = [ReviewOpportunityStatus.CLOSED];

    const result = await service.search(query, {
      userId: 'reviewer-1',
      handle: 'reviewer-one',
      roles: [UserRole.Reviewer],
      isMachine: false,
    });

    expect(result.metadata.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        id: 'opportunity-closed',
        status: ReviewOpportunityStatus.CLOSED,
        canApplyReason: ReviewOpportunityCanApplyReason.OPPORTUNITY_CLOSED,
      }),
    );
  });
});
