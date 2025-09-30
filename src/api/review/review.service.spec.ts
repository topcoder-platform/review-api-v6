jest.mock('nanoid', () => ({
  __esModule: true,
  nanoid: () => 'mock-nanoid',
}));

import { ReviewService } from './review.service';
import { ReviewRequestDto, ReviewStatus } from 'src/dto/review.dto';
import { JwtUser } from 'src/shared/modules/global/jwt.service';
import { ChallengeStatus } from 'src/shared/enums/challengeStatus.enum';
import { UserRole } from 'src/shared/enums/userRole.enum';
import { CommonConfig } from 'src/shared/config/common.config';

describe('ReviewService.createReview authorization checks', () => {
  const prismaMock = {
    scorecard: {
      findUnique: jest.fn(),
    },
    submission: {
      findUnique: jest.fn(),
    },
    review: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    reviewItem: {
      findMany: jest.fn(),
    },
    reviewAudit: {
      create: jest.fn(),
    },
  } as unknown as any;

  const prismaErrorServiceMock = {
    handleError: jest.fn(),
  } as unknown as any;

  const resourceApiServiceMock = {
    getResources: jest.fn(),
    getMemberResourcesRoles: jest.fn(),
  } as unknown as any;

  const resourcePrismaMock = {
    resource: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as unknown as any;

  const memberPrismaMock = {
    member: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as unknown as any;

  const challengeApiServiceMock = {
    validateReviewSubmission: jest.fn(),
    getChallengeDetail: jest.fn(),
  } as unknown as any;

  const eventBusServiceMock = {
    publish: jest.fn(),
    sendEmail: jest.fn(),
  } as unknown as any;

  const service = new ReviewService(
    prismaMock,
    prismaErrorServiceMock,
    resourceApiServiceMock,
    resourcePrismaMock,
    memberPrismaMock,
    challengeApiServiceMock,
    eventBusServiceMock,
  );

  const baseAuthUser: JwtUser = {
    userId: 'user-123',
    roles: [],
    isMachine: false,
  };

  const buildReviewRequest = (
    overrides: Partial<ReviewRequestDto> = {},
  ): ReviewRequestDto =>
    ({
      id: 'review-1',
      submissionId: 'submission-1',
      scorecardId: 'scorecard-1',
      typeId: 'type-1',
      metadata: {},
      status: ReviewStatus.PENDING,
      reviewDate: new Date().toISOString(),
      committed: false,
      reviewItems: [],
      ...overrides,
    }) as ReviewRequestDto;

  const baseChallengeDetail = {
    id: 'challenge-1',
    name: 'Challenge',
    status: ChallengeStatus.ACTIVE,
    track: 'Development',
    legacyId: 1001,
    phases: [
      {
        id: 'phase-review',
        name: 'Review',
        isOpen: true,
      },
    ],
  };

  const baseResource = {
    id: 'resource-1',
    challengeId: 'challenge-1',
    memberId: 'user-123',
    memberHandle: 'handle',
    roleId: 'role-reviewer',
    phaseId: 'phase-review',
    createdBy: 'tc',
    created: new Date().toISOString(),
  };

  beforeEach(() => {
    jest.resetAllMocks();

    prismaMock.scorecard.findUnique.mockResolvedValue({
      id: 'scorecard-1',
      scorecardGroups: [],
      minScore: 0,
      minimumPassingScore: 0,
      maxScore: 100,
    });
    prismaMock.submission.findUnique.mockResolvedValue({
      id: 'submission-1',
      challengeId: 'challenge-1',
    });

    challengeApiServiceMock.validateReviewSubmission.mockResolvedValue(null);
    challengeApiServiceMock.getChallengeDetail.mockResolvedValue(
      baseChallengeDetail,
    );

    resourceApiServiceMock.getResources.mockResolvedValue([baseResource]);
    resourceApiServiceMock.getMemberResourcesRoles.mockResolvedValue([
      {
        ...baseResource,
        roleName: 'Reviewer',
      },
    ]);
  });

  it('throws when resource does not belong to non-admin user', async () => {
    const request = buildReviewRequest({ resourceId: 'resource-1' });
    resourceApiServiceMock.getResources.mockResolvedValue([
      {
        ...baseResource,
        memberId: 'someone-else',
      },
    ]);

    await expect(
      service.createReview(baseAuthUser, request),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'RESOURCE_MEMBER_MISMATCH' }),
      status: 403,
    });
  });

  it('throws when challenge does not have a Review phase', async () => {
    challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
      ...baseChallengeDetail,
      phases: [
        {
          id: 'phase-review',
          name: 'Submission',
          isOpen: true,
        },
      ],
    });

    await expect(
      service.createReview(baseAuthUser, buildReviewRequest()),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'REVIEW_PHASE_NOT_FOUND',
      }),
      status: 400,
    });
  });

  it('throws when resource phase does not match the requested phase', async () => {
    const request = buildReviewRequest({ resourceId: 'resource-1' });
    resourceApiServiceMock.getResources.mockResolvedValue([
      {
        ...baseResource,
        phaseId: 'phase-iterative',
      },
    ]);

    await expect(
      service.createReview(baseAuthUser, request),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'RESOURCE_PHASE_MISMATCH' }),
      status: 400,
    });
  });

  it('throws when no reviewer resource can be inferred for the requester', async () => {
    resourceApiServiceMock.getMemberResourcesRoles.mockResolvedValue([]);

    await expect(
      service.createReview(baseAuthUser, buildReviewRequest()),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'FORBIDDEN_CREATE_REVIEW' }),
      status: 403,
    });
  });

  it('publishes completion event when review is created with COMPLETED status', async () => {
    const reviewDate = new Date('2024-01-01T12:00:00Z');
    prismaMock.review.create.mockResolvedValue({
      id: 'review-1',
      resourceId: baseResource.id,
      phaseId: 'phase-review',
      submissionId: 'submission-1',
      scorecardId: 'scorecard-1',
      typeId: 'type-1',
      metadata: {},
      status: ReviewStatus.COMPLETED,
      reviewDate,
      committed: true,
      initialScore: null,
      finalScore: null,
      reviewItems: [],
    });

    prismaMock.review.findUnique.mockResolvedValue({
      id: 'review-1',
      submissionId: 'submission-1',
      scorecardId: 'scorecard-1',
      resourceId: baseResource.id,
      phaseId: 'phase-review',
      status: ReviewStatus.COMPLETED,
      reviewDate,
      initialScore: 88.5,
      updatedAt: new Date('2024-01-01T12:05:00Z'),
      submission: {
        challengeId: 'challenge-1',
        memberId: 'submitter-123',
      },
    });

    resourceApiServiceMock.getResources.mockResolvedValue([
      baseResource,
      {
        id: 'resource-2',
        challengeId: 'challenge-1',
        memberId: 'submitter-123',
        memberHandle: 'submitterHandle',
        roleId: 'submitter-role',
        phaseId: null,
        createdBy: 'tc',
        created: new Date().toISOString(),
      },
    ]);

    const computeSpy = jest
      .spyOn(service as any, 'computeScoresFromItems')
      .mockResolvedValue({ initialScore: null, finalScore: null });

    try {
      await service.createReview(
        baseAuthUser,
        buildReviewRequest({
          status: ReviewStatus.COMPLETED,
          committed: true,
        }),
      );
    } finally {
      computeSpy.mockRestore();
    }

    expect(eventBusServiceMock.publish).toHaveBeenCalledTimes(1);
    expect(eventBusServiceMock.publish).toHaveBeenCalledWith(
      'review.action.completed',
      expect.objectContaining({
        challengeId: 'challenge-1',
        submissionId: 'submission-1',
        phaseId: 'phase-review',
        reviewId: 'review-1',
        scorecardId: 'scorecard-1',
        reviewerResourceId: baseResource.id,
        reviewerHandle: baseResource.memberHandle,
        reviewerMemberId: baseResource.memberId,
        submitterHandle: 'submitterHandle',
        submitterMemberId: 'submitter-123',
        completedAt: reviewDate.toISOString(),
        initialScore: 88.5,
      }),
    );
  });

  it('derives the Review phase id from the challenge when creating a review', async () => {
    const request = buildReviewRequest();
    const reviewCreateResult = {
      id: request.id,
      resourceId: baseResource.id,
      phaseId: 'phase-review',
      submissionId: request.submissionId,
      scorecardId: request.scorecardId,
      typeId: request.typeId,
      metadata: request.metadata,
      status: request.status,
      reviewDate: new Date(request.reviewDate),
      committed: request.committed,
      initialScore: null,
      finalScore: null,
      reviewItems: [],
    } as any;

    prismaMock.review.create.mockResolvedValue(reviewCreateResult);
    prismaMock.review.update.mockResolvedValue({
      ...reviewCreateResult,
      initialScore: 0,
      finalScore: 0,
    });

    await expect(
      service.createReview(baseAuthUser, request),
    ).resolves.toMatchObject({ phaseId: 'phase-review' });

    expect(prismaMock.review.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          phaseId: 'phase-review',
          resourceId: baseResource.id,
        }),
      }),
    );
  });

  it('falls back to the Iterative Review phase when a Review phase is not present', async () => {
    const request = buildReviewRequest();
    const reviewCreateResult = {
      id: request.id,
      resourceId: baseResource.id,
      phaseId: 'phase-iterative',
      submissionId: request.submissionId,
      scorecardId: request.scorecardId,
      typeId: request.typeId,
      metadata: request.metadata,
      status: request.status,
      reviewDate: new Date(request.reviewDate),
      committed: request.committed,
      initialScore: null,
      finalScore: null,
      reviewItems: [],
    } as any;

    challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
      ...baseChallengeDetail,
      phases: [
        {
          id: 'phase-iterative',
          name: 'Iterative Review',
          isOpen: true,
        },
      ],
    });

    resourceApiServiceMock.getResources.mockResolvedValue([
      {
        ...baseResource,
        phaseId: 'phase-iterative',
      },
    ]);
    resourceApiServiceMock.getMemberResourcesRoles.mockResolvedValue([
      {
        ...baseResource,
        phaseId: 'phase-iterative',
        roleName: 'Reviewer',
      },
    ]);

    prismaMock.review.create.mockResolvedValue(reviewCreateResult);
    prismaMock.review.update.mockResolvedValue({
      ...reviewCreateResult,
      initialScore: 0,
      finalScore: 0,
    });

    await expect(
      service.createReview(baseAuthUser, request),
    ).resolves.toMatchObject({ phaseId: 'phase-iterative' });

    expect(prismaMock.review.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          phaseId: 'phase-iterative',
          resourceId: baseResource.id,
        }),
      }),
    );
  });
});

