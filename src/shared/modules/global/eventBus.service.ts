import {
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { M2MService } from './m2m.service';
import { CommonConfig } from 'src/shared/config/common.config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

/**
 * Event bus message.
 */
class EventBusMessage<T> {
  topic: string;
  originator: string;
  'mime-type': string = 'application/json';
  timestamp: string = new Date().toISOString();
  payload: T;
}

// event bus send email payload
export class EventBusSendEmailPayload {
  // Template-specific variables payload. Structure depends on the sendgrid template.
  data: Record<string, any>;
  from: Record<string, string> = {
    email: 'Topcoder <noreply@topcoder.com>',
  };
  version: string = 'v3';
  sendgrid_template_id: string;
  recipients: string[];
}

@Injectable()
export class EventBusService {
  private readonly logger: Logger = new Logger(EventBusService.name);

  constructor(
    private readonly m2mService: M2MService,
    private readonly httpService: HttpService,
  ) {}

  private async postMessage<T>(
    topic: string,
    payload: T,
    originator = 'review-api-v6',
  ): Promise<void> {
    // Get M2M token
    const token = await this.m2mService.getM2MToken();
    // build event bus message
    const msg = new EventBusMessage<T>();
    msg.topic = topic;
    msg.originator = originator;
    msg.payload = payload;
    // send message to event bus
    const url = CommonConfig.apis.busApiUrl;
    try {
      const response = await firstValueFrom(
        this.httpService.post(url, msg, {
          headers: {
            Authorization: 'Bearer ' + token,
          },
        }),
      );
      const responseStatus: HttpStatus = response.status as HttpStatus;
      if (
        responseStatus !== HttpStatus.OK &&
        responseStatus !== HttpStatus.NO_CONTENT &&
        responseStatus !== HttpStatus.ACCEPTED
      ) {
        throw new Error(`Event bus status code: ${response.status}`);
      }
    } catch (e) {
      this.logger.error(`Event bus failed with error: ${e.message}`);
      throw new InternalServerErrorException(
        'Sending message to event bus failed.',
      );
    }
  }

  /**
   * Send email message to Event bus.
   * @param payload send email payload
   */
  async sendEmail(payload: EventBusSendEmailPayload): Promise<void> {
    await this.postMessage('external.action.email', payload);
  }

  async publish<T>(topic: string, payload: T): Promise<void> {
    await this.postMessage(topic, payload);
  }
}
