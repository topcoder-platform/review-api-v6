import { BadRequestException } from '@nestjs/common';
jest.mock('nanoid', () => ({
  __esModule: true,
  nanoid: () => 'mock-nanoid',
}));

import { ReviewService } from './review.service';
import { ReviewStatus } from 'src/dto/review.dto';
import { JwtUser } from 'src/shared/modules/global/jwt.service';
import { ChallengeStatus } from 'src/shared/enums/challengeStatus.enum';

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
