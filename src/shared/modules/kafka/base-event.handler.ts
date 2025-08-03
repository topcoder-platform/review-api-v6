import { LoggerService } from '../global/logger.service';

export abstract class BaseEventHandler {
  protected logger: LoggerService;

  constructor(logger: LoggerService) {
    this.logger = logger;
  }

  abstract handle(message: any): Promise<void>;
  abstract getTopic(): string;

  protected logMessage(message: any): void {
    this.logger.log({
      message: 'Processing Kafka message',
      topic: this.getTopic(),
      payload: message,
    });
  }

  protected validateMessage(message: any): boolean {
    return message !== null && message !== undefined;
  }
}
