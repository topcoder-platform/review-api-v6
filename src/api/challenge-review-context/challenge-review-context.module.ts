import { Module } from '@nestjs/common';
import { ChallengeReviewContextController } from './challenge-review-context.controller';
import { ChallengeReviewContextService } from './challenge-review-context.service';
import { GlobalProvidersModule } from '../../shared/modules/global/globalProviders.module';

@Module({
  imports: [GlobalProvidersModule],
  controllers: [ChallengeReviewContextController],
  providers: [ChallengeReviewContextService],
  exports: [ChallengeReviewContextService],
})
export class ChallengeReviewContextModule {}
