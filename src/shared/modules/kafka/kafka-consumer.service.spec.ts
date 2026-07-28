import { Consumer, Producer } from '@platformatic/kafka';
import {
  KafkaConsumerService,
  type KafkaModuleOptions,
} from './kafka-consumer.service';
import type { KafkaHandlerRegistry } from './kafka-handler.registry';

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

describe('KafkaConsumerService configuration', () => {
  const handlerRegistry = {} as KafkaHandlerRegistry;
  const options: KafkaModuleOptions = {
    brokers: ['broker-1:9092', 'broker-2:9092'],
    clientId: 'review-api-test',
    groupId: 'review-api-test-group',
    connectionTimeout: 11000,
    requestTimeout: 31000,
    brokerTimeout: 7000,
    sessionTimeout: 60000,
    heartbeatInterval: 3000,
    maxWaitTime: 5000,
    retry: {
      retries: 5,
      initialRetryTime: 100,
      maxRetryTime: 30000,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('maps transport, broker, and consumer timing options independently', () => {
    const service = new KafkaConsumerService(options, handlerRegistry);

    service.connect();

    expect(Consumer).toHaveBeenCalledWith({
      clientId: 'review-api-test',
      bootstrapBrokers: ['broker-1:9092', 'broker-2:9092'],
      groupId: 'review-api-test-group',
      autocommit: false,
      connectTimeout: 11000,
      requestTimeout: 31000,
      timeout: 7000,
      sessionTimeout: 60000,
      heartbeatInterval: 3000,
      maxWaitTime: 5000,
      retries: 5,
      retryDelay: 100,
    });
    expect(Producer).toHaveBeenCalledWith({
      clientId: 'review-api-test',
      bootstrapBrokers: ['broker-1:9092', 'broker-2:9092'],
      connectTimeout: 11000,
      requestTimeout: 31000,
      timeout: 7000,
      retries: 5,
      retryDelay: 100,
    });
  });

  it('preserves Platformatic defaults when optional timing values are omitted', () => {
    const service = new KafkaConsumerService(
      {
        brokers: ['broker-1:9092'],
        clientId: 'review-api-test',
        groupId: 'review-api-test-group',
      },
      handlerRegistry,
    );

    service.connect();

    expect(Consumer).toHaveBeenCalledWith({
      clientId: 'review-api-test',
      bootstrapBrokers: ['broker-1:9092'],
      groupId: 'review-api-test-group',
      autocommit: false,
    });
    expect(Producer).toHaveBeenCalledWith({
      clientId: 'review-api-test',
      bootstrapBrokers: ['broker-1:9092'],
    });
  });

  it.each([
    ['connectionTimeout', 0],
    ['requestTimeout', Number.NaN],
    ['brokerTimeout', -1],
    ['sessionTimeout', 1.5],
    ['heartbeatInterval', 0],
    ['maxWaitTime', Number.POSITIVE_INFINITY],
  ] satisfies Array<[keyof KafkaModuleOptions, number]>)(
    'rejects invalid %s values',
    (optionName, value) => {
      expect(
        () =>
          new KafkaConsumerService(
            {
              ...options,
              [optionName]: value,
            },
            handlerRegistry,
          ),
      ).toThrow(`Kafka ${optionName} must be a positive integer`);
    },
  );

  it('requires the Fetch wait to be below the transport deadline', () => {
    expect(
      () =>
        new KafkaConsumerService(
          {
            ...options,
            maxWaitTime: options.requestTimeout,
          },
          handlerRegistry,
        ),
    ).toThrow('Kafka maxWaitTime must be less than requestTimeout');
  });

  it('requires the broker timeout to be below the transport deadline', () => {
    expect(
      () =>
        new KafkaConsumerService(
          {
            ...options,
            brokerTimeout: options.requestTimeout,
          },
          handlerRegistry,
        ),
    ).toThrow('Kafka brokerTimeout must be less than requestTimeout');
  });

  it('requires session expiry to exceed a heartbeat plus request deadline', () => {
    expect(
      () =>
        new KafkaConsumerService(
          {
            ...options,
            heartbeatInterval:
              options.sessionTimeout! - options.requestTimeout!,
          },
          handlerRegistry,
        ),
    ).toThrow(
      'Kafka heartbeatInterval plus requestTimeout must be less than sessionTimeout',
    );
  });

  it('validates partial options against Platformatic timing defaults', () => {
    expect(
      () =>
        new KafkaConsumerService(
          {
            brokers: ['broker-1:9092'],
            clientId: 'review-api-test',
            groupId: 'review-api-test-group',
            requestTimeout: 5000,
          },
          handlerRegistry,
        ),
    ).toThrow('Kafka maxWaitTime must be less than requestTimeout');
  });

  it('adds bounded jitter to reconnection backoff', () => {
    const service = new KafkaConsumerService(options, handlerRegistry);
    const getReconnectDelay = (
      service as unknown as {
        getReconnectDelay: (attempt: number) => number;
      }
    ).getReconnectDelay.bind(service);
    const random = jest.spyOn(Math, 'random');

    random.mockReturnValueOnce(0).mockReturnValueOnce(0.9999);

    expect(getReconnectDelay(3)).toBe(200);
    expect(getReconnectDelay(3)).toBe(400);

    random.mockRestore();
  });
});
