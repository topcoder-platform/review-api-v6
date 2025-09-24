import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  OnApplicationBootstrap,
} from '@nestjs/common';
import {
  Consumer,
  Producer,
  type Message,
  MessagesStream,
  type ConsumerOptions,
  type ProducerOptions,
  type SASLOptions as PlatformaticSASLOptions,
} from '@platformatic/kafka';
import { KafkaHandlerRegistry } from './kafka-handler.registry';
import { LoggerService } from '../global/logger.service';

export type KafkaSaslMechanism =
  | 'plain'
  | 'scram-sha-256'
  | 'scram-sha-512'
  | 'oauthbearer';

export interface KafkaSaslOptions {
  mechanism: KafkaSaslMechanism;
  username?: string;
  password?: string;
  token?: string;
}

export interface KafkaModuleOptions {
  brokers: string[];
  clientId: string;
  groupId: string;
  ssl?: boolean;
  sasl?: KafkaSaslOptions;
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
  disabled?: boolean;
}

@Injectable()
export class KafkaConsumerService
  implements OnModuleInit, OnModuleDestroy, OnApplicationBootstrap
{
  private consumer?: Consumer<Buffer, Buffer, Buffer, Buffer>;
  private producer?: Producer<Buffer, Buffer, Buffer, Buffer>;
  private stream?: MessagesStream<Buffer, Buffer, Buffer, Buffer>;
  private consumerLoop?: Promise<void>;
  private logger: LoggerService;
  private messageRetryCount: Map<string, number> = new Map();
  private readonly isDisabled: boolean;

  constructor(
    private readonly options: KafkaModuleOptions,
    private readonly handlerRegistry: KafkaHandlerRegistry,
  ) {
    this.logger = LoggerService.forRoot('KafkaConsumerService');
    this.isDisabled = options.disabled ?? false;
  }

  onModuleInit() {
    if (this.isDisabled) {
      this.logger.warn(
        'Kafka consumer disabled via DISABLE_KAFKA environment variable.',
      );
      return;
    }
    this.connect();
  }

  async onApplicationBootstrap() {
    if (this.isDisabled) {
      return;
    }
    await this.startConsumer();
  }

  async onModuleDestroy() {
    if (this.isDisabled) {
      return;
    }
    await this.disconnect();
  }

  connect(): void {
    try {
      this.consumer = new Consumer(this.createConsumerOptions());
      this.producer = new Producer(this.createProducerOptions());

      this.logger.log('Kafka consumer and producer initialized successfully');
    } catch (error) {
      const trace =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      this.logger.error('Failed to initialize Kafka client', trace);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.stream) {
        await this.stream.close();
        this.stream.removeAllListeners();
        this.stream = undefined;
      }

      if (this.consumerLoop) {
        try {
          await this.consumerLoop;
        } catch (error) {
          const trace =
            error instanceof Error
              ? (error.stack ?? error.message)
              : String(error);
          this.logger.error('Kafka consumer loop terminated with error', trace);
        } finally {
          this.consumerLoop = undefined;
        }
      }

      if (this.consumer) {
        await Promise.resolve(this.consumer.close(true));
        this.logger.log('Kafka consumer disconnected successfully');
      }

      if (this.producer) {
        await Promise.resolve(this.producer.close());
        this.logger.log('Kafka producer disconnected successfully');
      }
    } catch (error) {
      const trace =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      this.logger.error('Error during Kafka disconnect', trace);
    }
  }

  subscribeToTopics(): void {
    const topics = this.handlerRegistry.getAllTopics();

    if (topics.length === 0) {
      this.logger.warn(
        'No topics registered for subscription. Skipping Kafka initialization.',
      );
      return;
    }

    this.logger.log({
      message: 'Kafka topics registered for consumption',
      topics,
    });
  }

  private async startConsumer(): Promise<void> {
    if (!this.consumer || !this.producer) {
      throw new Error('Kafka consumer is not initialized');
    }

    const topics = this.handlerRegistry.getAllTopics();

    if (topics.length === 0) {
      this.logger.warn(
        'No topics registered for subscription. Skipping Kafka consumer start.',
      );
      return;
    }

    try {
      await this.producer.connectToBrokers(null);

      this.stream = await this.consumer.consume({
        topics,
        autocommit: false,
      });

      this.stream.on('error', (error) => {
        const trace =
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error);
        this.logger.error('Kafka consumer stream error', trace);
      });

      this.consumerLoop = this.consumeStream(this.stream);

      this.logger.log('Kafka consumer started successfully');
    } catch (error) {
      const trace =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      this.logger.error('Failed to start Kafka consumer', trace);
      throw error;
    }
  }

  private async consumeStream(
    stream: MessagesStream<Buffer, Buffer, Buffer, Buffer>,
  ): Promise<void> {
    try {
      for await (const message of stream) {
        await this.processMessage(message.topic, message.partition, message);
      }
    } catch (error) {
      const trace =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      this.logger.error('Kafka consumer stream processing failed', trace);
      throw error;
    }
  }

  async processMessage(
    topic: string,
    partition: number,
    message: Message<Buffer, Buffer, Buffer, Buffer>,
  ): Promise<void> {
    const startTime = Date.now();
    const offsetString = message.offset.toString();
    const messageKey = `${topic}-${partition}-${offsetString}`;

    this.logger.log({
      message: 'Received Kafka message',
      topic,
      partition,
      offset: offsetString,
      timestamp: message.timestamp?.toString(),
    });

    const handler = this.handlerRegistry.getHandler(topic);

    if (!handler) {
      this.logger.warn(`No handler registered for topic: ${topic}`);
      await this.commitMessage(message);
      return;
    }

    let payload: any = null;

    if (message.value) {
      try {
        payload = JSON.parse(message.value.toString());
      } catch (parseError) {
        const trace =
          parseError instanceof Error
            ? (parseError.stack ?? parseError.message)
            : String(parseError);
        this.logger.error(
          `Failed to parse message payload for topic ${topic}`,
          trace,
        );
        await this.sendToDLQ(topic, message, 'Parse error');
        await this.commitMessage(message);
        return;
      }
    }

    this.logger.log({
      message: 'Processing message with handler',
      topic,
      handlerName: handler.constructor.name,
    });

    let attempt = this.messageRetryCount.get(messageKey) ?? 0;

    while (true) {
      try {
        await handler.handle(payload);
        this.messageRetryCount.delete(messageKey);

        const processingTime = Date.now() - startTime;
        this.logger.log({
          message: 'Message processed successfully',
          topic,
          processingTime: `${processingTime}ms`,
        });

        await this.commitMessage(message);
        return;
      } catch (error) {
        const processingTime = Date.now() - startTime;
        this.logger.error({
          message: 'Failed to process message',
          topic,
          error: (error as Error).message,
          attempt: attempt + 1,
          processingTime: `${processingTime}ms`,
        });

        const shouldRetry = await this.handleFailedMessage(
          topic,
          message,
          error as Error,
          messageKey,
          attempt,
        );

        if (!shouldRetry) {
          this.messageRetryCount.delete(messageKey);
          await this.commitMessage(message);
          return;
        }

        attempt += 1;
        this.messageRetryCount.set(messageKey, attempt);

        await this.wait(this.getRetryDelay(attempt));
      }
    }
  }

  private async handleFailedMessage(
    topic: string,
    message: Message<Buffer, Buffer, Buffer, Buffer>,
    error: Error,
    messageKey: string,
    currentRetryCount: number,
  ): Promise<boolean> {
    if (!this.options.dlq?.enabled) {
      this.logger.error({
        message: 'Message processing failed and DLQ is disabled',
        topic,
        error: error.message,
      });
      return false;
    }

    const maxRetries = this.options.dlq.maxRetries || 3;

    if (currentRetryCount < maxRetries) {
      this.logger.warn({
        message: `Message processing failed, retry ${currentRetryCount + 1}/${maxRetries}`,
        topic,
        messageKey,
        error: error.message,
      });

      return true;
    }

    this.logger.error({
      message: `Message processing failed after ${maxRetries} retries, sending to DLQ`,
      topic,
      messageKey,
      error: error.message,
    });

    await this.sendToDLQ(topic, message, error.message);
    return false;
  }

  private async sendToDLQ(
    originalTopic: string,
    message: Message<Buffer, Buffer, Buffer, Buffer>,
    errorReason: string,
  ): Promise<void> {
    if (!this.options.dlq?.enabled || !this.producer) {
      return;
    }

    try {
      const dlqTopic = `${originalTopic}${this.options.dlq.topicSuffix}`;

      const dlqMessage = {
        originalTopic,
        originalPartition: message.partition,
        originalOffset: message.offset.toString(),
        originalTimestamp: message.timestamp?.toString(),
        originalKey: message.key?.toString(),
        originalValue: message.value?.toString(),
        errorReason,
        failedAt: new Date().toISOString(),
        headers: this.extractHeaders(message),
      };

      await this.producer.send({
        messages: [
          {
            topic: dlqTopic,
            key: message.key,
            value: Buffer.from(JSON.stringify(dlqMessage)),
            headers: this.buildProducerHeaders(message, {
              'dlq-original-topic': originalTopic,
              'dlq-error-reason': errorReason,
              'dlq-failed-at': new Date().toISOString(),
            }),
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
        dlqError:
          dlqError instanceof Error ? dlqError.message : String(dlqError),
      });
    }
  }

  private extractHeaders(
    message: Message<Buffer, Buffer, Buffer, Buffer>,
  ): Record<string, string> {
    const headers: Record<string, string> = {};

    for (const [headerKey, headerValue] of message.headers.entries()) {
      headers[headerKey.toString()] = headerValue.toString();
    }

    return headers;
  }

  private buildProducerHeaders(
    message: Message<Buffer, Buffer, Buffer, Buffer>,
    extras: Record<string, string>,
  ): Record<string, Buffer> {
    const headers: Record<string, Buffer> = {};

    for (const [headerKey, headerValue] of message.headers.entries()) {
      headers[headerKey.toString()] = headerValue;
    }

    for (const [key, value] of Object.entries(extras)) {
      headers[key] = Buffer.from(value);
    }

    return headers;
  }

  private async commitMessage(
    message: Message<Buffer, Buffer, Buffer, Buffer>,
  ): Promise<void> {
    try {
      await message.commit();
    } catch (commitError) {
      const error =
        commitError instanceof Error
          ? commitError
          : new Error(String(commitError));
      this.logger.error(
        'Failed to commit message offset',
        error.stack ?? error.message,
      );
    }
  }

  private async wait(delayMs: number): Promise<void> {
    if (delayMs <= 0) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  private getRetryDelay(attempt: number): number {
    const baseDelay = this.options.retry?.initialRetryTime ?? 100;
    const maxDelay = this.options.retry?.maxRetryTime ?? 30000;
    const exponent = Math.max(attempt - 1, 0);
    const calculatedDelay = baseDelay * Math.pow(2, exponent);

    return Math.min(calculatedDelay, maxDelay);
  }

  private createConsumerOptions(): ConsumerOptions<
    Buffer,
    Buffer,
    Buffer,
    Buffer
  > {
    const consumerOptions: ConsumerOptions<Buffer, Buffer, Buffer, Buffer> = {
      clientId: this.options.clientId,
      bootstrapBrokers: this.options.brokers,
      groupId: this.options.groupId,
      autocommit: false,
    };

    if (this.options.connectionTimeout !== undefined) {
      consumerOptions.connectTimeout = this.options.connectionTimeout;
    }

    if (this.options.requestTimeout !== undefined) {
      consumerOptions.timeout = this.options.requestTimeout;
      consumerOptions.maxWaitTime = this.options.requestTimeout;
    }

    if (this.options.retry?.retries !== undefined) {
      consumerOptions.retries = this.options.retry.retries;
    }

    if (this.options.retry?.initialRetryTime !== undefined) {
      consumerOptions.retryDelay = this.options.retry.initialRetryTime;
    }

    const sasl = this.mapSaslOptions(this.options.sasl);
    if (sasl) {
      consumerOptions.sasl = sasl;
    }

    if (this.options.ssl) {
      consumerOptions.tls = {};
    }

    return consumerOptions;
  }

  private createProducerOptions(): ProducerOptions<
    Buffer,
    Buffer,
    Buffer,
    Buffer
  > {
    const producerOptions: ProducerOptions<Buffer, Buffer, Buffer, Buffer> = {
      clientId: this.options.clientId,
      bootstrapBrokers: this.options.brokers,
    };

    if (this.options.connectionTimeout !== undefined) {
      producerOptions.connectTimeout = this.options.connectionTimeout;
    }

    if (this.options.requestTimeout !== undefined) {
      producerOptions.timeout = this.options.requestTimeout;
    }

    if (this.options.retry?.retries !== undefined) {
      producerOptions.retries = this.options.retry.retries;
    }

    if (this.options.retry?.initialRetryTime !== undefined) {
      producerOptions.retryDelay = this.options.retry.initialRetryTime;
    }

    const sasl = this.mapSaslOptions(this.options.sasl);
    if (sasl) {
      producerOptions.sasl = sasl;
    }

    if (this.options.ssl) {
      producerOptions.tls = {};
    }

    return producerOptions;
  }

  private mapSaslOptions(
    sasl?: KafkaSaslOptions,
  ): PlatformaticSASLOptions | undefined {
    if (!sasl) {
      return undefined;
    }

    const mechanismMap: Record<
      KafkaSaslMechanism,
      PlatformaticSASLOptions['mechanism']
    > = {
      plain: 'PLAIN',
      'scram-sha-256': 'SCRAM-SHA-256',
      'scram-sha-512': 'SCRAM-SHA-512',
      oauthbearer: 'OAUTHBEARER',
    };

    const mechanism = mechanismMap[sasl.mechanism];

    if (!mechanism) {
      this.logger.warn(`Unsupported SASL mechanism: ${sasl.mechanism}`);
      return undefined;
    }

    return {
      mechanism,
      username: sasl.username,
      password: sasl.password,
      token: sasl.token,
    };
  }
}
