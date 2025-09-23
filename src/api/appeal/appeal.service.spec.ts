jest.mock('nanoid', () => ({
  __esModule: true,
  nanoid: () => 'mock-nanoid',
}));

import { AppealService } from './appeal.service';
import { ChallengeStatus } from 'src/shared/enums/challengeStatus.enum';
import { UserRole } from 'src/shared/enums/userRole.enum';
import { CommonConfig } from 'src/shared/config/common.config';

const prismaMock = {
  appeal: {
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  },
  appealResponse: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  reviewItemComment: {
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
  },
} as unknown as any;

const resourcePrismaMock = {
  resource: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
} as unknown as any;

const prismaErrorServiceMock = {
  handleError: jest.fn(),
} as unknown as any;

const challengeApiServiceMock = {
  validateAppealResponseSubmission: jest.fn(),
  validateAppealSubmission: jest.fn(),
  getChallengeDetail: jest.fn(),
} as unknown as any;

const service = new AppealService(
  prismaMock,
  prismaErrorServiceMock,
  challengeApiServiceMock,
  resourcePrismaMock,
);

describe('AppealService.createAppeal', () => {
  const baseReviewItemComment = {
    id: 'review-item-comment-1',
    reviewItem: {
      review: {
        submission: {
          challengeId: 'challenge-1',
          memberId: 'member-123',
        },
      },
    },
  } as any;

  const baseRequest = {
    reviewItemCommentId: baseReviewItemComment.id,
    content: '  Please reconsider this appeal.  ',
    resourceId: 'resource-123',
  } as any;

  beforeEach(() => {
    jest.resetAllMocks();

    challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
      id: 'challenge-1',
      status: ChallengeStatus.ACTIVE,
    });
    prismaMock.reviewItemComment.findUniqueOrThrow.mockResolvedValue(
      baseReviewItemComment,
    );
    prismaErrorServiceMock.handleError.mockImplementation((error: any) => {
      throw error;
    });
    challengeApiServiceMock.validateAppealSubmission.mockResolvedValue(
      undefined,
    );
    prismaMock.appeal.create.mockResolvedValue({
      id: 'appeal-1',
      resourceId: 'resource-123',
      content: 'Please reconsider this appeal.',
    });
    resourcePrismaMock.resource.findMany.mockResolvedValue([
      {
        id: 'resource-123',
        memberId: 'member-123',
        roleId: CommonConfig.roles.submitterRoleId,
      },
    ]);
  });

  it('allows machine tokens with appeal scopes to create appeals', async () => {
    const machineUser = {
      isMachine: true,
      userId: undefined,
      scopes: ['create:appeal'],
    } as any;

    const request = { ...baseRequest };

    await expect(service.createAppeal(machineUser, request)).resolves.toEqual(
      expect.objectContaining({
        id: 'appeal-1',
        resourceId: 'resource-123',
        content: 'Please reconsider this appeal.',
      }),
    );

    expect(prismaMock.reviewItemComment.findUniqueOrThrow).toHaveBeenCalledWith(
      {
        where: { id: baseRequest.reviewItemCommentId },
        include: expect.any(Object),
      },
    );
    expect(prismaMock.appeal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        resourceId: 'resource-123',
        content: 'Please reconsider this appeal.',
      }),
    });
    expect(
      challengeApiServiceMock.validateAppealSubmission,
    ).toHaveBeenCalledWith('challenge-1');
  });

  it('infers the submitter resourceId when submitter omits it from the request', async () => {
    const regularUser = {
      userId: 'member-123',
      isMachine: false,
      roles: [],
    } as any;

    const request = { ...baseRequest };
    delete request.resourceId;

    await expect(service.createAppeal(regularUser, request)).resolves.toEqual(
      expect.objectContaining({
        id: 'appeal-1',
        resourceId: 'resource-123',
      }),
    );

    expect(resourcePrismaMock.resource.findMany).toHaveBeenCalledWith({
      where: {
        challengeId: 'challenge-1',
        roleId: CommonConfig.roles.submitterRoleId,
      },
      orderBy: { createdAt: 'asc' },
    });

    expect(prismaMock.appeal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        resourceId: 'resource-123',
      }),
    });
  });

  it('still prevents non-owners without admin privileges from creating appeals', async () => {
    const regularUser = {
      userId: 'member-999',
      isMachine: false,
      roles: [],
    } as any;

    const request = { ...baseRequest };

    await expect(
      service.createAppeal(regularUser, request),
    ).rejects.toMatchObject({
      status: 403,
      response: expect.objectContaining({
        code: 'APPEAL_CREATE_FORBIDDEN',
      }),
    });

    expect(prismaMock.appeal.create).not.toHaveBeenCalled();
  });
});

