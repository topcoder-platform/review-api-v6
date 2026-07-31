import { SubmissionConfirmationEmailRetryService } from './submission-confirmation-email-retry.service';

jest.mock('nanoid', () => ({
  __esModule: true,
  nanoid: () => 'mock-nanoid',
}));

describe('SubmissionConfirmationEmailRetryService', () => {
  it('runs the durable recovery pass', async () => {
    const confirmationService = {
      retryPendingConfirmations: jest.fn().mockResolvedValue({
        candidates: 1,
        published: 1,
        skipped: 0,
        failed: 0,
      }),
    };
    const service = new SubmissionConfirmationEmailRetryService(
      confirmationService as any,
    );

    await service.retryPendingConfirmations();

    expect(
      confirmationService.retryPendingConfirmations,
    ).toHaveBeenCalledTimes(1);
  });

  it('contains recovery failures so later schedules can continue', async () => {
    const confirmationService = {
      retryPendingConfirmations: jest
        .fn()
        .mockRejectedValueOnce(new Error('Database unavailable'))
        .mockResolvedValueOnce({
          candidates: 0,
          published: 0,
          skipped: 0,
          failed: 0,
        }),
    };
    const service = new SubmissionConfirmationEmailRetryService(
      confirmationService as any,
    );

    await expect(service.retryPendingConfirmations()).resolves.toBeUndefined();
    await expect(service.retryPendingConfirmations()).resolves.toBeUndefined();

    expect(
      confirmationService.retryPendingConfirmations,
    ).toHaveBeenCalledTimes(2);
  });
});
