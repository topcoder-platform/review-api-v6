import { Module } from '@nestjs/common';
import { AiReviewConfigController } from './ai-review-config.controller';
import { AiReviewConfigService } from './ai-review-config.service';
import { GlobalProvidersModule } from '../../shared/modules/global/globalProviders.module';

@Module({
  imports: [GlobalProvidersModule],
  controllers: [AiReviewConfigController],
  providers: [AiReviewConfigService],
  exports: [AiReviewConfigService],
})
export class AiReviewConfigModule {}