describe('AppealService.updateAppeal', () => {
  const baseAppeal = {
    id: 'appeal-1',
    resourceId: 'member-123',
    reviewItemCommentId: 'review-item-comment-1',
    content: 'Original appeal content',
    reviewItemComment: {
      reviewItem: {
        review: {
          submission: {
            id: 'submission-1',
            memberId: 'member-123',
            challengeId: 'challenge-1',
          },
        },
      },
    },
  } as any;

  const updateRequest = {
    reviewItemCommentId: baseAppeal.reviewItemCommentId,
    content: 'Updated appeal content',
    resourceId: baseAppeal.resourceId,
  } as any;

  const submitterAuthUser = {
    userId: 'member-123',
    isMachine: false,
    roles: [],
  } as any;

  beforeEach(() => {
    jest.resetAllMocks();

    challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
      id: 'challenge-1',
      status: ChallengeStatus.ACTIVE,
    });
    prismaMock.appeal.findUnique.mockResolvedValue(baseAppeal);
    prismaMock.appeal.update.mockResolvedValue({
      ...baseAppeal,
      content: updateRequest.content,
    });
    prismaErrorServiceMock.handleError.mockImplementation((error: any) => {
      throw error;
    });
  });

  it('updates the appeal when the challenge is still active', async () => {
    await expect(
      service.updateAppeal(submitterAuthUser, baseAppeal.id, updateRequest),
    ).resolves.toMatchObject({
      id: baseAppeal.id,
      content: updateRequest.content,
    });

    expect(prismaMock.appeal.findUnique).toHaveBeenCalledWith({
      where: { id: baseAppeal.id },
      include: expect.any(Object),
    });
    expect(challengeApiServiceMock.getChallengeDetail).toHaveBeenCalledWith(
      'challenge-1',
    );
    expect(prismaMock.appeal.update).toHaveBeenCalledWith({
      where: { id: baseAppeal.id },
      data: expect.objectContaining({
        content: updateRequest.content,
      }),
    });
  });

  it('prevents updates when the challenge is completed for non-admins', async () => {
    challengeApiServiceMock.getChallengeDetail.mockResolvedValueOnce({
      id: 'challenge-1',
      status: ChallengeStatus.COMPLETED,
    });

    await expect(
      service.updateAppeal(submitterAuthUser, baseAppeal.id, updateRequest),
    ).rejects.toMatchObject({
      status: 403,
      response: expect.objectContaining({
        code: 'APPEAL_UPDATE_FORBIDDEN_CHALLENGE_COMPLETED',
      }),
    });

    expect(prismaMock.appeal.update).not.toHaveBeenCalled();
  });
});

