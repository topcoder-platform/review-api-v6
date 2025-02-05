import { Module } from '@nestjs/common';
import { GlobalProvidersModule } from 'src/shared/modules/global/globalProviders.module';
import { HealthCheckController } from './health-check/healthCheck.controller';

@Module({
  imports: [GlobalProvidersModule],
  controllers: [HealthCheckController],
  providers: [],
})
export class ApiModule {}
