import { Module } from '@nestjs/common';
import { AiReviewTemplateController } from './ai-review-template.controller';
import { AiReviewTemplateService } from './ai-review-template.service';
import { GlobalProvidersModule } from '../../shared/modules/global/globalProviders.module';

@Module({
  imports: [GlobalProvidersModule],
  controllers: [AiReviewTemplateController],
  providers: [AiReviewTemplateService],
  exports: [AiReviewTemplateService],
})
export class AiReviewTemplateModule {}
