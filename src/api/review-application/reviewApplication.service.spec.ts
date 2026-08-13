jest.mock('nanoid', () => ({
  __esModule: true,
  nanoid: () => 'mock-nanoid',
}));

import {
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma, ReviewOpportunityType } from '@prisma/client';
import {
  ReviewApplicationRole,
  ReviewApplicationStatus,
} from 'src/dto/reviewApplication.dto';
import { CommonConfig } from 'src/shared/config/common.config';
import { ChallengeStatus } from 'src/shared/enums/challengeStatus.enum';
import { ReviewApplicationService } from './reviewApplication.service';

describe('ReviewApplicationService', () => {
  let service: ReviewApplicationService;

  const prismaMock = {
    $transaction: jest.fn(),
    reviewOpportunity: {
      findUnique: jest.fn(),
    },
    reviewApplication: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const challengeServiceMock = {
    ensureChallengeWhitelistAccess: jest.fn(),
    getChallengeDetail: jest.fn(),
    getChallengeDetailForUser: jest.fn(),
  };

  const challengePrismaMock = {
    $queryRaw: jest.fn(),
  };

  const resourcePrismaMock = {
    resourceRole: {
      findFirst: jest.fn(),
    },
    resource: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  };

  const memberServiceMock = {
    getUserEmails: jest.fn(),
  };

  const eventBusServiceMock = {
    publish: jest.fn(),
    sendEmail: jest.fn(),
  };

  const prismaErrorServiceMock = {
    handleError: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    resourcePrismaMock.resource.findFirst.mockResolvedValue(null);
    resourcePrismaMock.resource.create.mockImplementation(({ data }) =>
      Promise.resolve({
        id: 'resource-1',
        ...data,
        createdAt: new Date('2026-05-27T03:49:10.279Z'),
        updatedAt: null,
        updatedBy: null,
        phaseChangeNotifications: true,
      }),
    );
    prismaMock.reviewApplication.update.mockResolvedValue({ id: 'app-1' });
    prismaMock.$transaction.mockImplementation((operations) =>
      Promise.all(operations),
    );
    memberServiceMock.getUserEmails.mockResolvedValue([
      { userId: '1001', email: 'reviewer@example.com', handle: 'reviewer' },
    ]);
    eventBusServiceMock.publish.mockResolvedValue(undefined);
    eventBusServiceMock.sendEmail.mockResolvedValue(undefined);
    challengeServiceMock.ensureChallengeWhitelistAccess.mockResolvedValue(
      undefined,
    );
    prismaErrorServiceMock.handleError.mockImplementation((error) => ({
      code: 'TEST_ERROR',
      details: error,
      message: error instanceof Error ? error.message : String(error),
    }));

    service = new ReviewApplicationService(
      prismaMock as any,
      challengeServiceMock as any,
      challengePrismaMock as any,
      resourcePrismaMock as any,
      memberServiceMock as any,
      eventBusServiceMock as any,
      prismaErrorServiceMock as any,
    );
  });

  it('assigns the Iterative Reviewer resource role for F2F iterative review approvals', async () => {
    prismaMock.reviewApplication.findUnique.mockResolvedValue({
      id: 'app-iterative',
      userId: '1001',
      handle: 'iterative-reviewer',
      role: ReviewApplicationRole.REVIEWER,
      status: ReviewApplicationStatus.PENDING,
      startDate: new Date('2026-05-26T08:33:26.579Z'),
      opportunityId: 'opp-iterative',
      createdAt: new Date('2026-05-26T08:42:54.784Z'),
      opportunity: {
        id: 'opp-iterative',
        challengeId: 'challenge-f2f',
        type: ReviewOpportunityType.REGULAR_REVIEW,
      },
    });

    challengePrismaMock.$queryRaw
      .mockResolvedValueOnce([{ shouldUseIterativeReviewerRole: true }])
      .mockResolvedValueOnce([]);
    resourcePrismaMock.resourceRole.findFirst.mockResolvedValue({
      id: 'iterative-reviewer-role-id',
      name: 'Iterative Reviewer',
    });
    challengeServiceMock.getChallengeDetail.mockResolvedValue({
      id: 'challenge-f2f',
      name: 'F2F Challenge',
    });

    await service.approve('app-iterative');

    expect(resourcePrismaMock.resourceRole.findFirst).toHaveBeenCalledWith({
      where: { name: 'Iterative Reviewer' },
    });
    expect(resourcePrismaMock.resource.create).toHaveBeenCalledWith({
      data: {
        challengeId: 'challenge-f2f',
        createdBy: 'review-api',
        memberHandle: 'iterative-reviewer',
        memberId: '1001',
        roleId: 'iterative-reviewer-role-id',
      },
    });
    expect(eventBusServiceMock.publish).toHaveBeenCalledWith(
      'challenge.action.resource.create',
      {
        id: 'resource-1',
        challengeId: 'challenge-f2f',
        memberId: '1001',
        memberHandle: 'iterative-reviewer',
        roleId: 'iterative-reviewer-role-id',
        phaseChangeNotifications: true,
        created: '2026-05-27T03:49:10.279Z',
        createdBy: 'review-api',
        updated: undefined,
        updatedBy: undefined,
        roleName: 'Iterative Reviewer',
      },
    );
    expect(prismaMock.reviewApplication.update).toHaveBeenCalledWith({
      where: { id: 'app-iterative' },
      data: {
        status: ReviewApplicationStatus.APPROVED,
      },
    });
  });

  it('keeps the regular Reviewer resource role when no F2F iterative reviewer config exists', async () => {
    prismaMock.reviewApplication.findUnique.mockResolvedValue({
      id: 'app-regular',
      userId: '1001',
      handle: 'regular-reviewer',
      role: ReviewApplicationRole.REVIEWER,
      status: ReviewApplicationStatus.PENDING,
      startDate: new Date('2026-05-26T08:33:26.579Z'),
      opportunityId: 'opp-regular',
      createdAt: new Date('2026-05-26T08:42:54.784Z'),
      opportunity: {
        id: 'opp-regular',
        challengeId: 'challenge-regular',
        type: ReviewOpportunityType.REGULAR_REVIEW,
      },
    });

    challengePrismaMock.$queryRaw
      .mockResolvedValueOnce([{ shouldUseIterativeReviewerRole: false }])
      .mockResolvedValueOnce([]);
    resourcePrismaMock.resourceRole.findFirst.mockResolvedValue({
      id: 'reviewer-role-id',
      name: 'Reviewer',
    });
    challengeServiceMock.getChallengeDetail.mockResolvedValue({
      id: 'challenge-regular',
      name: 'Regular Challenge',
    });

    await service.approve('app-regular');

    expect(resourcePrismaMock.resourceRole.findFirst).toHaveBeenCalledWith({
      where: { name: 'Reviewer' },
    });
    expect(resourcePrismaMock.resource.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        challengeId: 'challenge-regular',
        roleId: 'reviewer-role-id',
      }),
    });
    expect(eventBusServiceMock.publish).toHaveBeenCalledWith(
      'challenge.action.resource.create',
      expect.objectContaining({
        challengeId: 'challenge-regular',
        roleId: 'reviewer-role-id',
        roleName: 'Reviewer',
      }),
    );
  });

  it('includes past review assignments in rejection email payload', async () => {
    prismaMock.reviewApplication.findUnique.mockResolvedValue({
      id: 'app-1',
      userId: '1001',
      handle: 'reviewer-one',
      role: ReviewApplicationRole.REVIEWER,
      status: ReviewApplicationStatus.PENDING,
      startDate: new Date('2026-02-10T00:00:00Z'),
      opportunityId: 'opp-1',
      createdAt: new Date('2026-02-01T00:00:00Z'),
      opportunity: {
        id: 'opp-1',
        challengeId: 'challenge-current',
        type: ReviewOpportunityType.REGULAR_REVIEW,
      },
    });

    prismaMock.reviewApplication.update.mockResolvedValue({ id: 'app-1' });

    challengeServiceMock.getChallengeDetail.mockResolvedValue({
      id: 'challenge-current',
      name: 'Current Challenge',
    });

    memberServiceMock.getUserEmails.mockResolvedValue([
      { userId: '1001', email: 'reviewer@example.com', handle: 'reviewer' },
    ]);

    challengePrismaMock.$queryRaw.mockResolvedValue([
      {
        memberId: '1001',
        challengeId: 'challenge-a',
        challengeName: 'Challenge A',
        assignedAt: new Date('2026-02-01T00:00:00Z'),
      },
      {
        memberId: '1001',
        challengeId: 'challenge-b',
        challengeName: 'Challenge B',
        assignedAt: new Date('2026-01-20T00:00:00Z'),
      },
    ]);

    eventBusServiceMock.sendEmail.mockResolvedValue(undefined);

    await service.reject('app-1');

    expect(challengePrismaMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(eventBusServiceMock.sendEmail).toHaveBeenCalledTimes(1);
    expect(eventBusServiceMock.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        sendgrid_template_id: CommonConfig.sendgridConfig.rejectEmailTemplate,
        recipients: ['reviewer@example.com'],
        data: expect.objectContaining({
          handle: 'reviewer-one',
          challengeName: 'Current Challenge',
          challengeUrl:
            'https://review.topcoder.com/active-challenges/challenge-current/challenge-details',
          hasPastReviewAssignments: true,
          pastReviewAssignmentsWindowDays: 60,
          pastReviewAssignments: [
            {
              challengeId: 'challenge-a',
              challengeName: 'Challenge A',
              challengeUrl:
                'https://review.topcoder.com/active-challenges/challenge-a/challenge-details',
            },
            {
              challengeId: 'challenge-b',
              challengeName: 'Challenge B',
              challengeUrl:
                'https://review.topcoder.com/active-challenges/challenge-b/challenge-details',
            },
          ],
        }),
      }),
    );
  });

  it('sends empty assignment report when reviewer has no recent assignments', async () => {
    prismaMock.reviewApplication.findUnique.mockResolvedValue({
      id: 'app-2',
      userId: '1002',
      handle: 'reviewer-two',
      role: ReviewApplicationRole.REVIEWER,
      status: ReviewApplicationStatus.PENDING,
      startDate: new Date('2026-02-11T00:00:00Z'),
      opportunityId: 'opp-2',
      createdAt: new Date('2026-02-01T00:00:00Z'),
      opportunity: {
        id: 'opp-2',
        challengeId: 'challenge-current-2',
        type: ReviewOpportunityType.REGULAR_REVIEW,
      },
    });

    prismaMock.reviewApplication.update.mockResolvedValue({ id: 'app-2' });

    challengeServiceMock.getChallengeDetail.mockResolvedValue({
      id: 'challenge-current-2',
      name: 'Current Challenge 2',
    });

    memberServiceMock.getUserEmails.mockResolvedValue([
      { userId: '1002', email: 'reviewer2@example.com', handle: 'reviewer2' },
    ]);

    challengePrismaMock.$queryRaw.mockResolvedValue([]);

    eventBusServiceMock.sendEmail.mockResolvedValue(undefined);

    await service.reject('app-2');

    expect(eventBusServiceMock.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          hasPastReviewAssignments: false,
          pastReviewAssignmentsWindowDays: 60,
          pastReviewAssignments: [],
        }),
      }),
    );
  });

  it('returns a filtered current-user application page with a total', async () => {
    prismaMock.reviewApplication.findMany.mockResolvedValue([
      {
        id: 'app-1',
        opportunityId: 'opportunity-1',
        userId: '1001',
        handle: 'reviewer-one',
        role: ReviewApplicationRole.REVIEWER,
        status: ReviewApplicationStatus.PENDING,
        createdAt: new Date('2026-08-10T00:00:00Z'),
      },
    ]);
    prismaMock.reviewApplication.count.mockResolvedValue(11);

    const result = await service.listByUserPaginated('1001', {
      statuses: [ReviewApplicationStatus.PENDING],
      page: 2,
      perPage: 10,
      sortOrder: 'desc',
    });

    expect(prismaMock.reviewApplication.findMany).toHaveBeenCalledWith({
      where: {
        userId: '1001',
        status: { in: [ReviewApplicationStatus.PENDING] },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: 10,
      take: 10,
    });
    expect(result.metadata).toEqual({
      total: 11,
      page: 2,
      perPage: 10,
      totalPages: 2,
    });
  });

  it.each(['whitelist', 'group', 'task'])(
    'does not expose applications for an anonymous caller blocked by a %s restriction',
    async (restriction) => {
      prismaMock.reviewOpportunity.findUnique.mockResolvedValue({
        challengeId: `challenge-hidden-${restriction}`,
      });
      challengeServiceMock.ensureChallengeWhitelistAccess.mockRejectedValueOnce(
        new ForbiddenException('Challenge is hidden'),
      );

      await expect(
        service.listByOpportunity(`opportunity-hidden-${restriction}`),
      ).rejects.toMatchObject({
        status: 404,
        response: {
          message: 'Review opportunity was not found.',
          code: 'REVIEW_OPPORTUNITY_NOT_FOUND',
        },
      });

      expect(
        challengeServiceMock.ensureChallengeWhitelistAccess,
      ).toHaveBeenCalledWith(undefined, `challenge-hidden-${restriction}`);
      expect(prismaMock.reviewApplication.findMany).not.toHaveBeenCalled();
      expect(challengePrismaMock.$queryRaw).not.toHaveBeenCalled();
    },
  );

  it('returns 404 before challenge or applicant queries for a missing opportunity', async () => {
    prismaMock.reviewOpportunity.findUnique.mockResolvedValue(null);

    await expect(
      service.listByOpportunity('opportunity-missing'),
    ).rejects.toMatchObject({
      status: 404,
      response: {
        message: 'Review opportunity was not found.',
        code: 'REVIEW_OPPORTUNITY_NOT_FOUND',
      },
    });

    expect(
      challengeServiceMock.ensureChallengeWhitelistAccess,
    ).not.toHaveBeenCalled();
    expect(prismaMock.reviewApplication.findMany).not.toHaveBeenCalled();
    expect(challengePrismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  it('keeps anonymous access for a visible public opportunity', async () => {
    prismaMock.reviewOpportunity.findUnique.mockResolvedValue({
      challengeId: 'challenge-public',
    });
    prismaMock.reviewApplication.findMany.mockResolvedValue([]);

    await expect(
      service.listByOpportunity('opportunity-public'),
    ).resolves.toEqual([]);

    expect(
      challengeServiceMock.ensureChallengeWhitelistAccess,
    ).toHaveBeenCalledWith(undefined, 'challenge-public');
    expect(prismaMock.reviewApplication.findMany).toHaveBeenCalledWith({
      where: { opportunityId: 'opportunity-public' },
    });
    expect(challengePrismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  it('returns real metrics in one batch for a group member viewing an accessible opportunity', async () => {
    const authUser = {
      userId: 'group-member',
      roles: [] as any,
      isMachine: false,
    };
    prismaMock.reviewOpportunity.findUnique.mockResolvedValue({
      challengeId: 'challenge-group-visible',
    });
    prismaMock.reviewApplication.findMany.mockResolvedValue([
      {
        id: 'application-1',
        opportunityId: 'opportunity-group-visible',
        userId: '1001',
        handle: 'reviewer-one',
        role: ReviewApplicationRole.REVIEWER,
        status: ReviewApplicationStatus.PENDING,
        createdAt: new Date('2026-08-13T00:00:00Z'),
      },
      {
        id: 'application-2',
        opportunityId: 'opportunity-group-visible',
        userId: '1002',
        handle: 'reviewer-two',
        role: ReviewApplicationRole.REVIEWER,
        status: ReviewApplicationStatus.APPROVED,
        createdAt: new Date('2026-08-12T00:00:00Z'),
      },
    ]);
    challengePrismaMock.$queryRaw.mockResolvedValue([
      {
        memberId: '1001',
        openReviews: 3n,
        latestCompletedReviews: 7n,
      },
      {
        memberId: '1002',
        openReviews: 1n,
        latestCompletedReviews: 4n,
      },
    ]);

    const result = await service.listByOpportunity(
      'opportunity-group-visible',
      authUser,
    );

    expect(
      challengeServiceMock.ensureChallengeWhitelistAccess,
    ).toHaveBeenCalledWith(authUser, 'challenge-group-visible');
    expect(challengePrismaMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      expect.objectContaining({
        userId: '1001',
        openReviews: 3,
        latestCompletedReviews: 7,
      }),
      expect.objectContaining({
        userId: '1002',
        openReviews: 1,
        latestCompletedReviews: 4,
      }),
    ]);
  });

  it('accepts the Reviewer role for a scenarios review opportunity', async () => {
    prismaMock.reviewOpportunity.findUnique.mockResolvedValue({
      id: 'opportunity-scenarios',
      challengeId: 'challenge-scenarios',
      type: ReviewOpportunityType.SCENARIOS_REVIEW,
      status: 'OPEN',
      openPositions: 1,
      applications: [],
    });
    challengeServiceMock.getChallengeDetailForUser.mockResolvedValue({
      id: 'challenge-scenarios',
      status: ChallengeStatus.ACTIVE,
    });
    prismaMock.reviewApplication.findMany.mockResolvedValue([]);
    prismaMock.reviewApplication.create.mockResolvedValue({
      id: 'application-scenarios',
      opportunityId: 'opportunity-scenarios',
      userId: '1001',
      handle: 'reviewer-one',
      role: ReviewApplicationRole.REVIEWER,
      status: ReviewApplicationStatus.PENDING,
      createdAt: new Date('2026-08-13T00:00:00.000Z'),
    });

    await expect(
      service.create(
        {
          userId: '1001',
          handle: 'reviewer-one',
          roles: [] as any,
          isMachine: false,
        },
        {
          opportunityId: 'opportunity-scenarios',
          role: ReviewApplicationRole.REVIEWER,
        },
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'application-scenarios',
        role: ReviewApplicationRole.REVIEWER,
      }),
    );
  });

  it('returns conflict for one of two concurrent duplicate applications', async () => {
    prismaMock.reviewOpportunity.findUnique.mockResolvedValue({
      id: 'opportunity-concurrent',
      challengeId: 'challenge-concurrent',
      type: ReviewOpportunityType.REGULAR_REVIEW,
      status: 'OPEN',
      openPositions: 2,
      applications: [],
    });
    challengeServiceMock.getChallengeDetailForUser.mockResolvedValue({
      id: 'challenge-concurrent',
      status: ChallengeStatus.ACTIVE,
    });
    prismaMock.reviewApplication.findMany.mockResolvedValue([]);

    const uniqueConstraintError = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`opportunityId`,`userId`,`role`)',
      {
        code: 'P2002',
        clientVersion: '6.19.3',
        meta: {
          modelName: 'reviewApplication',
          target: ['opportunityId', 'userId', 'role'],
        },
      },
    );
    let insertCount = 0;
    prismaMock.reviewApplication.create.mockImplementation(() => {
      insertCount += 1;
      if (insertCount === 1) {
        return Promise.resolve({
          id: 'application-concurrent',
          opportunityId: 'opportunity-concurrent',
          userId: '1001',
          handle: 'reviewer-one',
          role: ReviewApplicationRole.REVIEWER,
          status: ReviewApplicationStatus.PENDING,
          createdAt: new Date('2026-08-13T00:00:00.000Z'),
        });
      }
      return Promise.reject(uniqueConstraintError);
    });

    const authUser = {
      userId: '1001',
      handle: 'reviewer-one',
      roles: [] as any,
      isMachine: false,
    };
    const dto = {
      opportunityId: 'opportunity-concurrent',
      role: ReviewApplicationRole.REVIEWER,
    };
    const results = await Promise.allSettled([
      service.create(authUser, dto),
      service.create(authUser, dto),
    ]);

    expect(results[0]).toEqual(
      expect.objectContaining({ status: 'fulfilled' }),
    );
    expect(results[1]).toEqual(expect.objectContaining({ status: 'rejected' }));
    const rejectedResult = results[1] as PromiseRejectedResult;
    expect(rejectedResult.reason).toBeInstanceOf(ConflictException);
    expect((rejectedResult.reason as ConflictException).getStatus()).toBe(409);
    expect((rejectedResult.reason as ConflictException).getResponse()).toEqual(
      expect.objectContaining({
        message:
          'User 1001 has already submitted an application for opportunity opportunity-concurrent with role REVIEWER',
      }),
    );
    expect(prismaMock.reviewApplication.findMany).toHaveBeenCalledTimes(2);
    expect(prismaMock.reviewApplication.create).toHaveBeenCalledTimes(2);
    expect(prismaErrorServiceMock.handleError).not.toHaveBeenCalled();
  });

  it('rejects member apply when approved applications fill capacity', async () => {
    prismaMock.reviewOpportunity.findUnique.mockResolvedValue({
      id: 'opportunity-full',
      challengeId: 'challenge-full',
      type: ReviewOpportunityType.REGULAR_REVIEW,
      status: 'OPEN',
      openPositions: 1,
      applications: [{ status: ReviewApplicationStatus.APPROVED }],
    });
    challengeServiceMock.getChallengeDetailForUser.mockResolvedValue({
      id: 'challenge-full',
      status: ChallengeStatus.ACTIVE,
    });

    await expect(
      service.create(
        {
          userId: '1002',
          handle: 'reviewer-two',
          roles: [] as any,
          isMachine: false,
        },
        {
          opportunityId: 'opportunity-full',
          role: ReviewApplicationRole.REVIEWER,
        },
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        response: {
          message: 'All reviewer positions have been filled.',
          code: 'REVIEW_OPPORTUNITY_FULL',
        },
      }),
    );
    expect(prismaMock.reviewApplication.create).not.toHaveBeenCalled();
  });
});
