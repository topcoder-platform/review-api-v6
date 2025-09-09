import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { Kafka, Consumer, Producer, KafkaMessage, SASLOptions } from 'kafkajs';
import { KafkaHandlerRegistry } from './kafka-handler.registry';
import { LoggerService } from '../global/logger.service';

export interface KafkaModuleOptions {
  brokers: string[];
  clientId: string;
  groupId: string;
  ssl?: boolean;
  sasl?: SASLOptions;
  connectionTimeout?: number;
  requestTimeout?: number;
  retry?: {
    retries: number;
    initialRetryTime: number;
    maxRetryTime: number;
  };
  dlq?: {
    enabled: boolean;
    topicSuffix: string;
    maxRetries: number;
  };
}

@Injectable()
export class KafkaConsumerService
  implements OnModuleInit, OnModuleDestroy, OnApplicationBootstrap
{
  private kafka: Kafka;
  private consumer: Consumer;
  private producer: Producer;
  private logger: LoggerService;
  private messageRetryCount: Map<string, number> = new Map();

  constructor(
    private readonly options: KafkaModuleOptions,
    private readonly handlerRegistry: KafkaHandlerRegistry,
  ) {
    this.logger = LoggerService.forRoot('KafkaConsumerService');
  }

  onModuleInit() {
    this.connect();
  }

  async onApplicationBootstrap() {
    // await this.subscribeToTopics();
    // await this.startConsumer();
  }

  async onModuleDestroy() {
    await this.disconnect();
  }

  connect(): void {
    try {
      this.kafka = new Kafka({
        clientId: this.options.clientId,
        brokers: this.options.brokers,
        ssl: this.options.ssl || false,
        sasl: this.options.sasl,
        connectionTimeout: this.options.connectionTimeout || 10000,
        requestTimeout: this.options.requestTimeout || 30000,
        retry: this.options.retry || {
          retries: 5,
          initialRetryTime: 100,
          maxRetryTime: 30000,
        },
      });

      this.consumer = this.kafka.consumer({
        groupId: this.options.groupId,
      });

      this.producer = this.kafka.producer();

      this.logger.log('Kafka client and consumer initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Kafka client', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.consumer) {
        await this.consumer.disconnect();
        this.logger.log('Kafka consumer disconnected successfully');
      }
      if (this.producer) {
        await this.producer.disconnect();
        this.logger.log('Kafka producer disconnected successfully');
      }
    } catch (error) {
      this.logger.error('Error during Kafka disconnect', error);
    }
  }

  async subscribeToTopics(): Promise<void> {
    try {
      const topics = this.handlerRegistry.getAllTopics();

      if (topics.length === 0) {
        this.logger.warn(
          'No topics registered for subscription. Skipping Kafka initialization.',
        );
        return;
      }

      for (const topic of topics) {
        await this.consumer.subscribe({ topic });
        this.logger.log(`Subscribed to topic: ${topic}`);
      }
    } catch (error) {
      this.logger.error('Failed to subscribe to topics', error);
      throw error;
    }
  }

  private async startConsumer(): Promise<void> {
    try {
      await this.producer.connect();

      await this.consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
          await this.processMessage(topic, partition, message);
        },
      });

      this.logger.log('Kafka consumer started successfully');
    } catch (error) {
      this.logger.error('Failed to start Kafka consumer', error);
      throw error;
    }
  }

  async processMessage(
    topic: string,
    partition: number,
    message: KafkaMessage,
  ): Promise<void> {
    const startTime = Date.now();
    const messageKey = `${topic}-${partition}-${message.offset}`;

    try {
      this.logger.log({
        message: 'Received Kafka message',
        topic,
        partition,
        offset: message.offset,
        timestamp: message.timestamp,
      });

      const handler = this.handlerRegistry.getHandler(topic);

      if (!handler) {
        this.logger.warn(`No handler registered for topic: ${topic}`);
        return;
      }

      let payload;
      try {
        payload = message.value ? JSON.parse(message.value.toString()) : null;
      } catch (parseError) {
        this.logger.error(
          `Failed to parse message payload for topic ${topic}`,
          parseError,
        );
        await this.sendToDLQ(topic, message, 'Parse error');
        return;
      }

      this.logger.log({
        message: 'Processing message with handler',
        topic,
        handlerName: handler.constructor.name,
      });

      await handler.handle(payload);

      // Reset retry count on successful processing
      this.messageRetryCount.delete(messageKey);

      const processingTime = Date.now() - startTime;
      this.logger.log({
        message: 'Message processed successfully',
        topic,
        processingTime: `${processingTime}ms`,
      });
    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.logger.error({
        message: 'Failed to process message',
        topic,
        error: error.message,
        processingTime: `${processingTime}ms`,
      });

      await this.handleFailedMessage(topic, message, error, messageKey);
    }
  }

  private async handleFailedMessage(
    topic: string,
    message: KafkaMessage,
    error: Error,
    messageKey: string,
  ): Promise<void> {
    if (!this.options.dlq?.enabled) {
      this.logger.error({
        message: 'Message processing failed and DLQ is disabled',
        topic,
        error: error.message,
      });
      return;
    }

    const currentRetryCount = this.messageRetryCount.get(messageKey) || 0;
    const maxRetries = this.options.dlq.maxRetries || 3;

    if (currentRetryCount < maxRetries) {
      this.messageRetryCount.set(messageKey, currentRetryCount + 1);
      this.logger.warn({
        message: `Message processing failed, retry ${currentRetryCount + 1}/${maxRetries}`,
        topic,
        messageKey,
        error: error.message,
      });
      throw error; // Re-throw to trigger Kafka's retry mechanism
    } else {
      this.logger.error({
        message: `Message processing failed after ${maxRetries} retries, sending to DLQ`,
        topic,
        messageKey,
        error: error.message,
      });
      await this.sendToDLQ(topic, message, error.message);
      this.messageRetryCount.delete(messageKey);
    }
  }

  private async sendToDLQ(
    originalTopic: string,
    message: KafkaMessage,
    errorReason: string,
  ): Promise<void> {
    if (!this.options.dlq?.enabled) {
      return;
    }

    try {
      const dlqTopic = `${originalTopic}${this.options.dlq.topicSuffix}`;

      const dlqMessage = {
        originalTopic,
        originalPartition: 0, // Will be set by the partition parameter
        originalOffset: message.offset,
        originalTimestamp: message.timestamp,
        originalKey: message.key?.toString(),
        originalValue: message.value?.toString(),
        errorReason,
        failedAt: new Date().toISOString(),
        headers: message.headers,
      };

      await this.producer.send({
        topic: dlqTopic,
        messages: [
          {
            key: message.key,
            value: JSON.stringify(dlqMessage),
            headers: {
              ...message.headers,
              'dlq-original-topic': originalTopic,
              'dlq-error-reason': errorReason,
              'dlq-failed-at': new Date().toISOString(),
            },
          },
        ],
      });

      this.logger.log({
        message: 'Message sent to DLQ',
        originalTopic,
        dlqTopic,
        errorReason,
      });
    } catch (dlqError) {
      this.logger.error({
        message: 'Failed to send message to DLQ',
        originalTopic,
        errorReason,
        dlqError: dlqError.message,
      });
    }
  }
}
