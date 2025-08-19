import { Injectable, OnModuleInit } from '@nestjs/common';
import { BaseEventHandler } from '../base-event.handler';
import { KafkaHandlerRegistry } from '../kafka-handler.registry';
import { LoggerService } from '../../global/logger.service';
import { SubmissionScanCompleteOrchestrator } from '../../global/submission-scan-complete.orchestrator';

@Injectable()
export class SubmissionScanCompleteHandler
  extends BaseEventHandler
  implements OnModuleInit
{
  private readonly topic = 'submission.scan.complete';

  constructor(
    private readonly handlerRegistry: KafkaHandlerRegistry,
    private readonly orchestrator: SubmissionScanCompleteOrchestrator,
  ) {
    super(LoggerService.forRoot('SubmissionScanCompleteHandler'));
  }

  onModuleInit() {
    this.handlerRegistry.registerHandler(this.topic, this);
    this.logger.log(`Registered handler for topic: ${this.topic}`);
  }

  getTopic(): string {
    return this.topic;
  }

  async handle(message: any): Promise<void> {
    try {
      this.logger.log({
        message: 'Processing Submission Scan Complete event',
        topic: this.topic,
        payload: message,
      });

      if (!this.validateMessage(message)) {
        this.logger.warn('Invalid message received');
        return;
      }

      this.logger.log('=== Submission Scan Complete Event ===');
      this.logger.log('Topic: ' + this.topic);
      this.logger.log('Payload: ' + JSON.stringify(message, null, 2));
      this.logger.log('==============================');

      if (process.env.DISPATCH_AI_REVIEW_WORKFLOWS !== 'true') {
        this.logger.log(
          'AI Review Workflows are disabled. Skipping orchestration.',
        );
        return;
      }

      if (!message.isInfected) {
        // delegate to orchestrator for further processing
        await this.orchestrator.orchestrateScanComplete(message.submissionId);
      } else {
        this.logger.log(
          `Submission ${message.submissionId} is infected, skipping further processing.`,
        );
      }

      this.logger.log('Submission Scan Complete event processed successfully');
    } catch (error) {
      this.logger.error(
        'Error processing Submission Scan Complete event',
        error,
      );
      throw error;
    }
  }
}
