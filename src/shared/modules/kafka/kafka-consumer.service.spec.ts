import { EventEmitter } from 'node:events';
import { Consumer, Producer, type Message } from '@platformatic/kafka';
import {
  KafkaConnectionState,
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

const ConsumerMock = Consumer as unknown as jest.Mock;
const ProducerMock = Producer as unknown as jest.Mock;

/**
 * Creates the subset of a Platformatic consumer used by service unit tests.
 *
 * The EventEmitter base allows tests to exercise real client-level error
 * listener registration without opening a Kafka connection.
 *
 * @returns An event-emitting consumer test double.
 */
function createConsumerClientDouble() {
  return Object.assign(new EventEmitter(), {
    close: jest.fn().mockResolvedValue(undefined),
    consume: jest.fn(),
  });
}

/**
 * Creates the subset of a Platformatic producer used by service unit tests.
 *
 * @returns An event-emitting producer test double.
 */
function createProducerClientDouble() {
  return Object.assign(new EventEmitter(), {
    close: jest.fn().mockResolvedValue(undefined),
    connectToBrokers: jest.fn().mockResolvedValue(new Map()),
    send: jest.fn(),
  });
}

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
    ConsumerMock.mockReturnValue(createConsumerClientDouble());
    ProducerMock.mockReturnValue(createProducerClientDouble());
  });

  it('maps transport, broker, and consumer timing options independently', () => {
    const service = new KafkaConsumerService(options, handlerRegistry);

    service.connect();

    expect(Consumer).toHaveBeenCalledWith({
      clientId: 'review-api-test',
      bootstrapBrokers: ['broker-1:9092', 'broker-2:9092'],
      groupId: 'review-api-test-group',
      autocommit: false,
      maxBytes: 10 * 1024 * 1024,
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
      maxBytes: 10 * 1024 * 1024,
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

describe('KafkaConsumerService recovery', () => {
  const handlerRegistry = {} as KafkaHandlerRegistry;
  const options: KafkaModuleOptions = {
    brokers: ['broker-1:9092', 'broker-2:9092'],
    clientId: 'review-api-test',
    groupId: 'review-api-test-group',
    retry: {
      retries: 5,
      initialRetryTime: 100,
      maxRetryTime: 30000,
    },
  };

  let consumerClient: ReturnType<typeof createConsumerClientDouble>;
  let producerClient: ReturnType<typeof createProducerClientDouble>;

  beforeEach(() => {
    jest.clearAllMocks();
    consumerClient = createConsumerClientDouble();
    producerClient = createProducerClientDouble();
    ConsumerMock.mockReturnValue(consumerClient);
    ProducerMock.mockReturnValue(producerClient);
  });

  it('routes consumer-level errors through reconnection and health state', () => {
    const service = new KafkaConsumerService(options, handlerRegistry);
    const scheduleReconnect = jest
      .spyOn(
        service as unknown as {
          scheduleReconnect: () => Promise<void>;
        },
        'scheduleReconnect',
      )
      .mockResolvedValue(undefined);

    service.connect();
    consumerClient.emit('error', new Error('consumer coordinator failed'));

    expect(scheduleReconnect).toHaveBeenCalledTimes(1);
    expect(service.getKafkaStatus()).toMatchObject({
      state: KafkaConnectionState.reconnecting,
      reconnectAttempts: 0,
    });
    expect(service.getKafkaStatus().reason).toContain(
      'consumer coordinator failed',
    );
  });

  it('routes producer-level errors through reconnection and health state', () => {
    const service = new KafkaConsumerService(options, handlerRegistry);
    const scheduleReconnect = jest
      .spyOn(
        service as unknown as {
          scheduleReconnect: () => Promise<void>;
        },
        'scheduleReconnect',
      )
      .mockResolvedValue(undefined);

    service.connect();
    producerClient.emit('error', new Error('producer connection failed'));

    expect(scheduleReconnect).toHaveBeenCalledTimes(1);
    expect(service.getKafkaStatus()).toMatchObject({
      state: KafkaConnectionState.reconnecting,
      reconnectAttempts: 0,
    });
    expect(service.getKafkaStatus().reason).toContain(
      'producer connection failed',
    );
  });

  it('routes failed offset commits through reconnection and health state', async () => {
    const handler = {
      handle: jest.fn().mockResolvedValue(undefined),
    };
    const registry = {
      getHandler: jest.fn().mockReturnValue(handler),
    } as unknown as KafkaHandlerRegistry;
    const service = new KafkaConsumerService(options, registry);
    const scheduleReconnect = jest
      .spyOn(
        service as unknown as {
          scheduleReconnect: () => Promise<void>;
        },
        'scheduleReconnect',
      )
      .mockResolvedValue(undefined);
    const message = {
      key: Buffer.alloc(0),
      value: Buffer.from('{"submissionId":"submission-123"}'),
      headers: new Map<Buffer, Buffer>(),
      topic: 'submission.scan.complete',
      partition: 7,
      timestamp: 123n,
      offset: 686n,
      metadata: {},
      commit: jest.fn().mockRejectedValue(new Error('offset commit timed out')),
      toJSON: jest.fn(),
    } as unknown as Message<Buffer, Buffer, Buffer, Buffer>;

    await service.processMessage(
      'submission.scan.complete',
      message.partition,
      message,
    );

    expect(handler.handle).toHaveBeenCalledTimes(1);
    expect(handler.handle).toHaveBeenCalledWith({
      submissionId: 'submission-123',
    });
    expect(message.commit).toHaveBeenCalledTimes(1);
    expect(scheduleReconnect).toHaveBeenCalledTimes(1);
    expect(service.getKafkaStatus()).toMatchObject({
      state: KafkaConnectionState.reconnecting,
      reconnectAttempts: 0,
    });
    expect(service.getKafkaStatus().reason).toContain(
      'offset commit timed out',
    );
  });

  it('keeps failed-to-close detached emitters error-safe', async () => {
    const service = new KafkaConsumerService(options, handlerRegistry);
    const stream = Object.assign(new EventEmitter(), {
      close: jest.fn().mockRejectedValue(new Error('stream close failed')),
    });
    const scheduleReconnect = jest
      .spyOn(
        service as unknown as {
          scheduleReconnect: () => Promise<void>;
        },
        'scheduleReconnect',
      )
      .mockResolvedValue(undefined);

    consumerClient.close.mockRejectedValue(new Error('consumer close failed'));
    producerClient.close.mockRejectedValue(new Error('producer close failed'));
    service.connect();
    (
      service as unknown as {
        stream?: typeof stream;
      }
    ).stream = stream;

    await service.disconnect();

    expect(stream.close).toHaveBeenCalledTimes(1);
    expect(consumerClient.close).toHaveBeenCalledTimes(1);
    expect(producerClient.close).toHaveBeenCalledTimes(1);
    expect(() =>
      stream.emit('error', new Error('late stream error')),
    ).not.toThrow();
    expect(() =>
      consumerClient.emit('error', new Error('late consumer error')),
    ).not.toThrow();
    expect(() =>
      producerClient.emit('error', new Error('late producer error')),
    ).not.toThrow();
    expect(scheduleReconnect).not.toHaveBeenCalled();
  });

  it('deduplicates reconnect scheduling while a reconnect is active', async () => {
    const service = new KafkaConsumerService(options, handlerRegistry);
    let completeReconnect: () => void = () => undefined;
    const pendingReconnect = new Promise<void>((resolve) => {
      completeReconnect = resolve;
    });
    const performReconnect = jest
      .spyOn(
        service as unknown as {
          performReconnect: () => Promise<void>;
        },
        'performReconnect',
      )
      .mockReturnValue(pendingReconnect);

    service.connect();
    consumerClient.emit('error', new Error('consumer failed'));
    producerClient.emit('error', new Error('producer failed'));

    expect(performReconnect).toHaveBeenCalledTimes(1);
    expect(service.getKafkaStatus().state).toBe(
      KafkaConnectionState.reconnecting,
    );

    completeReconnect();
    await pendingReconnect;
    await Promise.resolve();

    expect(performReconnect).toHaveBeenCalledTimes(1);
  });

  it('queues a replacement-client error while the active reconnect settles', async () => {
    const service = new KafkaConsumerService(options, handlerRegistry);
    let completeReconnect: () => void = () => undefined;
    const pendingReconnect = new Promise<void>((resolve) => {
      completeReconnect = resolve;
    });
    const performReconnect = jest
      .spyOn(
        service as unknown as {
          performReconnect: () => Promise<void>;
        },
        'performReconnect',
      )
      .mockReturnValueOnce(pendingReconnect)
      .mockResolvedValueOnce(undefined);

    service.connect();
    consumerClient.emit('error', new Error('initial consumer failure'));

    (
      service as unknown as {
        kafkaState: KafkaConnectionState;
      }
    ).kafkaState = KafkaConnectionState.ready;
    producerClient.emit('error', new Error('replacement producer failed'));

    const activeReconnect = (
      service as unknown as {
        reconnectionTask?: Promise<void>;
      }
    ).reconnectionTask;

    completeReconnect();
    await activeReconnect;
    await Promise.resolve();

    expect(performReconnect).toHaveBeenCalledTimes(2);
    expect(service.getKafkaStatus()).toMatchObject({
      state: KafkaConnectionState.reconnecting,
    });
    expect(service.getKafkaStatus().reason).toContain(
      'replacement producer failed',
    );
  });
});
