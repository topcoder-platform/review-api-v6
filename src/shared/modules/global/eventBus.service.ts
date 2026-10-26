import { createBusApiClient } from 'tc-core-library-js';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { M2MService } from './m2m.service';
import { CommonConfig } from 'src/shared/config/common.config';
import { HttpService } from '@nestjs/axios';

/**
 * Event bus message.
 */
class EventBusMessage<T> {
  topic: string;
  originator: string;
  'mime-type': string = 'application/json';
  timestamp: string = new Date().toISOString();
  payload: T;
  key?: string;
}

/**
 * Payload accepted by the legacy external.action.email topic.
 */
export class EventBusSendEmailPayload {
  // Template-specific variables payload. Structure depends on the sendgrid template.
  data: Record<string, any>;
  from: string = 'no-reply@topcoder.com';
  replyTo: string = 'no-reply@topcoder.com';
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

  /**
   * Posts a message through tc-core-library-js using the review-api M2M identity.
   *
   * @param topic Event topic to publish.
   * @param payload Topic-specific JSON payload.
   * @param originator Service name recorded on the event.
   * @param key Optional stable Kafka partitioning and correlation key.
   * @returns A promise that resolves after Bus API accepts the event.
   * @throws InternalServerErrorException when token acquisition or Bus API publication fails.
   * Used by sendEmail and publish for all review-api event delivery.
   */
  private async postMessage<T>(
    topic: string,
    payload: T,
    originator = 'review-api-v6',
    key?: string,
  ): Promise<void> {
    // Get M2M token
    // build event bus message
    const msg = new EventBusMessage<T>();
    msg.topic = topic;
    msg.originator = originator;
    msg.payload = payload;
    if (key !== undefined) {
      msg.key = key;
    }
    // send message to event bus
    const url = CommonConfig.apis.busApiUrl;
    try {
      await createBusApiClient({
        BUSAPI_URL: url,
        getToken: () => this.m2mService.getM2MToken(),
      }).postEvent(msg);
    } catch (e) {
      this.logger.error(`Event bus failed with error: ${e.message}`);
      throw new InternalServerErrorException(
        'Sending message to event bus failed.',
      );
    }
  }

  /**
   * Send email through the shared tc-core-library-js bus publisher.
   *
   * @param payload Legacy external.action.email payload, including its template ID.
   * @returns A promise that resolves after Bus API accepts the event.
   * @throws InternalServerErrorException when Bus API publication fails.
   * Used by review-api features that select their SendGrid template directly.
   */
  async sendEmail(payload: EventBusSendEmailPayload): Promise<void> {
    console.log(`${JSON.stringify(payload, null, 2)}`);
    await this.postMessage('external.action.email', payload);
  }

  /**
   * Publishes a topic-specific event through Bus API.
   *
   * @param topic Event topic to publish.
   * @param payload Topic-specific JSON payload.
   * @param key Optional stable Kafka partitioning and correlation key.
   * @returns A promise that resolves after Bus API accepts the event.
   * @throws InternalServerErrorException when Bus API publication fails.
   * Used by submission, scan, workflow, and notification event producers.
   */
  async publish<T>(topic: string, payload: T, key?: string): Promise<void> {
    await this.postMessage(topic, payload, 'review-api-v6', key);
  }
}