describe('ReviewService.getReview authorization checks', () => {
  const prismaMock = {
    review: {
      findUniqueOrThrow: jest.fn(),
    },
    submission: {
      findMany: jest.fn(),
    },
  } as unknown as any;

  const prismaErrorServiceMock = {
    handleError: jest.fn(),
  } as unknown as any;

  const resourceApiServiceMock = {
    getMemberResourcesRoles: jest.fn(),
  } as unknown as any;

  const resourcePrismaMock = {
    resource: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as unknown as any;

  const memberPrismaMock = {
    member: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as unknown as any;

  const challengeApiServiceMock = {
    getChallengeDetail: jest.fn(),
  } as unknown as any;

  const eventBusServiceMock = {
    publish: jest.fn(),
    sendEmail: jest.fn(),
  } as unknown as any;

  const service = new ReviewService(
    prismaMock,
    prismaErrorServiceMock,
    resourceApiServiceMock,
    resourcePrismaMock,
    memberPrismaMock,
    challengeApiServiceMock,
    eventBusServiceMock,
  );

  const baseAuthUser: JwtUser = {
    userId: 'reviewer-123',
    roles: [],
    isMachine: false,
  };

  const defaultReviewData = () => ({
    id: 'review-1',
    resourceId: 'resource-1',
    committed: false,
    createdAt: new Date(),
    createdBy: 'system',
    updatedAt: new Date(),
    updatedBy: 'system',
    finalScore: null,
    initialScore: null,
    reviewItems: [],
    scorecardId: 'scorecard-1',
    submission: {
      id: 'submission-1',
      challengeId: 'challenge-1',
      memberId: 'submitter-1',
    },
  });

  const baseReviewerResource = {
    id: 'resource-1',
    challengeId: 'challenge-1',
    memberId: 'reviewer-123',
    memberHandle: 'reviewerHandle',
    roleId: 'role-reviewer',
    phaseId: 'phase-review',
    createdBy: 'tc',
    created: new Date().toISOString(),
    roleName: 'Reviewer',
  };

  beforeEach(() => {
    jest.resetAllMocks();

    prismaMock.review.findUniqueOrThrow.mockImplementation(() =>
      Promise.resolve(defaultReviewData()),
    );
    prismaMock.submission.findMany.mockResolvedValue([]);

    challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
      id: 'challenge-1',
      status: ChallengeStatus.ACTIVE,
      phases: [],
    });

    resourceApiServiceMock.getMemberResourcesRoles.mockResolvedValue([
      baseReviewerResource,
    ]);
  });

  it('blocks reviewers from accessing reviews that are not their own before completion', async () => {
    prismaMock.review.findUniqueOrThrow.mockImplementation(() =>
      Promise.resolve({
        ...defaultReviewData(),
        resourceId: 'resource-other',
      }),
    );

    await expect(
      service.getReview(baseAuthUser, 'review-1'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'FORBIDDEN_REVIEW_ACCESS_REVIEWER_SELF',
      }),
      status: 403,
    });
  });

  it('allows reviewers to access non-owned reviews once the challenge is completed', async () => {
    challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
      id: 'challenge-1',
      status: ChallengeStatus.COMPLETED,
      phases: [],
    });

    prismaMock.review.findUniqueOrThrow.mockImplementation(() =>
      Promise.resolve({
        ...defaultReviewData(),
        resourceId: 'resource-other',
      }),
    );

    await expect(
      service.getReview(baseAuthUser, 'review-1'),
    ).resolves.toMatchObject({ id: 'review-1', resourceId: 'resource-other' });
  });

  it('allows reviewers to access their own review before completion', async () => {
    prismaMock.review.findUniqueOrThrow.mockImplementation(() =>
      Promise.resolve({
        ...defaultReviewData(),
        resourceId: 'resource-1',
      }),
    );

    await expect(
      service.getReview(baseAuthUser, 'review-1'),
    ).resolves.toMatchObject({ id: 'review-1', resourceId: 'resource-1' });
  });

  it('blocks submitters from accessing reviews before appeals or iterative review completion', async () => {
    const submitterUser: JwtUser = {
      userId: 'submitter-1',
      roles: [UserRole.Submitter],
      isMachine: false,
    };

    prismaMock.review.findUniqueOrThrow.mockResolvedValue({
      ...defaultReviewData(),
      submission: {
        id: 'submission-1',
        challengeId: 'challenge-1',
        memberId: submitterUser.userId,
      },
    });

    resourceApiServiceMock.getMemberResourcesRoles.mockResolvedValue([
      {
        ...baseReviewerResource,
        id: 'resource-submit',
        memberId: submitterUser.userId,
        roleName: 'Submitter',
        roleId: CommonConfig.roles.submitterRoleId,
      },
    ]);

    prismaMock.submission.findMany.mockImplementation(({ where }: any) => {
      if (where?.memberId) {
        return Promise.resolve([{ id: 'submission-1' }]);
      }
      return Promise.resolve([{ id: 'submission-1' }]);
    });

    challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
      id: 'challenge-1',
      status: ChallengeStatus.ACTIVE,
      phases: [
        { id: 'phase-sub', name: 'Submission', isOpen: false },
        { id: 'phase-review', name: 'Review', isOpen: false },
      ],
    });

    await expect(
      service.getReview(submitterUser, 'review-1'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'FORBIDDEN_REVIEW_ACCESS_PHASE',
      }),
      status: 403,
    });
  });

  it('allows submitters to access their review once iterative review closes without appeals', async () => {
    const submitterUser: JwtUser = {
      userId: 'submitter-1',
      roles: [UserRole.Submitter],
      isMachine: false,
    };

    prismaMock.review.findUniqueOrThrow.mockResolvedValue({
      ...defaultReviewData(),
      submission: {
        id: 'submission-1',
        challengeId: 'challenge-1',
        memberId: submitterUser.userId,
      },
    });

    resourceApiServiceMock.getMemberResourcesRoles.mockResolvedValue([
      {
        ...baseReviewerResource,
        id: 'resource-submit',
        memberId: submitterUser.userId,
        roleName: 'Submitter',
        roleId: CommonConfig.roles.submitterRoleId,
      },
    ]);

    prismaMock.submission.findMany.mockImplementation(({ where }: any) => {
      if (where?.memberId) {
        return Promise.resolve([{ id: 'submission-1' }]);
      }
      return Promise.resolve([{ id: 'submission-1' }]);
    });

    challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
      id: 'challenge-1',
      status: ChallengeStatus.ACTIVE,
      phases: [
        { id: 'phase-sub', name: 'Submission', isOpen: false },
        { id: 'phase-iter', name: 'Iterative Review', isOpen: false },
      ],
    });

    await expect(
      service.getReview(submitterUser, 'review-1'),
    ).resolves.toMatchObject({ id: 'review-1' });
  });
});

