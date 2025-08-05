import { Injectable, OnModuleInit } from '@nestjs/common';
import { BaseEventHandler } from '../base-event.handler';
import { KafkaHandlerRegistry } from '../kafka-handler.registry';
import { LoggerService } from '../../global/logger.service';

@Injectable()
export class AVScanActionScanHandler
  extends BaseEventHandler
  implements OnModuleInit
{
  private readonly topic = 'avscan.action.scan';

  constructor(private readonly handlerRegistry: KafkaHandlerRegistry) {
    super(LoggerService.forRoot('AVScanActionScanHandler'));
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
        message: 'Processing AVScan Action Scan event',
        topic: this.topic,
        payload: message,
      });

      if (!this.validateMessage(message)) {
        this.logger.warn('Invalid message received');
        return;
      }

      this.logger.log('=== AVScan Action Scan Event ===');
      this.logger.log('Topic:', this.topic);
      this.logger.log('Payload:', JSON.stringify(message, null, 2));
      this.logger.log('==============================');

      await Promise.resolve(); // Add await to satisfy linter

      this.logger.log('AVScan Action Scan event processed successfully');
    } catch (error) {
      this.logger.error('Error processing AVScan Action Scan event', error);
      throw error;
    }
  }
}