describe('AppealService.deleteAppeal', () => {
  const baseAppeal = {
    id: 'appeal-1',
    resourceId: 'member-123',
    reviewItemComment: {
      reviewItem: {
        review: {
          submission: {
            id: 'submission-1',
            memberId: 'member-123',
            challengeId: 'challenge-1',
          },
        },
      },
    },
  } as any;

  const submitterAuthUser = {
    userId: 'member-123',
    isMachine: false,
    roles: [],
  } as any;

  beforeEach(() => {
    jest.resetAllMocks();

    challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
      id: 'challenge-1',
      status: ChallengeStatus.ACTIVE,
    });
    prismaMock.appeal.findUnique.mockResolvedValue(baseAppeal);
    prismaMock.appeal.delete.mockResolvedValue(undefined);
    prismaErrorServiceMock.handleError.mockImplementation((error: any) => {
      throw error;
    });
  });

  it('deletes the appeal when the challenge is still active', async () => {
    await expect(
      service.deleteAppeal(submitterAuthUser, baseAppeal.id),
    ).resolves.toMatchObject({
      message: `Appeal ${baseAppeal.id} deleted successfully.`,
    });

    expect(prismaMock.appeal.findUnique).toHaveBeenCalledWith({
      where: { id: baseAppeal.id },
      include: expect.any(Object),
    });
    expect(challengeApiServiceMock.getChallengeDetail).toHaveBeenCalledWith(
      'challenge-1',
    );
    expect(prismaMock.appeal.delete).toHaveBeenCalledWith({
      where: { id: baseAppeal.id },
    });
  });

  it('prevents deletion when the challenge is completed for non-admins', async () => {
    challengeApiServiceMock.getChallengeDetail.mockResolvedValueOnce({
      id: 'challenge-1',
      status: ChallengeStatus.COMPLETED,
    });

    await expect(
      service.deleteAppeal(submitterAuthUser, baseAppeal.id),
    ).rejects.toMatchObject({
      status: 403,
      response: expect.objectContaining({
        code: 'APPEAL_DELETE_FORBIDDEN_CHALLENGE_COMPLETED',
      }),
    });

    expect(prismaMock.appeal.delete).not.toHaveBeenCalled();
  });
});

describe('AppealService.updateAppealResponse', () => {
  const baseAppealResponse = {
    id: 'appeal-response-1',
    appealId: 'appeal-1',
    content: 'Original content',
    success: false,
    appeal: {
      id: 'appeal-1',
      reviewItemComment: {
        reviewItem: {
          review: {
            resourceId: 'resource-1',
            submission: {
              challengeId: 'challenge-1',
            },
          },
        },
      },
    },
  } as any;

  const updateRequest = {
    content: 'Updated response content',
    success: true,
  } as any;

  const reviewerAuthUser = {
    userId: 'member-123',
    isMachine: false,
    roles: ['Copilot'],
  } as any;

  beforeEach(() => {
    jest.resetAllMocks();

    challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
      id: 'challenge-1',
      status: ChallengeStatus.ACTIVE,
    });
    prismaMock.appealResponse.findUnique.mockResolvedValue(baseAppealResponse);
    prismaMock.appealResponse.update.mockResolvedValue({
      id: baseAppealResponse.id,
      content: updateRequest.content,
      success: updateRequest.success,
    });
    resourcePrismaMock.resource.findUnique.mockResolvedValue({
      id: 'resource-1',
      memberId: 'member-123',
    });
    prismaErrorServiceMock.handleError.mockImplementation((error: any) => {
      throw error;
    });
  });

  it('allows the assigned reviewer to update the appeal response', async () => {
    await expect(
      service.updateAppealResponse(
        reviewerAuthUser,
        baseAppealResponse.id,
        updateRequest,
      ),
    ).resolves.toMatchObject({
      id: baseAppealResponse.id,
      content: updateRequest.content,
      success: updateRequest.success,
    });

    expect(prismaMock.appealResponse.findUnique).toHaveBeenCalledWith({
      where: { id: baseAppealResponse.id },
      include: expect.any(Object),
    });
    expect(resourcePrismaMock.resource.findUnique).toHaveBeenCalledWith({
      where: { id: 'resource-1' },
    });
    expect(prismaMock.appealResponse.update).toHaveBeenCalledWith({
      where: { id: baseAppealResponse.id },
      data: expect.objectContaining({
        content: updateRequest.content,
        success: updateRequest.success,
      }),
    });
  });

  it('prevents non-admin reviewers from updating responses once the challenge is completed', async () => {
    challengeApiServiceMock.getChallengeDetail.mockResolvedValueOnce({
      id: 'challenge-1',
      status: ChallengeStatus.COMPLETED,
    });

    await expect(
      service.updateAppealResponse(
        reviewerAuthUser,
        baseAppealResponse.id,
        updateRequest,
      ),
    ).rejects.toMatchObject({
      status: 403,
      response: expect.objectContaining({
        code: 'APPEAL_RESPONSE_UPDATE_FORBIDDEN_CHALLENGE_COMPLETED',
      }),
    });

    expect(prismaMock.appealResponse.update).not.toHaveBeenCalled();
  });

  it('throws ForbiddenException when requester is not the reviewer', async () => {
    const otherReviewerAuthUser = {
      userId: 'member-999',
      isMachine: false,
      roles: ['Copilot'],
    } as any;

    await expect(
      service.updateAppealResponse(
        otherReviewerAuthUser,
        baseAppealResponse.id,
        updateRequest,
      ),
    ).rejects.toMatchObject({
      status: 403,
      response: expect.objectContaining({
        code: 'APPEAL_RESPONSE_FORBIDDEN',
      }),
    });

    expect(prismaMock.appealResponse.update).not.toHaveBeenCalled();
  });

  it('allows machine users to update an appeal response even when the challenge is completed', async () => {
    challengeApiServiceMock.getChallengeDetail.mockResolvedValueOnce({
      id: 'challenge-1',
      status: ChallengeStatus.COMPLETED,
    });

    const machineAuthUser = {
      isMachine: true,
      userId: undefined,
      roles: ['Copilot'],
    } as any;

    await expect(
      service.updateAppealResponse(
        machineAuthUser,
        baseAppealResponse.id,
        updateRequest,
      ),
    ).resolves.toMatchObject({
      id: baseAppealResponse.id,
      content: updateRequest.content,
      success: updateRequest.success,
    });

    expect(prismaMock.appealResponse.update).toHaveBeenCalled();
  });

  it('allows admin users to update an appeal response even when the challenge is completed', async () => {
    challengeApiServiceMock.getChallengeDetail.mockResolvedValueOnce({
      id: 'challenge-1',
      status: ChallengeStatus.COMPLETED,
    });

    const adminAuthUser = {
      userId: 'admin-1',
      isMachine: false,
      roles: [UserRole.Admin],
    } as any;

    await expect(
      service.updateAppealResponse(
        adminAuthUser,
        baseAppealResponse.id,
        updateRequest,
      ),
    ).resolves.toMatchObject({
      id: baseAppealResponse.id,
      content: updateRequest.content,
      success: updateRequest.success,
    });

    expect(prismaMock.appealResponse.update).toHaveBeenCalled();
  });

  it('throws BadRequestException when challengeId cannot be determined for non-privileged users', async () => {
    prismaMock.appealResponse.findUnique.mockResolvedValueOnce({
      ...baseAppealResponse,
      appeal: {
        ...baseAppealResponse.appeal,
        reviewItemComment: {
          reviewItem: {
            review: {
              resourceId: 'resource-1',
              submission: {
                challengeId: undefined,
              },
            },
          },
        },
      },
    });

    await expect(
      service.updateAppealResponse(
        reviewerAuthUser,
        baseAppealResponse.id,
        updateRequest,
      ),
    ).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({
        code: 'MISSING_CHALLENGE_ID',
      }),
    });

    expect(prismaMock.appealResponse.update).not.toHaveBeenCalled();
  });
});