describe('ReviewService.getReviews reviewer visibility', () => {
  let prismaMock: any;
  let prismaErrorServiceMock: any;
  let resourceApiServiceMock: any;
  let resourcePrismaMock: any;
  let memberPrismaMock: any;
  let challengeApiServiceMock: any;
  let eventBusServiceMock: any;
  let service: ReviewService;

  const baseAuthUser: JwtUser = {
    userId: 'reviewer-1',
    roles: [],
    isMachine: false,
  };

  const baseSubmission = { id: 'submission-1' };

  const buildResource = (roleName: string, memberId = baseAuthUser.userId) => ({
    id: 'resource-1',
    challengeId: 'challenge-1',
    memberId,
    memberHandle: 'reviewerHandle',
    roleId: 'role-reviewer',
    phaseId: 'phase-review',
    createdBy: 'tc',
    created: new Date().toISOString(),
    roleName,
  });

  beforeEach(() => {
    jest.resetAllMocks();

    prismaMock = {
      submission: {
        findMany: jest.fn().mockResolvedValue([baseSubmission]),
      },
      review: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };

    prismaErrorServiceMock = {
      handleError: jest.fn(),
    };

    resourceApiServiceMock = {
      getMemberResourcesRoles: jest.fn(),
    };

    challengeApiServiceMock = {
      getChallengeDetail: jest.fn(),
      getChallenges: jest.fn(),
    };

    eventBusServiceMock = {
      publish: jest.fn(),
      sendEmail: jest.fn(),
    };

    resourcePrismaMock = {
      resource: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    memberPrismaMock = {
      member: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    service = new ReviewService(
      prismaMock,
      prismaErrorServiceMock,
      resourceApiServiceMock,
      resourcePrismaMock,
      memberPrismaMock,
      challengeApiServiceMock,
      eventBusServiceMock,
    );
  });

  it('filters reviews by the reviewer resource id when the requester is a reviewer', async () => {
    resourceApiServiceMock.getMemberResourcesRoles.mockResolvedValue([
      buildResource('Reviewer'),
    ]);

    await service.getReviews(baseAuthUser, undefined, 'challenge-1');

    expect(resourceApiServiceMock.getMemberResourcesRoles).toHaveBeenCalledWith(
      'challenge-1',
      baseAuthUser.userId,
    );

    expect(prismaMock.review.findMany).toHaveBeenCalledTimes(1);
    const callArgs = prismaMock.review.findMany.mock.calls[0][0];
    expect(callArgs.where.resourceId).toEqual({ in: ['resource-1'] });
    expect(callArgs.where.submissionId).toEqual({ in: [baseSubmission.id] });
  });

  it('does not restrict resource visibility for copilots', async () => {
    resourceApiServiceMock.getMemberResourcesRoles.mockResolvedValue([
      buildResource('Copilot'),
    ]);

    await service.getReviews(baseAuthUser, undefined, 'challenge-1');

    const callArgs = prismaMock.review.findMany.mock.calls[0][0];
    expect(callArgs.where.resourceId).toBeUndefined();
  });

  it('restricts submitters to their own submissions when submission phase is closed on an active challenge', async () => {
    const submitterResource = {
      ...buildResource('Submitter'),
      roleId: CommonConfig.roles.submitterRoleId,
    };

    resourceApiServiceMock.getMemberResourcesRoles.mockResolvedValue([
      submitterResource,
    ]);

    challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
      id: 'challenge-1',
      name: 'Challenge Active',
      status: ChallengeStatus.ACTIVE,
      phases: [
        { id: 'phase-sub', name: 'Submission', isOpen: false },
        { id: 'phase-review', name: 'Review', isOpen: false },
      ],
    });

    prismaMock.submission.findMany.mockImplementation(({ where }: any) => {
      if (where?.memberId) {
        return Promise.resolve([baseSubmission]);
      }
      return Promise.resolve([baseSubmission, { id: 'submission-other' }]);
    });

    await service.getReviews(baseAuthUser, undefined, 'challenge-1');

    const callArgs = prismaMock.review.findMany.mock.calls[0][0];
    expect(callArgs.where.submissionId).toEqual({ in: [baseSubmission.id] });
  });

  it('masks scores and review items for submitters before appeals open', async () => {
    const now = new Date();
    const submitterResource = {
      ...buildResource('Submitter'),
      roleId: CommonConfig.roles.submitterRoleId,
    };

    resourceApiServiceMock.getMemberResourcesRoles.mockResolvedValue([
      submitterResource,
    ]);

    challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
      id: 'challenge-1',
      name: 'Active Challenge',
      status: ChallengeStatus.ACTIVE,
      phases: [
        { id: 'phase-sub', name: 'Submission', isOpen: false },
        { id: 'phase-review', name: 'Review', isOpen: false },
      ],
    });

    prismaMock.submission.findMany.mockImplementation(({ where }: any) => {
      if (where?.memberId) {
        return Promise.resolve([baseSubmission]);
      }
      return Promise.resolve([baseSubmission]);
    });

    const reviewRecord = {
      id: 'review-1',
      resourceId: 'resource-reviewer',
      submissionId: baseSubmission.id,
      phaseId: 'phase-1',
      scorecardId: 'scorecard-1',
      typeId: 'type-1',
      status: ReviewStatus.COMPLETED,
      reviewDate: now,
      committed: true,
      metadata: null,
      reviewItems: [
        {
          id: 'item-1',
          scorecardQuestionId: 'question-1',
          initialAnswer: 'Yes',
          finalAnswer: 'No',
          managerComment: null,
          createdAt: now,
          createdBy: 'reviewer',
          updatedAt: now,
          updatedBy: 'reviewer',
          reviewItemComments: [],
        },
      ],
      createdAt: now,
      createdBy: 'creator',
      updatedAt: now,
      updatedBy: 'updater',
      finalScore: 88.5,
      initialScore: 85.0,
      submission: {
        id: baseSubmission.id,
        memberId: baseAuthUser.userId,
        challengeId: 'challenge-1',
      },
    };

    prismaMock.review.findMany.mockResolvedValue([reviewRecord]);
    prismaMock.review.count.mockResolvedValue(1);

    const response = await service.getReviews(
      baseAuthUser,
      undefined,
      'challenge-1',
    );

    expect(response.data[0].finalScore).toBeNull();
    expect(response.data[0].initialScore).toBeNull();
    expect(response.data[0].reviewItems).toEqual([]);
  });

  it('returns scores for submitters once appeals are open', async () => {
    const now = new Date();
    const submitterResource = {
      ...buildResource('Submitter'),
      roleId: CommonConfig.roles.submitterRoleId,
    };

    resourceApiServiceMock.getMemberResourcesRoles.mockResolvedValue([
      submitterResource,
    ]);

    challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
      id: 'challenge-1',
      name: 'Active Challenge',
      status: ChallengeStatus.ACTIVE,
      phases: [
        { id: 'phase-sub', name: 'Submission', isOpen: false },
        { id: 'phase-appeals', name: 'Appeals', isOpen: true },
      ],
    });

    prismaMock.submission.findMany.mockImplementation(({ where }: any) => {
      if (where?.memberId) {
        return Promise.resolve([baseSubmission]);
      }
      return Promise.resolve([baseSubmission]);
    });

    const reviewRecord = {
      id: 'review-1',
      resourceId: 'resource-reviewer',
      submissionId: baseSubmission.id,
      phaseId: 'phase-1',
      scorecardId: 'scorecard-1',
      typeId: 'type-1',
      status: ReviewStatus.COMPLETED,
      reviewDate: now,
      committed: true,
      metadata: null,
      reviewItems: [
        {
          id: 'item-1',
          scorecardQuestionId: 'question-1',
          initialAnswer: 'Yes',
          finalAnswer: 'No',
          managerComment: null,
          createdAt: now,
          createdBy: 'reviewer',
          updatedAt: now,
          updatedBy: 'reviewer',
          reviewItemComments: [],
        },
      ],
      createdAt: now,
      createdBy: 'creator',
      updatedAt: now,
      updatedBy: 'updater',
      finalScore: 92.3,
      initialScore: 89.7,
      submission: {
        id: baseSubmission.id,
        memberId: baseAuthUser.userId,
        challengeId: 'challenge-1',
      },
    };

    prismaMock.review.findMany.mockResolvedValue([reviewRecord]);
    prismaMock.review.count.mockResolvedValue(1);

    const response = await service.getReviews(
      baseAuthUser,
      undefined,
      'challenge-1',
    );

    expect(response.data[0].finalScore).toBe(92.3);
    expect(response.data[0].initialScore).toBe(89.7);
    expect(response.data[0].reviewItems).toHaveLength(1);
  });

  it('returns scores for submitters when iterative review is closed and no appeals phases exist', async () => {
    const now = new Date();
    const submitterResource = {
      ...buildResource('Submitter'),
      roleId: CommonConfig.roles.submitterRoleId,
    };

    resourceApiServiceMock.getMemberResourcesRoles.mockResolvedValue([
      submitterResource,
    ]);

    challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
      id: 'challenge-1',
      name: 'First2Finish Challenge',
      status: ChallengeStatus.ACTIVE,
      phases: [
        { id: 'phase-sub', name: 'Submission', isOpen: false },
        { id: 'phase-iter', name: 'Iterative Review', isOpen: false },
      ],
    });

    prismaMock.submission.findMany.mockImplementation(({ where }: any) => {
      if (where?.memberId) {
        return Promise.resolve([baseSubmission]);
      }
      return Promise.resolve([baseSubmission]);
    });

    const reviewRecord = {
      id: 'review-1',
      resourceId: 'resource-reviewer',
      submissionId: baseSubmission.id,
      phaseId: 'phase-1',
      scorecardId: 'scorecard-1',
      typeId: 'type-1',
      status: ReviewStatus.COMPLETED,
      reviewDate: now,
      committed: true,
      metadata: null,
      reviewItems: [
        {
          id: 'item-1',
          scorecardQuestionId: 'question-1',
          initialAnswer: 'Yes',
          finalAnswer: 'Yes',
          managerComment: null,
          createdAt: now,
          createdBy: 'reviewer',
          updatedAt: now,
          updatedBy: 'reviewer',
          reviewItemComments: [],
        },
      ],
      createdAt: now,
      createdBy: 'creator',
      updatedAt: now,
      updatedBy: 'updater',
      finalScore: 100,
      initialScore: 100,
      submission: {
        id: baseSubmission.id,
        memberId: baseAuthUser.userId,
        challengeId: 'challenge-1',
      },
    };

    prismaMock.review.findMany.mockResolvedValue([reviewRecord]);
    prismaMock.review.count.mockResolvedValue(1);

    const response = await service.getReviews(
      baseAuthUser,
      undefined,
      'challenge-1',
    );

    expect(response.data[0].finalScore).toBe(100);
    expect(response.data[0].initialScore).toBe(100);
    expect(response.data[0].reviewItems).toHaveLength(1);
  });

  it('enriches reviewer metadata when member data is available', async () => {
    const now = new Date();

    const reviewRecord = {
      id: 'review-1',
      resourceId: 'resource-1',
      submissionId: baseSubmission.id,
      phaseId: 'phase-1',
      scorecardId: 'scorecard-1',
      typeId: 'type-1',
      status: ReviewStatus.COMPLETED,
      reviewDate: now,
      committed: true,
      metadata: null,
      reviewItems: [],
      createdAt: now,
      createdBy: 'creator',
      updatedAt: now,
      updatedBy: 'updater',
      finalScore: 93,
      initialScore: 91,
    };

    prismaMock.review.findMany.mockResolvedValue([reviewRecord]);
    prismaMock.review.count.mockResolvedValue(1);

    const numericReviewer: JwtUser = {
      ...baseAuthUser,
      userId: '123',
    };

    resourceApiServiceMock.getMemberResourcesRoles.mockResolvedValue([
      buildResource('Reviewer', '123'),
    ]);

    resourcePrismaMock.resource.findMany.mockResolvedValue([
      { id: 'resource-1', memberId: '123' },
    ]);

    memberPrismaMock.member.findMany.mockResolvedValue([
      {
        userId: BigInt(123),
        handle: 'reviewer123',
        maxRating: { rating: 2760 },
      },
    ]);

    const response = await service.getReviews(
      numericReviewer,
      undefined,
      'challenge-1',
    );

    expect(response.data[0]).toMatchObject({
      id: 'review-1',
      reviewerHandle: 'reviewer123',
      reviewerMaxRating: 2760,
    });
    expect(resourcePrismaMock.resource.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['resource-1'] } },
      select: { id: true, memberId: true },
    });
    expect(memberPrismaMock.member.findMany).toHaveBeenCalledWith({
      where: { userId: { in: [BigInt(123)] } },
      select: {
        userId: true,
        handle: true,
        maxRating: { select: { rating: true } },
      },
    });
  });

  it('includes submitter metadata for completed challenges when requester is a challenge resource', async () => {
    const now = new Date();
    const reviewRecord = {
      id: 'review-1',
      resourceId: 'resource-1',
      submissionId: baseSubmission.id,
      phaseId: 'phase-1',
      scorecardId: 'scorecard-1',
      typeId: 'type-1',
      status: ReviewStatus.COMPLETED,
      reviewDate: now,
      committed: true,
      metadata: null,
      reviewItems: [],
      createdAt: now,
      createdBy: 'creator',
      updatedAt: now,
      updatedBy: 'updater',
      finalScore: 90,
      initialScore: 85,
      submission: {
        id: baseSubmission.id,
        memberId: '456',
        challengeId: 'challenge-1',
      },
    };

    prismaMock.review.findMany.mockResolvedValue([reviewRecord]);
    prismaMock.review.count.mockResolvedValue(1);

    const numericReviewer: JwtUser = {
      ...baseAuthUser,
      userId: '123',
    };

    resourceApiServiceMock.getMemberResourcesRoles.mockResolvedValue([
      buildResource('Reviewer', '123'),
    ]);

    challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
      id: 'challenge-1',
      status: ChallengeStatus.COMPLETED,
      phases: [],
    });

    resourcePrismaMock.resource.findMany
      .mockResolvedValueOnce([{ id: 'resource-1', memberId: '123' }])
      .mockResolvedValueOnce([
        { memberId: '456', memberHandle: 'submitterResource' },
      ]);

    memberPrismaMock.member.findMany
      .mockResolvedValueOnce([
        {
          userId: BigInt(123),
          handle: 'reviewer123',
          maxRating: { rating: 2760 },
        },
      ])
      .mockResolvedValueOnce([
        {
          userId: BigInt(456),
          handle: 'submitterMember',
          maxRating: { rating: 1540 },
        },
      ]);

    const response = await service.getReviews(
      numericReviewer,
      undefined,
      'challenge-1',
    );

    expect(response.data[0]).toMatchObject({
      submitterHandle: 'submitterMember',
      submitterMaxRating: 1540,
    });

    expect(resourcePrismaMock.resource.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        challengeId: 'challenge-1',
        memberId: { in: ['456'] },
      },
      select: { memberId: true, memberHandle: true },
    });
    expect(memberPrismaMock.member.findMany).toHaveBeenNthCalledWith(2, {
      where: { userId: { in: [BigInt(456)] } },
      select: {
        userId: true,
        handle: true,
        maxRating: { select: { rating: true } },
      },
    });
  });

  it('includes submitter metadata for completed or cancelled challenges when requester is admin', async () => {
    const now = new Date();
    const reviewRecord = {
      id: 'review-1',
      resourceId: 'resource-1',
      submissionId: baseSubmission.id,
      phaseId: 'phase-1',
      scorecardId: 'scorecard-1',
      typeId: 'type-1',
      status: ReviewStatus.COMPLETED,
      reviewDate: now,
      committed: true,
      metadata: null,
      reviewItems: [],
      createdAt: now,
      createdBy: 'creator',
      updatedAt: now,
      updatedBy: 'updater',
      finalScore: 88,
      initialScore: 82,
      submission: {
        id: baseSubmission.id,
        memberId: '789',
        challengeId: 'challenge-1',
      },
    };

    prismaMock.review.findMany.mockResolvedValue([reviewRecord]);
    prismaMock.review.count.mockResolvedValue(1);

    const adminUser: JwtUser = {
      userId: '999',
      roles: [UserRole.Admin],
      isMachine: false,
    };

    challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
      id: 'challenge-1',
      status: ChallengeStatus.CANCELLED_FAILED_REVIEW,
      phases: [],
    });

    resourcePrismaMock.resource.findMany
      .mockResolvedValueOnce([{ id: 'resource-1', memberId: '321' }])
      .mockResolvedValueOnce([
        { memberId: '789', memberHandle: 'submitterFromResource' },
      ]);

    memberPrismaMock.member.findMany
      .mockResolvedValueOnce([
        {
          userId: BigInt(321),
          handle: 'reviewer321',
          maxRating: { rating: 2100 },
        },
      ])
      .mockResolvedValueOnce([
        {
          userId: BigInt(789),
          handle: 'submitterAdmin',
          maxRating: { rating: 1890 },
        },
      ]);

    const response = await service.getReviews(
      adminUser,
      undefined,
      'challenge-1',
    );

    expect(
      resourceApiServiceMock.getMemberResourcesRoles,
    ).not.toHaveBeenCalled();
    expect(response.data[0]).toMatchObject({
      submitterHandle: 'submitterAdmin',
      submitterMaxRating: 1890,
    });
  });
});

