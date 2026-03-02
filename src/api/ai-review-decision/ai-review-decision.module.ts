import { Module } from '@nestjs/common';
import { AiReviewDecisionController } from './ai-review-decision.controller';
import { AiReviewDecisionService } from './ai-review-decision.service';
import { GlobalProvidersModule } from '../../shared/modules/global/globalProviders.module';

@Module({
  imports: [GlobalProvidersModule],
  controllers: [AiReviewDecisionController],
  providers: [AiReviewDecisionService],
  exports: [AiReviewDecisionService],
})
export class AiReviewDecisionModule {}
