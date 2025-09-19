jest.mock('nanoid', () => ({
  __esModule: true,
  nanoid: () => 'mock-nanoid',
}));

import { AppealService } from './appeal.service';

describe('AppealService.createAppealResponse', () => {
  const prismaMock = {
    appeal: {
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
  } as unknown as any;

  const resourcePrismaMock = {
    resource: {
      findUnique: jest.fn(),
    },
  } as unknown as any;

  const prismaErrorServiceMock = {
    handleError: jest.fn(),
  } as unknown as any;

  const challengeApiServiceMock = {
    validateAppealResponseSubmission: jest.fn(),
  } as unknown as any;

  const service = new AppealService(
    prismaMock,
    prismaErrorServiceMock,
    challengeApiServiceMock,
    resourcePrismaMock,
  );

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
