import { Injectable, OnModuleInit } from '@nestjs/common';
import { LoggerService } from '../../global/logger.service';
import { SubmissionConfirmationEmailService } from '../../global/submission-confirmation-email.service';
import { BaseEventHandler } from '../base-event.handler';
import { KafkaHandlerRegistry } from '../kafka-handler.registry';

interface SubmissionCreatedEventPayload {
  resource?: unknown;
  id?: unknown;
}

interface SubmissionCreatedEventEnvelope {
  payload?: SubmissionCreatedEventPayload;
}

/**
 * Converts an untrusted event value to a trimmed nonempty string.
 *
 * @param value Event or database value to normalize.
 * @returns A trimmed string, or undefined when the value is not usable.
 * @throws This function never throws.
 * Used by the submission confirmation handler before identifiers and template
 * values are passed to database or event-bus collaborators.
 */
function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

/**
 * Bridges persisted submission-created events to the durable confirmation
 * dispatcher. The submission row owns a related request created atomically
 * during member submission persistence, so Kafka provides a low-latency trigger
 * while scheduled recovery protects against missed or failed triggers.
 *
 * This provider is registered in GlobalProvidersModule. Nest calls
 * onModuleInit to subscribe it through KafkaHandlerRegistry.
 */
@Injectable()
export class SubmissionNotificationCreateHandler
  extends BaseEventHandler
  implements OnModuleInit
{
  private readonly topic = 'submission.notification.create';

  /**
   * Creates the submission confirmation event bridge.
   *
   * @param handlerRegistry Registry used to subscribe this handler's topic.
   * @param confirmationService Durable dispatcher for the persisted request.
   * @throws This constructor does not intentionally throw.
   */
  constructor(
    private readonly handlerRegistry: KafkaHandlerRegistry,
    private readonly confirmationService: SubmissionConfirmationEmailService,
  ) {
    super(LoggerService.forRoot('SubmissionNotificationCreateHandler'));
  }

  /**
   * Registers this instance for submission.notification.create messages.
   *
   * @returns Nothing.
   * @throws Propagates unexpected registry failures.
   * Called by Nest during module initialization before Kafka consumption starts.
   */
  onModuleInit(): void {
    this.handlerRegistry.registerHandler(this.topic, this);
    this.logger.log(`Registered handler for topic: ${this.topic}`);
  }

  /**
   * Returns the source topic consumed by this handler.
   *
   * @returns submission.notification.create.
   * @throws This method never throws.
   * Used by the Kafka registry and structured message logging.
   */
  getTopic(): string {
    return this.topic;
  }

  /**
   * Triggers durable confirmation dispatch for a persisted submission.
   *
   * @param message Decoded Bus API envelope received from Kafka.
   * @returns A promise resolved after a terminal skip or dispatcher completion.
   * @throws Propagates dispatcher failures so Kafka retry and scheduled recovery can retry the durable request.
   * Used by KafkaConsumerService for submission.notification.create events.
   */
  async handle(message: SubmissionCreatedEventEnvelope): Promise<void> {
    this.logMessage(message);

    if (!this.validateMessage(message) || !message.payload) {
      this.logger.warn('Invalid submission-created message received');
      return;
    }

    const resource = toNonEmptyString(message.payload.resource);
    if (resource !== undefined && resource !== 'submission') {
      this.logger.warn(
        `Ignoring ${this.topic} event for unexpected resource ${resource}`,
      );
      return;
    }

    const eventSubmissionId = toNonEmptyString(message.payload.id);
    if (!eventSubmissionId) {
      this.logger.warn(
        'Submission ID is missing in the submission-created message',
      );
      return;
    }

    const status =
      await this.confirmationService.dispatchForSubmission(eventSubmissionId);
    this.logger.log(
      `Submission confirmation dispatch completed for ${eventSubmissionId} with status ${status}`,
    );
  }
}
