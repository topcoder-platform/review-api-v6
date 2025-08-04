import { Injectable } from '@nestjs/common';
import { BaseEventHandler } from './base-event.handler';

@Injectable()
export class KafkaHandlerRegistry {
  private readonly handlers = new Map<string, BaseEventHandler>();

  registerHandler(topic: string, handler: BaseEventHandler): void {
    this.handlers.set(topic, handler);
  }

  getHandler(topic: string): BaseEventHandler | undefined {
    return this.handlers.get(topic);
  }

  getAllTopics(): string[] {
    return Array.from(this.handlers.keys());
  }

  hasHandler(topic: string): boolean {
    return this.handlers.has(topic);
  }
}
