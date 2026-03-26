import { Module } from '@nestjs/common';
import { AiReviewEscalationController } from './ai-review-escalation.controller';
import { AiReviewEscalationService } from './ai-review-escalation.service';
import { GlobalProvidersModule } from '../../shared/modules/global/globalProviders.module';

@Module({
  imports: [GlobalProvidersModule],
  controllers: [AiReviewEscalationController],
  providers: [AiReviewEscalationService],
  exports: [AiReviewEscalationService],
})
export class AiReviewEscalationModule {}