describe('ReviewService.updateReviewItem validations', () => {
  const prismaMock = {
    reviewItem: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    scorecardQuestion: {
      findUnique: jest.fn(),
    },
    reviewAudit: {
      create: jest.fn(),
    },
  } as unknown as any;

  const prismaErrorServiceMock = {
    handleError: jest.fn((error: any) => ({
      message: error.message,
      code: error.response?.code ?? 'UNKNOWN',
      details: error.response?.details,
    })),
  } as unknown as any;

  const resourceApiServiceMock = {
    getMemberResourcesRoles: jest.fn(),
  } as unknown as any;

  const resourcePrismaMock = {
    resource: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as unknown as any;

  const memberPrismaMock = {
    member: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as unknown as any;

  const challengeApiServiceMock = {} as unknown as any;

  const eventBusServiceMock = {
    publish: jest.fn(),
    sendEmail: jest.fn(),
  } as unknown as any;

  const service = new ReviewService(
    prismaMock,
    prismaErrorServiceMock,
    resourceApiServiceMock,
    resourcePrismaMock,
    memberPrismaMock,
    challengeApiServiceMock,
    eventBusServiceMock,
  );

  const baseReviewer: JwtUser = {
    userId: 'reviewer-1',
    roles: [UserRole.Reviewer],
    isMachine: false,
  };

  const baseExistingItem = {
    id: 'item-1',
    reviewId: 'review-1',
    scorecardQuestionId: 'question-1',
    initialAnswer: 'Yes',
    finalAnswer: 'Yes',
    managerComment: null,
    review: {
      id: 'review-1',
      resourceId: 'resource-1',
      scorecardId: 'scorecard-1',
      submissionId: 'submission-1',
      submission: {
        challengeId: 'challenge-1',
      },
    },
  } as any;

  const baseQuestion = {
    id: 'question-1',
    section: {
      group: {
        scorecardId: 'scorecard-1',
      },
    },
  } as any;

  const baseRequest = {
    reviewId: 'review-1',
    scorecardQuestionId: 'question-1',
    initialAnswer: 'Yes',
    finalAnswer: 'Yes',
  } as any;

  beforeEach(() => {
    jest.resetAllMocks();

    prismaMock.reviewItem.findUnique.mockResolvedValue(baseExistingItem);
    prismaMock.scorecardQuestion.findUnique.mockResolvedValue(baseQuestion);
    prismaMock.reviewItem.update.mockResolvedValue({
      ...baseExistingItem,
      ...baseRequest,
      reviewItemComments: [],
    });
    resourceApiServiceMock.getMemberResourcesRoles.mockResolvedValue([
      {
        id: 'resource-1',
        memberId: baseReviewer.userId,
        roleName: 'Reviewer',
        challengeId: 'challenge-1',
      },
    ]);
  });

  it('throws when provided reviewId does not match the existing review', async () => {
    await expect(
      service.updateReviewItem(baseReviewer, 'item-1', {
        ...baseRequest,
        reviewId: 'review-2',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'REVIEW_ITEM_REVIEW_MISMATCH',
      }),
      status: 400,
    });

    expect(prismaMock.scorecardQuestion.findUnique).not.toHaveBeenCalled();
    expect(
      resourceApiServiceMock.getMemberResourcesRoles,
    ).not.toHaveBeenCalled();
  });

  it('throws when scorecard question cannot be found', async () => {
    prismaMock.scorecardQuestion.findUnique.mockResolvedValue(null);

    await expect(
      service.updateReviewItem(baseReviewer, 'item-1', baseRequest),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'SCORECARD_QUESTION_NOT_FOUND',
      }),
      status: 400,
    });

    expect(
      resourceApiServiceMock.getMemberResourcesRoles,
    ).not.toHaveBeenCalled();
  });

  it('throws when reviewer does not own the review', async () => {
    resourceApiServiceMock.getMemberResourcesRoles.mockResolvedValue([
      {
        id: 'other-resource',
        memberId: baseReviewer.userId,
        roleName: 'Reviewer',
        challengeId: 'challenge-1',
      },
    ]);

    await expect(
      service.updateReviewItem(baseReviewer, 'item-1', baseRequest),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'REVIEW_ITEM_UPDATE_FORBIDDEN_NOT_OWNER',
      }),
      status: 403,
    });

    expect(resourceApiServiceMock.getMemberResourcesRoles).toHaveBeenCalledWith(
      'challenge-1',
      baseReviewer.userId,
    );
    expect(prismaMock.reviewItem.update).not.toHaveBeenCalled();
  });

  it('rejects copilots that are not assigned to the challenge when updating', async () => {
    const copilotUser: JwtUser = {
      userId: 'copilot-1',
      roles: [UserRole.Copilot],
      isMachine: false,
    };

    resourceApiServiceMock.getMemberResourcesRoles.mockResolvedValue([]);

    await expect(
      service.updateReviewItem(copilotUser, 'item-1', baseRequest),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'REVIEW_ITEM_UPDATE_FORBIDDEN_NOT_COPILOT',
      }),
      status: 403,
    });

    expect(resourceApiServiceMock.getMemberResourcesRoles).toHaveBeenCalledWith(
      'challenge-1',
      'copilot-1',
    );
    expect(prismaMock.reviewItem.update).not.toHaveBeenCalled();
  });

  it('allows copilots assigned to the challenge to update review items', async () => {
    const copilotUser: JwtUser = {
      userId: 'copilot-1',
      roles: [UserRole.Copilot],
      isMachine: false,
    };

    resourceApiServiceMock.getMemberResourcesRoles.mockResolvedValue([
      {
        id: 'resource-1',
        memberId: 'copilot-1',
        roleName: 'Copilot',
        challengeId: 'challenge-1',
      },
    ]);

    await expect(
      service.updateReviewItem(copilotUser, 'item-1', baseRequest),
    ).resolves.toMatchObject({ id: 'item-1' });

    expect(resourceApiServiceMock.getMemberResourcesRoles).toHaveBeenCalledWith(
      'challenge-1',
      'copilot-1',
    );
    expect(prismaMock.reviewItem.update).toHaveBeenCalled();
  });

  it('records an audit entry when a copilot updates manager comments on a review item', async () => {
    const copilotUser: JwtUser = {
      userId: 'copilot-1',
      roles: [UserRole.Copilot],
      isMachine: false,
    };

    resourceApiServiceMock.getMemberResourcesRoles.mockResolvedValue([
      {
        id: 'resource-1',
        memberId: 'copilot-1',
        roleName: 'Copilot',
        challengeId: 'challenge-1',
      },
    ]);

    prismaMock.reviewItem.update.mockResolvedValueOnce({
      ...baseExistingItem,
      managerComment: 'Updated manager note',
      reviewItemComments: [],
    });
    prismaMock.reviewAudit.create.mockClear();

    await service.updateReviewItem(copilotUser, 'item-1', {
      ...baseRequest,
      managerComment: 'Updated manager note',
    });

    expect(prismaMock.reviewAudit.create).toHaveBeenCalledTimes(1);
    const auditPayload = prismaMock.reviewAudit.create.mock.calls[0][0];
    expect(auditPayload.data).toMatchObject({
      actorId: 'copilot-1',
      reviewId: 'review-1',
      submissionId: 'submission-1',
      challengeId: 'challenge-1',
    });
    expect(auditPayload.data.description).toContain(
      'reviewItem[scorecardQuestionId=question-1].managerComment: null -> Updated manager note',
    );
  });
});

