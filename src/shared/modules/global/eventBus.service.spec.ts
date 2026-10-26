import { createBusApiClient } from 'tc-core-library-js';
jest.mock('tc-core-library-js', () => ({ createBusApiClient: jest.fn() }));
import { CommonConfig } from 'src/shared/config/common.config';
import { EventBusService } from './eventBus.service';

describe('EventBusService', () => {
  it('forwards a stable Kafka key in the Bus API event envelope', async () => {
    const m2mService = {
      getM2MToken: jest.fn().mockResolvedValue('m2m-token'),
    };
    const postEvent = jest.fn().mockResolvedValue({ status: 202 });
    (createBusApiClient as jest.Mock).mockReturnValue({ postEvent });
    const httpService = {};
    const service = new EventBusService(
      m2mService as any,
      httpService as any,
    );

    await service.publish(
      'submission.notification.send',
      { recipients: ['member@example.com'] },
      'submission-confirmation:submission-1',
    );

    expect(createBusApiClient).toHaveBeenCalledWith(expect.objectContaining({ BUSAPI_URL: CommonConfig.apis.busApiUrl }));
    expect(postEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'submission.notification.send',
        originator: 'review-api-v6',
        'mime-type': 'application/json',
        timestamp: expect.any(String),
        payload: { recipients: ['member@example.com'] },
        key: 'submission-confirmation:submission-1',
      }),
    );
  });
});