describe('AppealService.createAppealResponse', () => {
  const baseAppeal = {
    id: 'appeal-1',
    reviewItemComment: {
      reviewItem: {
        review: {
          resourceId: 'resource-1',
          submission: {
            challengeId: 'challenge-1',
          },
        },
      },
    },
  } as any;

  const baseRequest = {
    content: 'Thanks for the appeal',
    success: true,
  } as any;

  const reviewerAuthUser = {
    userId: 'member-123',
    isMachine: false,
    roles: [],
  } as any;

  beforeEach(() => {
    jest.resetAllMocks();

    challengeApiServiceMock.validateAppealResponseSubmission.mockResolvedValue(
      undefined,
    );
    prismaErrorServiceMock.handleError.mockImplementation((error: any) => {
      throw error;
    });

    resourcePrismaMock.resource.findUnique.mockResolvedValue({
      id: 'resource-1',
      memberId: 'member-123',
    });
  });

  it('throws BadRequestException when the appeal already has a response', async () => {
    prismaMock.appeal.findUniqueOrThrow.mockResolvedValue({
      ...baseAppeal,
      appealResponse: { id: 'appeal-response-1' },
    });

    await expect(
      service.createAppealResponse(
        reviewerAuthUser,
        baseAppeal.id,
        baseRequest,
      ),
    ).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({
        code: 'APPEAL_ALREADY_RESPONDED',
      }),
    });

    expect(prismaMock.appeal.update).not.toHaveBeenCalled();
  });

  it('creates the appeal response using the reviewer resourceId', async () => {
    prismaMock.appeal.findUniqueOrThrow.mockResolvedValue({
      ...baseAppeal,
      appealResponse: null,
    });

    resourcePrismaMock.resource.findUnique.mockResolvedValue({
      id: 'resource-1',
      memberId: 'member-123',
    });

    prismaMock.appeal.update.mockResolvedValue({
      appealResponse: {
        id: 'appeal-response-1',
        resourceId: 'resource-1',
        content: baseRequest.content,
        success: baseRequest.success,
      },
    });

    await expect(
      service.createAppealResponse(
        reviewerAuthUser,
        baseAppeal.id,
        baseRequest,
      ),
    ).resolves.toMatchObject({
      id: 'appeal-response-1',
      resourceId: 'resource-1',
      content: baseRequest.content,
      success: baseRequest.success,
    });

    expect(
      challengeApiServiceMock.validateAppealResponseSubmission,
    ).toHaveBeenCalledWith('challenge-1');
    expect(prismaMock.appeal.update).toHaveBeenCalledWith({
      where: { id: baseAppeal.id },
      data: {
        appealResponse: {
          create: {
            content: baseRequest.content,
            success: baseRequest.success,
            resourceId: 'resource-1',
          },
        },
      },
      include: {
        appealResponse: true,
      },
    });
    expect(resourcePrismaMock.resource.findUnique).toHaveBeenCalledWith({
      where: { id: 'resource-1' },
    });
  });

  it('throws ForbiddenException when requester is not the reviewer', async () => {
    prismaMock.appeal.findUniqueOrThrow.mockResolvedValue({
      ...baseAppeal,
      appealResponse: null,
    });

    resourcePrismaMock.resource.findUnique.mockResolvedValue({
      id: 'resource-1',
      memberId: 'member-123',
    });

    const otherReviewerAuthUser = {
      userId: 'member-999',
      isMachine: false,
      roles: [],
    } as any;

    await expect(
      service.createAppealResponse(
        otherReviewerAuthUser,
        baseAppeal.id,
        baseRequest,
      ),
    ).rejects.toMatchObject({
      status: 403,
      response: expect.objectContaining({
        code: 'APPEAL_RESPONSE_FORBIDDEN',
      }),
    });

    expect(prismaMock.appeal.update).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when reviewer resource is missing', async () => {
    prismaMock.appeal.findUniqueOrThrow.mockResolvedValue({
      ...baseAppeal,
      appealResponse: null,
    });

    resourcePrismaMock.resource.findUnique.mockResolvedValue(null);

    await expect(
      service.createAppealResponse(
        reviewerAuthUser,
        baseAppeal.id,
        baseRequest,
      ),
    ).rejects.toMatchObject({
      status: 404,
      response: expect.objectContaining({
        code: 'REVIEWER_RESOURCE_NOT_FOUND',
      }),
    });

    expect(prismaMock.appeal.update).not.toHaveBeenCalled();
  });

  it('translates Prisma unique constraint errors into BadRequestException', async () => {
    prismaMock.appeal.findUniqueOrThrow.mockResolvedValue({
      ...baseAppeal,
      appealResponse: null,
    });

    const prismaError = new Error('Unique constraint violation');
    prismaMock.appeal.update.mockRejectedValue(prismaError);
    prismaErrorServiceMock.handleError.mockReturnValue({
      message: 'A record with the same appealId already exists.',
      code: 'UNIQUE_CONSTRAINT_FAILED',
      details: { duplicateFields: 'appealId' },
    });

    await expect(
      service.createAppealResponse(
        reviewerAuthUser,
        baseAppeal.id,
        baseRequest,
      ),
    ).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({
        code: 'APPEAL_ALREADY_RESPONDED',
        message: `Appeal with ID ${baseAppeal.id} already has a response.`,
      }),
    });

    expect(prismaErrorServiceMock.handleError).toHaveBeenCalledWith(
      prismaError,
      `creating response for appeal ${baseAppeal.id}`,
    );
  });
});