describe('ReviewService.updateReview challenge status enforcement', () => {
  let prismaMock: any;
  let prismaErrorServiceMock: any;
  let resourceApiServiceMock: any;
  let resourcePrismaMock: any;
  let memberPrismaMock: any;
  let challengeApiServiceMock: any;
  let eventBusServiceMock: any;
  let service: ReviewService;
  let recomputeSpy: jest.SpyInstance;

  const updatePayload = {
    status: ReviewStatus.IN_PROGRESS,
  } as any;

  const nonPrivilegedUser: JwtUser = {
    userId: 'reviewer-1',
    roles: [],
    isMachine: false,
  };

  beforeEach(() => {
    prismaMock = {
      review: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      reviewAudit: {
        create: jest.fn(),
      },
    } as any;

    prismaMock.review.findUnique.mockResolvedValue({
      id: 'review-1',
      resourceId: 'resource-1',
      submission: {
        challengeId: 'challenge-1',
      },
    });

    prismaMock.review.update.mockResolvedValue({ id: 'review-1' });

    prismaErrorServiceMock = {
      handleError: jest.fn(),
    } as any;

    resourceApiServiceMock = {
      getResources: jest.fn(),
      getMemberResourcesRoles: jest.fn(),
    } as any;

    resourceApiServiceMock.getResources.mockResolvedValue([
      {
        id: 'resource-1',
        challengeId: 'challenge-1',
        memberId: 'reviewer-1',
      },
    ]);
    resourceApiServiceMock.getMemberResourcesRoles.mockResolvedValue([]);

    resourcePrismaMock = {
      resource: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    memberPrismaMock = {
      member: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    challengeApiServiceMock = {
      getChallengeDetail: jest.fn(),
    } as any;

    challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
      id: 'challenge-1',
      status: ChallengeStatus.ACTIVE,
      phases: [],
    });

    eventBusServiceMock = {
      publish: jest.fn(),
      sendEmail: jest.fn(),
    };

    service = new ReviewService(
      prismaMock,
      prismaErrorServiceMock,
      resourceApiServiceMock,
      resourcePrismaMock,
      memberPrismaMock,
      challengeApiServiceMock,
      eventBusServiceMock,
    );

    recomputeSpy = jest
      .spyOn(service as any, 'recomputeAndUpdateReviewScores')
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    recomputeSpy.mockRestore();
  });

  it('prevents non-admin tokens from updating reviews when the challenge is completed', async () => {
    challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
      id: 'challenge-1',
      status: ChallengeStatus.COMPLETED,
      phases: [],
    });

    await expect(
      service.updateReview(nonPrivilegedUser, 'review-1', updatePayload),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'REVIEW_UPDATE_FORBIDDEN_CHALLENGE_COMPLETED',
      }),
      status: 403,
    });

    expect(prismaMock.review.update).not.toHaveBeenCalled();
    expect(resourceApiServiceMock.getResources).toHaveBeenCalledWith({
      challengeId: 'challenge-1',
      memberId: 'reviewer-1',
    });
    expect(challengeApiServiceMock.getChallengeDetail).toHaveBeenCalledWith(
      'challenge-1',
    );
  });

  it('allows admin tokens to update reviews even when the challenge is completed', async () => {
    const adminUser: JwtUser = {
      userId: 'admin-1',
      roles: [UserRole.Admin],
      isMachine: false,
    };

    const result = await service.updateReview(
      adminUser,
      'review-1',
      updatePayload,
    );

    expect(result).toEqual({ id: 'review-1' });
    expect(prismaMock.review.update).toHaveBeenCalledTimes(1);
    expect(resourceApiServiceMock.getResources).not.toHaveBeenCalled();
    expect(challengeApiServiceMock.getChallengeDetail).not.toHaveBeenCalled();
    expect(recomputeSpy).toHaveBeenCalledWith('review-1');
  });

  it('allows admin tokens with alternative casing to update reviews', async () => {
    const adminUser: JwtUser = {
      userId: 'admin-2',
      roles: ['Administrator' as unknown as UserRole],
      isMachine: false,
    };

    const result = await service.updateReview(
      adminUser,
      'review-1',
      updatePayload,
    );

    expect(result).toEqual({ id: 'review-1' });
    expect(prismaMock.review.update).toHaveBeenCalledTimes(1);
    expect(resourceApiServiceMock.getResources).not.toHaveBeenCalled();
    expect(challengeApiServiceMock.getChallengeDetail).not.toHaveBeenCalled();
    expect(recomputeSpy).toHaveBeenCalledWith('review-1');
  });

  it('rejects attempts to change immutable identifiers', async () => {
    await expect(
      service.updateReview(nonPrivilegedUser, 'review-1', {
        ...updatePayload,
        resourceId: 'new-resource',
      }),
    ).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({
        code: 'REVIEW_UPDATE_IMMUTABLE_FIELDS',
        details: expect.objectContaining({
          reviewId: 'review-1',
          fields: ['resourceId'],
        }),
      }),
    });

    expect(prismaMock.review.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.review.update).not.toHaveBeenCalled();
    expect(challengeApiServiceMock.getChallengeDetail).not.toHaveBeenCalled();
    expect(resourceApiServiceMock.getResources).not.toHaveBeenCalled();
  });

  it('allows reviewer tokens to update when the challenge is not completed', async () => {
    const result = await service.updateReview(
      nonPrivilegedUser,
      'review-1',
      updatePayload,
    );

    expect(result).toEqual({ id: 'review-1' });
    expect(prismaMock.review.update).toHaveBeenCalledTimes(1);
    expect(resourceApiServiceMock.getResources).toHaveBeenCalledWith({
      challengeId: 'challenge-1',
      memberId: 'reviewer-1',
    });
    expect(challengeApiServiceMock.getChallengeDetail).toHaveBeenCalledWith(
      'challenge-1',
    );
    expect(recomputeSpy).toHaveBeenCalledWith('review-1');
  });

  it('returns recomputed scores when available', async () => {
    recomputeSpy.mockResolvedValueOnce({
      initialScore: 88.5,
      finalScore: 90.25,
    });

    prismaMock.review.update.mockResolvedValueOnce({
      id: 'review-1',
      initialScore: null,
      finalScore: null,
      status: ReviewStatus.IN_PROGRESS,
      reviewItems: [],
    });

    const result = await service.updateReview(
      nonPrivilegedUser,
      'review-1',
      updatePayload,
    );

    expect(result).toEqual(
      expect.objectContaining({
        id: 'review-1',
        initialScore: 88.5,
        finalScore: 90.25,
      }),
    );
  });

  it('publishes completion event when review status transitions to COMPLETED', async () => {
    const completionDate = new Date('2024-02-01T10:00:00Z');

    prismaMock.review.findUnique
      .mockResolvedValueOnce({
        id: 'review-1',
        resourceId: 'resource-1',
        phaseId: 'phase-review',
        status: ReviewStatus.PENDING,
        submission: {
          challengeId: 'challenge-1',
          memberId: 'submitter-456',
        },
      })
      .mockResolvedValueOnce({
        id: 'review-1',
        submissionId: 'submission-1',
        scorecardId: 'scorecard-1',
        resourceId: 'resource-1',
        phaseId: 'phase-review',
        status: ReviewStatus.COMPLETED,
        reviewDate: completionDate,
        initialScore: 99.1,
        updatedAt: completionDate,
        submission: {
          challengeId: 'challenge-1',
          memberId: 'submitter-456',
        },
      });

    prismaMock.review.update.mockResolvedValue({
      id: 'review-1',
      resourceId: 'resource-1',
      status: ReviewStatus.COMPLETED,
      submissionId: 'submission-1',
      scorecardId: 'scorecard-1',
    });

    resourceApiServiceMock.getResources.mockResolvedValue([
      {
        id: 'resource-1',
        challengeId: 'challenge-1',
        memberId: 'reviewer-1',
        memberHandle: 'reviewerHandle',
      },
      {
        id: 'resource-2',
        challengeId: 'challenge-1',
        memberId: 'submitter-456',
        memberHandle: 'submitterHandle',
        roleId: 'submitter-role',
      },
    ]);

    await service.updateReview(nonPrivilegedUser, 'review-1', {
      status: ReviewStatus.COMPLETED,
    } as any);

    expect(eventBusServiceMock.publish).toHaveBeenCalledTimes(1);
    expect(eventBusServiceMock.publish).toHaveBeenCalledWith(
      'review.action.completed',
      expect.objectContaining({
        reviewId: 'review-1',
        challengeId: 'challenge-1',
        submissionId: 'submission-1',
        phaseId: 'phase-review',
        reviewerHandle: 'reviewerHandle',
        reviewerMemberId: 'reviewer-1',
        submitterHandle: 'submitterHandle',
        submitterMemberId: 'submitter-456',
        completedAt: completionDate.toISOString(),
        initialScore: 99.1,
      }),
    );
  });

  it('prevents non-admin tokens from updating reviews they do not own', async () => {
    resourceApiServiceMock.getResources.mockResolvedValue([
      {
        id: 'resource-2',
        challengeId: 'challenge-1',
        memberId: 'some-other-user',
      },
    ]);

    await expect(
      service.updateReview(nonPrivilegedUser, 'review-1', updatePayload),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'REVIEW_UPDATE_FORBIDDEN_NOT_OWNER',
      }),
      status: 403,
    });

    expect(prismaMock.review.update).not.toHaveBeenCalled();
    expect(challengeApiServiceMock.getChallengeDetail).not.toHaveBeenCalled();
  });

  it('allows copilots assigned to the challenge to patch the review status', async () => {
    const copilotUser: JwtUser = {
      userId: 'copilot-1',
      roles: [UserRole.Copilot],
      isMachine: false,
    };

    resourceApiServiceMock.getResources.mockResolvedValue([
      {
        id: 'resource-9',
        challengeId: 'challenge-1',
        memberId: 'copilot-1',
      },
    ]);
    resourceApiServiceMock.getMemberResourcesRoles.mockResolvedValue([
      {
        id: 'resource-9',
        challengeId: 'challenge-1',
        memberId: 'copilot-1',
        memberHandle: 'copilotHandle',
        roleId: 'copilot-role',
        created: new Date().toISOString(),
        createdBy: 'tc',
        roleName: 'Copilot',
      },
    ]);

    const result = await service.updateReview(copilotUser, 'review-1', {
      status: ReviewStatus.IN_PROGRESS,
    } as any);

    expect(result).toEqual({ id: 'review-1' });
    expect(resourceApiServiceMock.getResources).toHaveBeenCalledWith({
      challengeId: 'challenge-1',
      memberId: 'copilot-1',
    });
    expect(resourceApiServiceMock.getMemberResourcesRoles).toHaveBeenCalledWith(
      'challenge-1',
      'copilot-1',
    );
    expect(prismaMock.review.update).toHaveBeenCalledTimes(1);
  });

  it('records an audit entry when an admin updates review status and answers', async () => {
    const adminUser: JwtUser = {
      userId: 'admin-1',
      roles: [UserRole.Admin],
      isMachine: false,
    };

    const existingReview = {
      id: 'review-1',
      submissionId: 'submission-1',
      scorecardId: 'scorecard-1',
      typeId: 'type-1',
      status: ReviewStatus.PENDING,
      committed: false,
      finalScore: 80,
      initialScore: 75,
      reviewDate: new Date('2024-01-01T00:00:00.000Z'),
      metadata: { version: 1 },
      reviewItems: [
        {
          scorecardQuestionId: 'question-1',
          initialAnswer: 'Yes',
          finalAnswer: 'No',
          managerComment: null,
        },
      ],
      submission: {
        challengeId: 'challenge-1',
      },
    } as any;

    const updatedReview = {
      id: 'review-1',
      status: ReviewStatus.COMPLETED,
      committed: true,
      finalScore: 90,
      initialScore: 85,
      reviewDate: new Date('2024-01-02T00:00:00.000Z'),
      metadata: { version: 2 },
      scorecardId: 'scorecard-1',
      typeId: 'type-1',
      reviewItems: [
        {
          scorecardQuestionId: 'question-1',
          initialAnswer: 'Yes',
          finalAnswer: 'Yes',
          managerComment: 'Updated notes',
          reviewItemComments: [],
        },
      ],
    } as any;

    prismaMock.review.findUnique.mockResolvedValueOnce(existingReview);
    prismaMock.review.update.mockResolvedValueOnce(updatedReview);
    prismaMock.reviewAudit.create.mockClear();

    await service.updateReview(adminUser, 'review-1', {
      status: ReviewStatus.COMPLETED,
      committed: true,
      reviewDate: updatedReview.reviewDate.toISOString(),
      reviewItems: [
        {
          scorecardQuestionId: 'question-1',
          initialAnswer: 'Yes',
          finalAnswer: 'Yes',
          managerComment: 'Updated notes',
        },
      ],
    } as any);

    expect(prismaMock.reviewAudit.create).toHaveBeenCalledTimes(1);
    const auditCall = prismaMock.reviewAudit.create.mock.calls[0][0];
    expect(auditCall.data).toMatchObject({
      actorId: 'admin-1',
      reviewId: 'review-1',
      submissionId: 'submission-1',
      challengeId: 'challenge-1',
    });
    expect(auditCall.data.description).toContain(
      'status: PENDING -> COMPLETED',
    );
    expect(auditCall.data.description).toContain(
      'reviewItem[scorecardQuestionId=question-1].finalAnswer: No -> Yes',
    );
    expect(auditCall.data.description).toContain(
      'reviewItem[scorecardQuestionId=question-1].managerComment: null -> Updated notes',
    );
  });

  it('rejects copilots when updating fields beyond the review status', async () => {
    const copilotUser: JwtUser = {
      userId: 'copilot-1',
      roles: [UserRole.Copilot],
      isMachine: false,
    };

    resourceApiServiceMock.getResources.mockResolvedValue([
      {
        id: 'resource-9',
        challengeId: 'challenge-1',
        memberId: 'copilot-1',
      },
    ]);

    await expect(
      service.updateReview(copilotUser, 'review-1', {
        status: ReviewStatus.IN_PROGRESS,
        metadata: { reason: 'manual reopen' },
      } as any),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'REVIEW_UPDATE_FORBIDDEN_NOT_OWNER',
      }),
      status: 403,
    });

    expect(
      resourceApiServiceMock.getMemberResourcesRoles,
    ).not.toHaveBeenCalled();
    expect(prismaMock.review.update).not.toHaveBeenCalled();
  });

  it('rejects copilots that are not assigned to the challenge when patching status', async () => {
    const copilotUser: JwtUser = {
      userId: 'copilot-2',
      roles: [UserRole.Copilot],
      isMachine: false,
    };

    resourceApiServiceMock.getResources.mockResolvedValue([
      {
        id: 'resource-10',
        challengeId: 'challenge-1',
        memberId: 'copilot-2',
      },
    ]);
    resourceApiServiceMock.getMemberResourcesRoles.mockResolvedValue([]);

    await expect(
      service.updateReview(copilotUser, 'review-1', {
        status: ReviewStatus.IN_PROGRESS,
      } as any),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'REVIEW_UPDATE_FORBIDDEN_NOT_COPILOT',
      }),
      status: 403,
    });

    expect(resourceApiServiceMock.getMemberResourcesRoles).toHaveBeenCalledWith(
      'challenge-1',
      'copilot-2',
    );
    expect(prismaMock.review.update).not.toHaveBeenCalled();
  });
});

