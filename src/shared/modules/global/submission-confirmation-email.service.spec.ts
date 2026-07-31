import {
  SubmissionConfirmationDispatchStatus,
  SubmissionConfirmationEmailService,
} from './submission-confirmation-email.service';

jest.mock('nanoid', () => ({
  __esModule: true,
  nanoid: () => 'mock-nanoid',
}));

describe('SubmissionConfirmationEmailService', () => {
  const now = new Date('2026-07-30T00:10:00.000Z');
  const staleBefore = new Date('2026-07-30T00:05:00.000Z');
  const nextRetryAt = new Date('2026-07-30T00:15:00.000Z');

  let prisma: {
    submission: {
      findUnique: jest.Mock;
    };
    submissionConfirmationEmail: {
      updateMany: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
    };
  };
  let memberService: { getUserEmails: jest.Mock };
  let challengeApiService: { getChallengeDetail: jest.Mock };
  let eventBusService: { publish: jest.Mock };
  let service: SubmissionConfirmationEmailService;

  beforeEach(() => {
    prisma = {
      submission: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'submission-1',
          memberId: '12345',
          challengeId: 'challenge-1',
        }),
      },
      submissionConfirmationEmail: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    memberService = {
      getUserEmails: jest.fn().mockResolvedValue([
        {
          userId: '12345',
          email: 'member@example.com',
          handle: 'memberHandle',
        },
      ]),
    };
    challengeApiService = {
      getChallengeDetail: jest.fn().mockResolvedValue({
        id: 'challenge-1',
        name: 'Example Challenge',
      }),
    };
    eventBusService = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    service = new SubmissionConfirmationEmailService(
      prisma as any,
      memberService as any,
      challengeApiService as any,
      eventBusService as any,
    );
  });

  it('claims the request and publishes the exact email-service payload', async () => {
    const result = await service.dispatchForSubmission('submission-1', now);
    const processingToken =
      prisma.submissionConfirmationEmail.updateMany.mock.calls[0][0].data
        .processingToken;

    expect(result).toBe(SubmissionConfirmationDispatchStatus.PUBLISHED);
    expect(processingToken).toEqual(expect.any(String));
    expect(
      prisma.submissionConfirmationEmail.updateMany,
    ).toHaveBeenNthCalledWith(1, {
      where: {
        submissionId: 'submission-1',
        publishedAt: null,
        nextAttemptAt: { lte: now },
        OR: [
          { processingStartedAt: null },
          { processingStartedAt: { lt: staleBefore } },
        ],
      },
      data: {
        processingStartedAt: now,
        processingToken,
        attemptCount: { increment: 1 },
        lastError: null,
      },
    });
    expect(prisma.submission.findUnique).toHaveBeenCalledWith({
      where: { id: 'submission-1' },
      select: {
        id: true,
        memberId: true,
        challengeId: true,
      },
    });
    expect(memberService.getUserEmails).toHaveBeenCalledWith(['12345']);
    expect(challengeApiService.getChallengeDetail).toHaveBeenCalledWith(
      'challenge-1',
    );
    expect(eventBusService.publish).toHaveBeenCalledWith(
      'submission.notification.send',
      {
        recipients: ['member@example.com'],
        version: 'v3',
        data: {
          submitter: { handle: 'memberHandle' },
          challenge: { challengeTitle: 'Example Challenge' },
          submission: {
            id: 'submission-1',
            challengeId: 'challenge-1',
          },
        },
      },
      'submission-confirmation:submission-1',
    );
    expect(
      prisma.submissionConfirmationEmail.updateMany,
    ).toHaveBeenNthCalledWith(2, {
      where: {
        submissionId: 'submission-1',
        publishedAt: null,
        processingToken,
      },
      data: {
        processingStartedAt: null,
        processingToken: null,
        publishedAt: expect.any(Date),
        lastError: null,
      },
    });
    expect(eventBusService.publish.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.submissionConfirmationEmail.updateMany.mock.invocationCallOrder[1],
    );
  });

  it('suppresses a replay after the request was published', async () => {
    prisma.submissionConfirmationEmail.updateMany.mockResolvedValue({
      count: 0,
    });
    prisma.submissionConfirmationEmail.findUnique.mockResolvedValue({
      publishedAt: new Date('2026-07-30T00:00:00.000Z'),
      processingStartedAt: null,
    });

    const result = await service.dispatchForSubmission('submission-1', now);

    expect(result).toBe(
      SubmissionConfirmationDispatchStatus.ALREADY_PUBLISHED,
    );
    expect(prisma.submission.findUnique).not.toHaveBeenCalled();
    expect(eventBusService.publish).not.toHaveBeenCalled();
  });

  it('does not duplicate a request currently leased by another task', async () => {
    prisma.submissionConfirmationEmail.updateMany.mockResolvedValue({
      count: 0,
    });
    prisma.submissionConfirmationEmail.findUnique.mockResolvedValue({
      publishedAt: null,
      processingStartedAt: new Date('2026-07-30T00:09:00.000Z'),
    });

    const result = await service.dispatchForSubmission('submission-1', now);

    expect(result).toBe(SubmissionConfirmationDispatchStatus.IN_PROGRESS);
    expect(eventBusService.publish).not.toHaveBeenCalled();
  });

  it('does not create confirmation intent for an unrequested historical submission', async () => {
    prisma.submissionConfirmationEmail.updateMany.mockResolvedValue({
      count: 0,
    });
    prisma.submissionConfirmationEmail.findUnique.mockResolvedValue(null);

    const result = await service.dispatchForSubmission('submission-1', now);

    expect(result).toBe(SubmissionConfirmationDispatchStatus.NOT_REQUESTED);
    expect(prisma.submission.findUnique).not.toHaveBeenCalled();
    expect(eventBusService.publish).not.toHaveBeenCalled();
  });

  it('retains enrichment failures and releases the request for recovery', async () => {
    memberService.getUserEmails.mockResolvedValue([]);

    await expect(
      service.dispatchForSubmission('submission-1', now),
    ).rejects.toThrow('has no usable email or handle');
    const processingToken =
      prisma.submissionConfirmationEmail.updateMany.mock.calls[0][0].data
        .processingToken;

    expect(
      prisma.submissionConfirmationEmail.updateMany,
    ).toHaveBeenNthCalledWith(2, {
      where: {
        submissionId: 'submission-1',
        publishedAt: null,
        processingToken,
      },
      data: {
        processingStartedAt: null,
        processingToken: null,
        nextAttemptAt: nextRetryAt,
        lastError: 'Member 12345 has no usable email or handle',
      },
    });
    expect(eventBusService.publish).not.toHaveBeenCalled();
  });

  it('retains publication failures and does not mark the request published', async () => {
    eventBusService.publish.mockRejectedValue(new Error('Bus unavailable'));

    await expect(
      service.dispatchForSubmission('submission-1', now),
    ).rejects.toThrow('Bus unavailable');
    const processingToken =
      prisma.submissionConfirmationEmail.updateMany.mock.calls[0][0].data
        .processingToken;

    expect(
      prisma.submissionConfirmationEmail.updateMany,
    ).toHaveBeenNthCalledWith(2, {
      where: {
        submissionId: 'submission-1',
        publishedAt: null,
        processingToken,
      },
      data: {
        processingStartedAt: null,
        processingToken: null,
        nextAttemptAt: nextRetryAt,
        lastError: 'Bus unavailable',
      },
    });
  });

  it('does not let a stale failing worker release a newer worker lease', async () => {
    let activeToken: string | null = null;
    prisma.submissionConfirmationEmail.updateMany.mockImplementation(
      async (operation) => {
        if (operation.data.attemptCount) {
          activeToken = operation.data.processingToken;
          return { count: 1 };
        }
        if (operation.where.processingToken === activeToken) {
          activeToken = null;
          return { count: 1 };
        }
        return { count: 0 };
      },
    );
    memberService.getUserEmails.mockImplementation(async () => {
      activeToken = 'newer-worker-token';
      throw new Error('First worker timed out');
    });

    await expect(
      service.dispatchForSubmission('submission-1', now),
    ).rejects.toThrow('First worker timed out');

    const staleToken =
      prisma.submissionConfirmationEmail.updateMany.mock.calls[0][0].data
        .processingToken;
    expect(staleToken).not.toBe('newer-worker-token');
    expect(
      prisma.submissionConfirmationEmail.updateMany,
    ).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          processingToken: staleToken,
        }),
      }),
    );
    expect(activeToken).toBe('newer-worker-token');
  });

  it('records an accepted publication after its original lease expires', async () => {
    prisma.submissionConfirmationEmail.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    const result = await service.dispatchForSubmission('submission-1', now);

    expect(result).toBe(SubmissionConfirmationDispatchStatus.PUBLISHED);
    expect(
      prisma.submissionConfirmationEmail.updateMany,
    ).toHaveBeenNthCalledWith(3, {
      where: {
        submissionId: 'submission-1',
        publishedAt: null,
      },
      data: {
        processingStartedAt: null,
        processingToken: null,
        publishedAt: expect.any(Date),
        lastError: null,
      },
    });
  });

  it('recovers a bounded pending batch and counts individual failures', async () => {
    prisma.submissionConfirmationEmail.findMany.mockResolvedValue([
      { submissionId: 'submission-1' },
      { submissionId: 'submission-2' },
      { submissionId: 'submission-3' },
    ]);
    jest
      .spyOn(service, 'dispatchForSubmission')
      .mockResolvedValueOnce(SubmissionConfirmationDispatchStatus.PUBLISHED)
      .mockResolvedValueOnce(SubmissionConfirmationDispatchStatus.IN_PROGRESS)
      .mockRejectedValueOnce(new Error('temporary failure'));

    const result = await service.retryPendingConfirmations({
      now,
      limit: 3,
    });

    expect(prisma.submissionConfirmationEmail.findMany).toHaveBeenCalledWith({
      where: {
        publishedAt: null,
        nextAttemptAt: { lte: now },
        OR: [
          { processingStartedAt: null },
          { processingStartedAt: { lt: staleBefore } },
        ],
      },
      orderBy: [
        { nextAttemptAt: 'asc' },
        { createdAt: 'asc' },
        { submissionId: 'asc' },
      ],
      take: 3,
      select: { submissionId: true },
    });
    expect(result).toEqual({
      candidates: 3,
      published: 1,
      skipped: 1,
      failed: 1,
    });
  });
});
