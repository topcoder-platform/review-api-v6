import { HttpStatus } from '@nestjs/common';
import { of } from 'rxjs';
import { CommonConfig } from 'src/shared/config/common.config';
import { EventBusService } from './eventBus.service';

describe('EventBusService', () => {
  it('forwards a stable Kafka key in the Bus API event envelope', async () => {
    const m2mService = {
      getM2MToken: jest.fn().mockResolvedValue('m2m-token'),
    };
    const httpService = {
      post: jest.fn().mockReturnValue(
        of({
          status: HttpStatus.ACCEPTED,
        }),
      ),
    };
    const service = new EventBusService(
      m2mService as any,
      httpService as any,
    );

    await service.publish(
      'submission.notification.send',
      { recipients: ['member@example.com'] },
      'submission-confirmation:submission-1',
    );

    expect(httpService.post).toHaveBeenCalledWith(
      CommonConfig.apis.busApiUrl,
      expect.objectContaining({
        topic: 'submission.notification.send',
        originator: 'review-api-v6',
        'mime-type': 'application/json',
        timestamp: expect.any(String),
        payload: { recipients: ['member@example.com'] },
        key: 'submission-confirmation:submission-1',
      }),
      {
        headers: {
          Authorization: 'Bearer m2m-token',
        },
      },
    );
  });
});