describe('ReviewService.createReviewItemComments', () => {
  let prismaMock: any;
  let prismaErrorServiceMock: any;
  let resourceApiServiceMock: any;
  let resourcePrismaMock: any;
  let memberPrismaMock: any;
  let eventBusServiceMock: any;
  let service: ReviewService;
  let recomputeSpy: jest.SpyInstance;

  const machineUser = { isMachine: true } as JwtUser;

  const basePayload = {
    reviewId: 'review-1',
    scorecardQuestionId: 'question-1',
    initialAnswer: 'YES',
  } as any;

  beforeEach(() => {
    prismaMock = {
      review: {
        findUnique: jest.fn(),
      },
      scorecardQuestion: {
        findUnique: jest.fn(),
      },
      reviewItem: {
        create: jest.fn(),
      },
    } as any;

    prismaErrorServiceMock = {
      handleError: jest.fn(),
    } as any;

    resourceApiServiceMock = {
      getMemberResourcesRoles: jest.fn(),
    } as any;
    resourceApiServiceMock.getMemberResourcesRoles.mockResolvedValue([]);

    resourcePrismaMock = {
      resource: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    memberPrismaMock = {
      member: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    eventBusServiceMock = {
      publish: jest.fn(),
      sendEmail: jest.fn(),
    };

    service = new ReviewService(
      prismaMock,
      prismaErrorServiceMock,
      resourceApiServiceMock,
      resourcePrismaMock,
      memberPrismaMock,
      {} as any,
      eventBusServiceMock,
    );

    recomputeSpy = jest
      .spyOn(service as any, 'recomputeAndUpdateReviewScores')
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    recomputeSpy.mockRestore();
  });

  it('throws a BadRequestException when the review does not exist', async () => {
    prismaMock.review.findUnique.mockResolvedValue(null);

    await expect(
      service.createReviewItemComments(machineUser, { ...basePayload }),
    ).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({
        code: 'REVIEW_NOT_FOUND',
        details: { reviewId: 'review-1' },
      }),
    });

    expect(prismaMock.reviewItem.create).not.toHaveBeenCalled();
    expect(prismaMock.scorecardQuestion.findUnique).not.toHaveBeenCalled();
  });

  it('creates a review item when the review exists', async () => {
    const createdReviewItem = {
      id: 'review-item-1',
      reviewId: 'review-1',
      scorecardQuestionId: 'question-1',
      initialAnswer: 'YES',
      reviewItemComments: [],
    };

    prismaMock.review.findUnique.mockResolvedValue({
      id: 'review-1',
      resourceId: 'resource-1',
      scorecardId: 'scorecard-1',
      submission: { challengeId: 'challenge-1' },
    });
    prismaMock.scorecardQuestion.findUnique.mockResolvedValue({
      id: 'question-1',
      section: { group: { scorecardId: 'scorecard-1' } },
    });
    prismaMock.reviewItem.create.mockResolvedValue(createdReviewItem);

    const result = await service.createReviewItemComments(machineUser, {
      ...basePayload,
    });

    expect(result).toEqual(createdReviewItem);
    expect(prismaMock.review.findUnique).toHaveBeenCalledWith({
      where: { id: 'review-1' },
      select: {
        id: true,
        resourceId: true,
        scorecardId: true,
        submission: {
          select: {
            challengeId: true,
          },
        },
      },
    });
    expect(prismaMock.scorecardQuestion.findUnique).toHaveBeenCalledWith({
      where: { id: 'question-1' },
      select: {
        id: true,
        section: {
          select: {
            group: {
              select: { scorecardId: true },
            },
          },
        },
      },
    });
    expect(prismaMock.reviewItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        scorecardQuestionId: 'question-1',
        initialAnswer: 'YES',
      }),
      include: {
        reviewItemComments: {
          include: {
            appeal: {
              include: {
                appealResponse: true,
              },
            },
          },
        },
      },
    });
    expect(recomputeSpy).toHaveBeenCalledWith('review-1');
  });

  it('throws a BadRequestException when the scorecard question does not exist', async () => {
    prismaMock.review.findUnique.mockResolvedValue({
      id: 'review-1',
      resourceId: 'resource-1',
      scorecardId: 'scorecard-1',
      submission: { challengeId: 'challenge-1' },
    });
    prismaMock.scorecardQuestion.findUnique.mockResolvedValue(null);

    await expect(
      service.createReviewItemComments(machineUser, { ...basePayload }),
    ).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({
        code: 'SCORECARD_QUESTION_NOT_FOUND',
        details: { scorecardQuestionId: 'question-1' },
      }),
    });

    expect(prismaMock.reviewItem.create).not.toHaveBeenCalled();
  });

  it('throws a BadRequestException when the question belongs to a different scorecard', async () => {
    prismaMock.review.findUnique.mockResolvedValue({
      id: 'review-1',
      resourceId: 'resource-1',
      scorecardId: 'scorecard-1',
      submission: { challengeId: 'challenge-1' },
    });
    prismaMock.scorecardQuestion.findUnique.mockResolvedValue({
      id: 'question-1',
      section: { group: { scorecardId: 'scorecard-2' } },
    });

    await expect(
      service.createReviewItemComments(machineUser, { ...basePayload }),
    ).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({
        code: 'SCORECARD_QUESTION_MISMATCH',
        details: expect.objectContaining({
          scorecardQuestionId: 'question-1',
          reviewScorecardId: 'scorecard-1',
          questionScorecardId: 'scorecard-2',
        }),
      }),
    });

    expect(prismaMock.reviewItem.create).not.toHaveBeenCalled();
  });

  it('rejects copilot tokens that are not assigned to the challenge', async () => {
    prismaMock.review.findUnique.mockResolvedValue({
      id: 'review-1',
      resourceId: 'resource-1',
      scorecardId: 'scorecard-1',
      submission: { challengeId: 'challenge-1' },
    });
    prismaMock.scorecardQuestion.findUnique.mockResolvedValue({
      id: 'question-1',
      section: { group: { scorecardId: 'scorecard-1' } },
    });
    resourceApiServiceMock.getMemberResourcesRoles.mockResolvedValue([]);

    const copilotUser: JwtUser = {
      userId: 'copilot-1',
      roles: [UserRole.Copilot],
      isMachine: false,
    };

    await expect(
      service.createReviewItemComments(copilotUser, { ...basePayload }),
    ).rejects.toMatchObject({
      status: 403,
      response: expect.objectContaining({
        code: 'REVIEW_ITEM_CREATE_FORBIDDEN_NOT_COPILOT',
      }),
    });

    expect(resourceApiServiceMock.getMemberResourcesRoles).toHaveBeenCalledWith(
      'challenge-1',
      'copilot-1',
    );
  });

  it('allows copilots assigned to the challenge to create review items', async () => {
    const createdReviewItem = {
      id: 'review-item-1',
      reviewId: 'review-1',
      scorecardQuestionId: 'question-1',
      initialAnswer: 'YES',
      reviewItemComments: [],
    };

    prismaMock.review.findUnique.mockResolvedValue({
      id: 'review-1',
      resourceId: 'resource-1',
      scorecardId: 'scorecard-1',
      submission: { challengeId: 'challenge-1' },
    });
    prismaMock.scorecardQuestion.findUnique.mockResolvedValue({
      id: 'question-1',
      section: { group: { scorecardId: 'scorecard-1' } },
    });
    prismaMock.reviewItem.create.mockResolvedValue(createdReviewItem);
    resourceApiServiceMock.getMemberResourcesRoles.mockResolvedValue([
      {
        id: 'resource-1',
        memberId: 'copilot-1',
        roleName: 'Copilot',
        challengeId: 'challenge-1',
      },
    ]);

    const copilotUser: JwtUser = {
      userId: 'copilot-1',
      roles: [UserRole.Copilot],
      isMachine: false,
    };

    const result = await service.createReviewItemComments(copilotUser, {
      ...basePayload,
    });

    expect(result).toEqual(createdReviewItem);
    expect(resourceApiServiceMock.getMemberResourcesRoles).toHaveBeenCalledWith(
      'challenge-1',
      'copilot-1',
    );
  });
});

