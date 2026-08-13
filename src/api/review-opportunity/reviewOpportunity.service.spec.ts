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
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  } as any;
  const challengeServiceMock = {
    filterChallengeIdsByWhitelist: jest.fn(),
    getChallenges: jest.fn(),
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
      applications: [
        {
          id: 'application-1',
          userId: 'reviewer-2',
          handle: 'other-reviewer',
          role: 'REVIEWER',
          status: ReviewApplicationStatus.APPROVED,
          createdAt: new Date('2026-08-10T00:00:00Z'),
        },
      ],
    };
    prismaMock.reviewOpportunity.findMany
      .mockResolvedValueOnce([{ challengeId: 'challenge-1' }])
      .mockResolvedValueOnce([opportunity]);
    prismaMock.reviewOpportunity.count.mockResolvedValue(1);
    challengePrismaMock.$queryRaw.mockResolvedValue([{ id: 'challenge-1' }]);
    challengeServiceMock.filterChallengeIdsByWhitelist.mockResolvedValue([
      'challenge-1',
    ]);
    challengeServiceMock.getChallenges.mockResolvedValue([
      {
        id: 'challenge-1',
        legacyId: 123,
        name: 'Design Dashboard',
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
        approvedApplicationCount: 1,
        remainingPositions: 1,
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
});
