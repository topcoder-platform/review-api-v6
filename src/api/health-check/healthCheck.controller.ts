import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { PrismaService } from 'src/shared/modules/global/prisma.service';

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
}

@ApiTags('Healthcheck')
@Controller('/reviews')
export class HealthCheckController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('/healthcheck')
  @ApiOperation({ summary: 'Execute a health check' })
  healthCheck(): GetHealthCheckResponseDto {
    const response = new GetHealthCheckResponseDto();

    try {
      this.prisma.scorecard.findFirst({
        select: {
          id: true,
        },
      });

      response.status = HealthCheckStatus.healthy;
      response.database = 'connected';
    } catch (error) {
      console.error('Health check failed', error);
      response.status = HealthCheckStatus.unhealthy;
    }

    return response;
  }
}
