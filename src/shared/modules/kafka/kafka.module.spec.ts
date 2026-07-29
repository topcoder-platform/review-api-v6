import type { DynamicModule } from '@nestjs/common';
import {
  KafkaConsumerService,
  type KafkaModuleOptions,
} from './kafka-consumer.service';
import type { KafkaHandlerRegistry } from './kafka-handler.registry';
import { KafkaModule } from './kafka.module';
import { KAFKA_TIMING_DEFAULTS } from './kafka.constants';

jest.mock('@platformatic/kafka', () => ({
  Consumer: jest.fn(),
  Producer: jest.fn(),
}));

jest.mock('../global/logger.service', () => ({
  LoggerService: {
    forRoot: jest.fn(() => ({
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    })),
  },
}));

const timingEnvironmentVariables = [
  'KAFKA_CONNECTION_TIMEOUT',
  'KAFKA_REQUEST_TIMEOUT',
  'KAFKA_BROKER_TIMEOUT',
  'KAFKA_SESSION_TIMEOUT',
  'KAFKA_HEARTBEAT_INTERVAL',
  'KAFKA_MAX_WAIT_TIME',
] as const;

/**
 * Extracts the environment-backed Kafka options from a dynamic module.
 *
 * Tests use this helper to verify the values that KafkaModule.forRoot passes
 * to KafkaConsumerService without starting a Nest application.
 *
 * @param moduleDefinition The dynamic Kafka module returned by forRoot.
 * @returns The resolved Kafka module options.
 * @throws {Error} If the module does not contain its Kafka options provider.
 */
function getKafkaOptions(moduleDefinition: DynamicModule): KafkaModuleOptions {
  const optionsProvider = moduleDefinition.providers?.find(
    (provider) =>
      typeof provider === 'object' &&
      provider !== null &&
      'provide' in provider &&
      provider.provide === 'KAFKA_OPTIONS',
  );

  if (!optionsProvider || !('useValue' in optionsProvider)) {
    throw new Error('Kafka options provider was not registered');
  }

  return optionsProvider.useValue as KafkaModuleOptions;
}

describe('KafkaModule timing configuration', () => {
  const originalEnvironment = new Map<string, string | undefined>();

  beforeAll(() => {
    for (const variable of timingEnvironmentVariables) {
      originalEnvironment.set(variable, process.env[variable]);
    }
  });

  beforeEach(() => {
    for (const variable of timingEnvironmentVariables) {
      delete process.env[variable];
    }
  });

  afterAll(() => {
    for (const [variable, value] of originalEnvironment) {
      if (value === undefined) {
        delete process.env[variable];
      } else {
        process.env[variable] = value;
      }
    }
  });

  it('uses safe timing defaults', () => {
    const options = getKafkaOptions(KafkaModule.forRoot());

    expect(options).toMatchObject(KAFKA_TIMING_DEFAULTS);
  });

  it('maps timing environment variables independently', () => {
    process.env.KAFKA_CONNECTION_TIMEOUT = '12000';
    process.env.KAFKA_REQUEST_TIMEOUT = '40000';
    process.env.KAFKA_BROKER_TIMEOUT = '6000';
    process.env.KAFKA_SESSION_TIMEOUT = '70000';
    process.env.KAFKA_HEARTBEAT_INTERVAL = '4000';
    process.env.KAFKA_MAX_WAIT_TIME = '8000';

    const options = getKafkaOptions(KafkaModule.forRoot());

    expect(options).toMatchObject({
      connectionTimeout: 12000,
      requestTimeout: 40000,
      brokerTimeout: 6000,
      sessionTimeout: 70000,
      heartbeatInterval: 4000,
      maxWaitTime: 8000,
    });
  });

  it('rejects malformed environment values during service creation', () => {
    process.env.KAFKA_REQUEST_TIMEOUT = '30000ms';
    const options = getKafkaOptions(KafkaModule.forRoot());

    expect(
      () => new KafkaConsumerService(options, {} as KafkaHandlerRegistry),
    ).toThrow('Kafka requestTimeout must be a positive integer');
  });
});
