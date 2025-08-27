import { Module, DynamicModule } from '@nestjs/common';
import {
  KafkaConsumerService,
  KafkaModuleOptions,
} from './kafka-consumer.service';
import { KafkaHandlerRegistry } from './kafka-handler.registry';
import registeredHandlersConfig from './handlers/registered-handlers.config';

@Module({})
export class KafkaModule {
  static register(options: KafkaModuleOptions): DynamicModule {
    return {
      module: KafkaModule,
      providers: [
        {
          provide: 'KAFKA_OPTIONS',
          useValue: options,
        },
        KafkaHandlerRegistry,
        {
          provide: KafkaConsumerService,
          useFactory: (handlerRegistry: KafkaHandlerRegistry) => {
            return new KafkaConsumerService(options, handlerRegistry);
          },
          inject: [KafkaHandlerRegistry],
        },
        ...registeredHandlersConfig,
      ],
      exports: [KafkaConsumerService, KafkaHandlerRegistry],
    };
  }

  static forRoot(): DynamicModule {
    const kafkaOptions: KafkaModuleOptions = {
      brokers: process.env.KAFKA_BROKERS?.split(',') || ['localhost:9092'],
      clientId: process.env.KAFKA_CLIENT_ID || 'tc-review-api',
      groupId: process.env.KAFKA_GROUP_ID || 'tc-review-consumer-group',
      ssl: process.env.KAFKA_SSL_ENABLED === 'true',
      sasl: process.env.KAFKA_SASL_USERNAME
        ? {
            mechanism:
              (process.env.KAFKA_SASL_MECHANISM as
                | 'plain'
                | 'scram-sha-256'
                | 'scram-sha-512') || 'plain',
            username: process.env.KAFKA_SASL_USERNAME,
            password: process.env.KAFKA_SASL_PASSWORD || '',
          }
        : undefined,
      connectionTimeout: parseInt(
        process.env.KAFKA_CONNECTION_TIMEOUT || '10000',
      ),
      requestTimeout: parseInt(process.env.KAFKA_REQUEST_TIMEOUT || '30000'),
      retry: {
        retries: parseInt(process.env.KAFKA_RETRY_ATTEMPTS || '5'),
        initialRetryTime: parseInt(
          process.env.KAFKA_INITIAL_RETRY_TIME || '100',
        ),
        maxRetryTime: parseInt(process.env.KAFKA_MAX_RETRY_TIME || '30000'),
      },
      dlq: {
        enabled: process.env.KAFKA_DLQ_ENABLED === 'true',
        topicSuffix: process.env.KAFKA_DLQ_TOPIC_SUFFIX || '.dlq',
        maxRetries: parseInt(process.env.KAFKA_DLQ_MAX_RETRIES || '3'),
      },
    };

    return this.register(kafkaOptions);
  }
}
