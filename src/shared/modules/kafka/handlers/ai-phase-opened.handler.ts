import { Injectable, OnModuleInit } from '@nestjs/common';
import { KafkaHandlerRegistry } from '../kafka-handler.registry';
import { BaseEventHandler } from '../base-event.handler';
import { LoggerService } from '../../global/logger.service';
import { AiPhaseOpenedOrchestrator } from '../../global/ai-phase-opened.orchestrator';

@Injectable()
export class AiPhaseOpenedHandler
  extends BaseEventHandler
  implements OnModuleInit
{
  private readonly topic = 'autopilot.ai.phase.opened';

  constructor(
    private readonly handlerRegistry: KafkaHandlerRegistry,
    private readonly orchestrator: AiPhaseOpenedOrchestrator,
  ) {
    super(LoggerService.forRoot('AiPhaseOpenedHandler'));
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
        message: 'Processing AI phase opened event',
        topic: this.topic,
        payload: message,
      });

      if (!this.validateMessage(message)) {
        this.logger.warn('Invalid message received');
        return;
      }

      const challengeId = String(message.payload?.challengeId ?? '').trim();
      if (!challengeId) {
        this.logger.warn('AI phase opened event missing challengeId; skipping.');
        return;
      }

      if (process.env.DISPATCH_AI_REVIEW_WORKFLOWS !== 'true') {
        this.logger.log(
          'AI workflow dispatch is disabled. Skipping AI phase opened orchestration.',
        );
        return;
      }

      await this.orchestrator.orchestrateChallengePhaseOpened(challengeId);
      this.logger.log('AI phase opened event processed successfully');
    } catch (error) {
      this.logger.error('Error processing AI phase opened event', error);
      throw error;
    }
  }
}
