import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { PrismaService } from 'src/shared/modules/global/prisma.service';
import {
  KafkaConnectionState,
  KafkaConsumerService,
} from 'src/shared/modules/kafka/kafka-consumer.service';

export enum HealthCheckStatus {
  healthy = 'healthy',
  unhealthy = 'unhealthy',
}

export class GetHealthCheckResponseDto {
  @ApiProperty({
    description: 'The status of the health check',
    enum: HealthCheckStatus,
    example: HealthCheckStatus.healthy,
  })
  status: HealthCheckStatus;

  @ApiProperty({
    description: 'Database connection status',
    example: 'Connected',
  })
  database: string;

  @ApiProperty({
    description: 'Kafka consumer connection status',
    enum: KafkaConnectionState,
    example: KafkaConnectionState.ready,
  })
  kafka: KafkaConnectionState;

  @ApiProperty({
    description: 'Additional detail describing an unhealthy dependency',
    required: false,
    example: 'Kafka reconnection attempts exhausted',
  })
  detail?: string;
}

@ApiTags('Healthcheck')
@Controller('/reviews')
export class HealthCheckController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kafkaConsumerService: KafkaConsumerService,
  ) {}

  @Get('/healthcheck')
  @ApiOperation({ summary: 'Execute a health check' })
  async healthCheck(): Promise<GetHealthCheckResponseDto> {
    const response = new GetHealthCheckResponseDto();
    response.status = HealthCheckStatus.healthy;

    const kafkaStatus = this.kafkaConsumerService.getKafkaStatus();
    response.kafka = kafkaStatus.state;

    try {
      await this.prisma.scorecard.findFirst({
        select: {
          id: true,
        },
      });

      response.database = 'connected';
    } catch (error) {
      console.error('Health check failed', error);
      response.status = HealthCheckStatus.unhealthy;
      response.database = 'disconnected';
      response.detail = 'Failed to connect to database';

      throw new ServiceUnavailableException(response);
    }

    if (kafkaStatus.state === KafkaConnectionState.failed) {
      response.status = HealthCheckStatus.unhealthy;
      response.detail =
        kafkaStatus.reason ?? 'Kafka consumer reconnection attempts exhausted';

      throw new ServiceUnavailableException(response);
    }

    return response;
  }
}