describe('ReviewService.deleteReview', () => {
  let prismaMock: any;
  let prismaErrorServiceMock: any;
  let resourceApiServiceMock: any;
  let resourcePrismaMock: any;
  let memberPrismaMock: any;
  let eventBusServiceMock: any;
  let service: ReviewService;

  const copilotUser: JwtUser = {
    userId: 'copilot-1',
    roles: [UserRole.Copilot],
    isMachine: false,
  };

  const adminUser: JwtUser = {
    userId: 'admin-1',
    roles: [UserRole.Admin],
    isMachine: false,
  };

  beforeEach(() => {
    prismaMock = {
      review: {
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
    } as any;

    prismaErrorServiceMock = {
      handleError: jest.fn(),
    } as any;

    resourceApiServiceMock = {
      getMemberResourcesRoles: jest.fn(),
    } as any;

    resourcePrismaMock = {
      resource: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    memberPrismaMock = {
      member: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    eventBusServiceMock = {
      publish: jest.fn(),
      sendEmail: jest.fn(),
    };

    service = new ReviewService(
      prismaMock,
      prismaErrorServiceMock,
      resourceApiServiceMock,
      resourcePrismaMock,
      memberPrismaMock,
      {} as any,
      eventBusServiceMock,
    );
  });

  it('throws NotFoundException when the review does not exist', async () => {
    prismaMock.review.findUnique.mockResolvedValue(null);

    await expect(
      service.deleteReview(undefined, 'review-1'),
    ).rejects.toMatchObject({
      status: 404,
      response: expect.objectContaining({
        code: 'RECORD_NOT_FOUND',
        details: { reviewId: 'review-1' },
      }),
    });

    expect(prismaMock.review.delete).not.toHaveBeenCalled();
    expect(
      resourceApiServiceMock.getMemberResourcesRoles,
    ).not.toHaveBeenCalled();
  });

  it('rejects copilots that are not assigned to the challenge', async () => {
    prismaMock.review.findUnique.mockResolvedValue({
      id: 'review-1',
      submission: { challengeId: 'challenge-1' },
    });
    resourceApiServiceMock.getMemberResourcesRoles.mockResolvedValue([]);

    await expect(
      service.deleteReview(copilotUser, 'review-1'),
    ).rejects.toMatchObject({
      status: 403,
      response: expect.objectContaining({
        code: 'REVIEW_DELETE_FORBIDDEN_NOT_COPILOT',
      }),
    });

    expect(resourceApiServiceMock.getMemberResourcesRoles).toHaveBeenCalledWith(
      'challenge-1',
      'copilot-1',
    );
    expect(prismaMock.review.delete).not.toHaveBeenCalled();
  });

  it('allows copilots assigned to the challenge to delete the review', async () => {
    prismaMock.review.findUnique.mockResolvedValue({
      id: 'review-1',
      submission: { challengeId: 'challenge-1' },
    });
    prismaMock.review.delete.mockResolvedValue({});
    resourceApiServiceMock.getMemberResourcesRoles.mockResolvedValue([
      {
        id: 'resource-1',
        memberId: 'copilot-1',
        roleName: 'Copilot',
        challengeId: 'challenge-1',
      },
    ]);

    const result = await service.deleteReview(copilotUser, 'review-1');

    expect(result).toEqual({
      message: 'Review review-1 deleted successfully.',
    });
    expect(resourceApiServiceMock.getMemberResourcesRoles).toHaveBeenCalledWith(
      'challenge-1',
      'copilot-1',
    );
    expect(prismaMock.review.delete).toHaveBeenCalledWith({
      where: { id: 'review-1' },
    });
  });

  it('allows admins to delete reviews without copilot validation', async () => {
    prismaMock.review.findUnique.mockResolvedValue({
      id: 'review-1',
      submission: { challengeId: 'challenge-1' },
    });
    prismaMock.review.delete.mockResolvedValue({});

    const result = await service.deleteReview(adminUser, 'review-1');

    expect(result).toEqual({
      message: 'Review review-1 deleted successfully.',
    });
    expect(
      resourceApiServiceMock.getMemberResourcesRoles,
    ).not.toHaveBeenCalled();
    expect(prismaMock.review.delete).toHaveBeenCalledWith({
      where: { id: 'review-1' },
    });
  });
});

describe('ReviewService.deleteReviewItem authorization checks', () => {
  const prismaMock = {
    reviewItem: {
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
  } as unknown as any;

  const prismaErrorServiceMock = {
    handleError: jest.fn((error: any) => ({
      message: error.message,
      code: error.response?.code ?? 'UNKNOWN',
      details: error.response?.details,
    })),
  } as unknown as any;

  const resourceApiServiceMock = {
    getMemberResourcesRoles: jest.fn(),
  } as unknown as any;

  const resourcePrismaMock = {
    resource: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as unknown as any;

  const memberPrismaMock = {
    member: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as unknown as any;

  const challengeApiServiceMock = {} as unknown as any;

  const eventBusServiceMock = {
    publish: jest.fn(),
    sendEmail: jest.fn(),
  } as unknown as any;

  const service = new ReviewService(
    prismaMock,
    prismaErrorServiceMock,
    resourceApiServiceMock,
    resourcePrismaMock,
    memberPrismaMock,
    challengeApiServiceMock,
    eventBusServiceMock,
  );

  const reviewerUser: JwtUser = {
    userId: 'member-100',
    roles: [UserRole.Reviewer],
    isMachine: false,
  };

  const baseReviewItem = {
    id: 'item-1',
    reviewId: 'review-1',
    review: {
      id: 'review-1',
      resourceId: 'resource-1',
      submission: {
        challengeId: 'challenge-1',
      },
    },
  } as any;

  beforeEach(() => {
    jest.resetAllMocks();

    prismaMock.reviewItem.findUnique.mockResolvedValue(baseReviewItem);
    prismaMock.reviewItem.delete.mockResolvedValue(undefined);

    jest
      .spyOn(service as any, 'recomputeAndUpdateReviewScores')
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('blocks reviewers from deleting review items they do not own', async () => {
    resourceApiServiceMock.getMemberResourcesRoles.mockResolvedValue([
      {
        id: 'resource-1',
        memberId: 'someone-else',
        challengeId: 'challenge-1',
        memberHandle: 'otherHandle',
        roleId: 'role-reviewer',
        createdBy: 'system',
        created: new Date().toISOString(),
        roleName: 'Reviewer',
      },
    ]);

    await expect(
      service.deleteReviewItem(reviewerUser, 'item-1'),
    ).rejects.toMatchObject({
      status: 403,
      response: expect.objectContaining({
        code: 'REVIEW_ITEM_DELETE_FORBIDDEN_NOT_OWNER',
      }),
    });

    expect(prismaMock.reviewItem.delete).not.toHaveBeenCalled();
    expect(resourceApiServiceMock.getMemberResourcesRoles).toHaveBeenCalledWith(
      'challenge-1',
      'member-100',
    );
  });

  it('allows reviewers to delete review items associated with their own review', async () => {
    resourceApiServiceMock.getMemberResourcesRoles.mockResolvedValue([
      {
        id: 'resource-1',
        memberId: 'member-100',
        challengeId: 'challenge-1',
        memberHandle: 'reviewerHandle',
        roleId: 'role-reviewer',
        createdBy: 'system',
        created: new Date().toISOString(),
        roleName: 'Reviewer',
      },
    ]);

    await expect(
      service.deleteReviewItem(reviewerUser, 'item-1'),
    ).resolves.toMatchObject({
      message: 'Review item item-1 deleted successfully.',
    });

    expect(prismaMock.reviewItem.delete).toHaveBeenCalledWith({
      where: { id: 'item-1' },
    });
  });
});
