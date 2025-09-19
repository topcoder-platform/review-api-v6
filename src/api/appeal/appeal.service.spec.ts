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
  );

  const baseAppeal = {
    id: 'appeal-1',
    reviewItemComment: {
      reviewItem: {
        review: {
          submission: {
            challengeId: 'challenge-1',
          },
        },
      },
    },
  } as any;

  const baseRequest = {
    content: 'Thanks for the appeal',
    resourceId: 'responder-1',
    success: true,
  } as any;

  beforeEach(() => {
    jest.resetAllMocks();

    challengeApiServiceMock.validateAppealResponseSubmission.mockResolvedValue(
      undefined,
    );
  });

  it('throws BadRequestException when the appeal already has a response', async () => {
    prismaMock.appeal.findUniqueOrThrow.mockResolvedValue({
      ...baseAppeal,
      appealResponse: { id: 'appeal-response-1' },
    });

    await expect(
      service.createAppealResponse(baseAppeal.id, baseRequest),
    ).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({
        code: 'APPEAL_ALREADY_RESPONDED',
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
      service.createAppealResponse(baseAppeal.id, baseRequest),
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
