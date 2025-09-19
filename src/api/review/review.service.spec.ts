import { BadRequestException } from '@nestjs/common';
jest.mock('nanoid', () => ({
  __esModule: true,
  nanoid: () => 'mock-nanoid',
}));

import { ReviewService } from './review.service';
import { ReviewStatus } from 'src/dto/review.dto';
import { JwtUser } from 'src/shared/modules/global/jwt.service';
import { ChallengeStatus } from 'src/shared/enums/challengeStatus.enum';
import { UserRole } from 'src/shared/enums/userRole.enum';

describe('ReviewService.createReview authorization checks', () => {
  const prismaMock = {
    scorecard: {
      findUnique: jest.fn(),
    },
    submission: {
      findUnique: jest.fn(),
    },
    review: {
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

  const challengeApiServiceMock = {
    validateReviewSubmission: jest.fn(),
    getChallengeDetail: jest.fn(),
  } as unknown as any;

  const service = new ReviewService(
    prismaMock,
    prismaErrorServiceMock,
    resourceApiServiceMock,
    challengeApiServiceMock,
  );

  const baseAuthUser: JwtUser = {
    userId: 'user-123',
    roles: [],
    isMachine: false,
  };

  const baseReviewRequest = {
    id: 'review-1',
    resourceId: 'resource-1',
    phaseId: 'phase-review',
    submissionId: 'submission-1',
    scorecardId: 'scorecard-1',
    typeId: 'type-1',
    metadata: {},
    status: ReviewStatus.PENDING,
    reviewDate: new Date().toISOString(),
    committed: false,
    reviewItems: [],
  } as any;

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

    prismaMock.scorecard.findUnique.mockResolvedValue({ id: 'scorecard-1' });
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
    resourceApiServiceMock.getResources.mockResolvedValue([
      {
        ...baseResource,
        memberId: 'someone-else',
      },
    ]);

    await expect(
      service.createReview(baseAuthUser, baseReviewRequest),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'RESOURCE_MEMBER_MISMATCH' }),
      status: 403,
    });
  });

  it('throws when phaseId is not a review phase for the challenge', async () => {
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
      service.createReview(baseAuthUser, baseReviewRequest),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws when resource phase does not match the requested phase', async () => {
    resourceApiServiceMock.getResources.mockResolvedValue([
      {
        ...baseResource,
        phaseId: 'phase-iterative',
      },
    ]);

    await expect(
      service.createReview(baseAuthUser, baseReviewRequest),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'RESOURCE_PHASE_MISMATCH' }),
      status: 400,
    });
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

  const challengeApiServiceMock = {
    getChallengeDetail: jest.fn(),
  } as unknown as any;

  const service = new ReviewService(
    prismaMock,
    prismaErrorServiceMock,
    resourceApiServiceMock,
    challengeApiServiceMock,
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
});

describe('ReviewService.updateReview challenge status enforcement', () => {
  let prismaMock: any;
  let prismaErrorServiceMock: any;
  let resourceApiServiceMock: any;
  let challengeApiServiceMock: any;
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
    } as any;

    resourceApiServiceMock.getResources.mockResolvedValue([
      {
        id: 'resource-1',
        challengeId: 'challenge-1',
        memberId: 'reviewer-1',
      },
    ]);

    challengeApiServiceMock = {
      getChallengeDetail: jest.fn(),
    } as any;

    challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
      id: 'challenge-1',
      status: ChallengeStatus.ACTIVE,
      phases: [],
    });

    service = new ReviewService(
      prismaMock,
      prismaErrorServiceMock,
      resourceApiServiceMock,
      challengeApiServiceMock,
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
});
