import { SubmissionConfirmationDispatchStatus } from '../../global/submission-confirmation-email.service';
import { SubmissionNotificationCreateHandler } from './submission-notification-create.handler';

jest.mock('nanoid', () => ({
  __esModule: true,
  nanoid: () => 'mock-nanoid',
}));

describe('SubmissionNotificationCreateHandler', () => {
  const sourceMessage = {
    topic: 'submission.notification.create',
    originator: 'review-api-v6',
    payload: {
      resource: 'submission',
      id: 'submission-1',
      memberId: 'untrusted-member',
      challengeId: 'untrusted-challenge',
    },
  };

  let handlerRegistry: { registerHandler: jest.Mock };
  let confirmationService: { dispatchForSubmission: jest.Mock };
  let handler: SubmissionNotificationCreateHandler;

  beforeEach(() => {
    handlerRegistry = {
      registerHandler: jest.fn(),
    };
    confirmationService = {
      dispatchForSubmission: jest
        .fn()
        .mockResolvedValue(SubmissionConfirmationDispatchStatus.PUBLISHED),
    };
    handler = new SubmissionNotificationCreateHandler(
      handlerRegistry as any,
      confirmationService as any,
    );
  });

  it('registers the submission-created topic', () => {
    handler.onModuleInit();

    expect(handler.getTopic()).toBe('submission.notification.create');
    expect(handlerRegistry.registerHandler).toHaveBeenCalledWith(
      'submission.notification.create',
      handler,
    );
  });

  it('dispatches the durable request using only the event submission id', async () => {
    await handler.handle(sourceMessage);

    expect(confirmationService.dispatchForSubmission).toHaveBeenCalledWith(
      'submission-1',
    );
  });

  it.each([
    ['missing envelope payload', {}],
    ['missing submission id', { payload: { resource: 'submission' } }],
    [
      'unexpected resource',
      { payload: { resource: 'review', id: 'submission-1' } },
    ],
  ])('skips %s', async (_description, message) => {
    await handler.handle(message);

    expect(confirmationService.dispatchForSubmission).not.toHaveBeenCalled();
  });

  it('propagates dispatch failures for Kafka retry', async () => {
    confirmationService.dispatchForSubmission.mockRejectedValue(
      new Error('Bus unavailable'),
    );

    await expect(handler.handle(sourceMessage)).rejects.toThrow(
      'Bus unavailable',
    );
  });
});
