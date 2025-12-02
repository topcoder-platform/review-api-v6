import { ServiceUnavailableException } from '@nestjs/common';
import {
  HealthCheckController,
  HealthCheckStatus,
} from './healthCheck.controller';
import { KafkaConnectionState } from 'src/shared/modules/kafka/kafka-consumer.service';
import type { PrismaService } from 'src/shared/modules/global/prisma.service';
import type { KafkaConsumerService } from 'src/shared/modules/kafka/kafka-consumer.service';

type PrismaServiceLike = {
  scorecard: {
    findFirst: jest.Mock;
  };
};

type KafkaConsumerServiceLike = {
  getKafkaStatus: jest.Mock;
};

jest.mock('src/shared/modules/global/prisma.service', () => ({
  PrismaService: class PrismaServiceMock {},
}));

jest.mock('src/shared/modules/kafka/kafka-consumer.service', () => {
  const KafkaConnectionStateMock = {
    disabled: 'disabled',
    initializing: 'initializing',
    ready: 'ready',
    reconnecting: 'reconnecting',
    failed: 'failed',
  } as const;

  class KafkaConsumerServiceMock {
    getKafkaStatus() {
      return {
        state: KafkaConnectionStateMock.ready,
        reconnectAttempts: 0,
      };
    }
  }

  return {
    KafkaConnectionState: KafkaConnectionStateMock,
    KafkaConsumerService: KafkaConsumerServiceMock,
  };
});

describe('HealthCheckController', () => {
  let prismaService: PrismaServiceLike;
  let kafkaConsumerService: KafkaConsumerServiceLike;
  let controller: HealthCheckController;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    prismaService = {
      scorecard: {
        findFirst: jest.fn(),
      },
    };

    kafkaConsumerService = {
      getKafkaStatus: jest.fn(),
    };

    controller = new HealthCheckController(
      prismaService as unknown as PrismaService,
      kafkaConsumerService as unknown as KafkaConsumerService,
    );
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('returns a healthy response when dependencies are available', async () => {
    prismaService.scorecard.findFirst.mockResolvedValue({
      id: 1,
    });
    kafkaConsumerService.getKafkaStatus.mockReturnValue({
      state: KafkaConnectionState.ready,
      reconnectAttempts: 0,
    });

    const result = await controller.healthCheck();

    expect(result.status).toBe(HealthCheckStatus.healthy);
    expect(result.database).toBe('connected');
    expect(result.kafka).toBe(KafkaConnectionState.ready);
  });

  it('throws when Kafka reconnection attempts are exhausted', async () => {
    prismaService.scorecard.findFirst.mockResolvedValue({
      id: 1,
    });
    kafkaConsumerService.getKafkaStatus.mockReturnValue({
      state: KafkaConnectionState.failed,
      reconnectAttempts: 5,
      reason: 'Kafka reconnection attempts exhausted',
    });

    await expect(controller.healthCheck()).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('throws when the database query fails', async () => {
    prismaService.scorecard.findFirst.mockRejectedValue(new Error('db down'));
    kafkaConsumerService.getKafkaStatus.mockReturnValue({
      state: KafkaConnectionState.ready,
      reconnectAttempts: 0,
    });

    await expect(controller.healthCheck()).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});
