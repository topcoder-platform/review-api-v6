import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { GlobalProvidersModule } from 'src/shared/modules/global/globalProviders.module';
import { HealthCheckController } from './health-check/healthCheck.controller';
import { ScorecardController } from './scorecard/scorecard.controller';
import { AppealController } from './appeal/appeal.controller';
import { ContactRequestsController } from './contact/contactRequests.controller';
import { ReviewController } from './review/review.controller';
import { ProjectResultController } from './project-result/projectResult.controller';
import { ReviewOpportunityController } from './review-opportunity/reviewOpportunity.controller';
import { ReviewApplicationController } from './review-application/reviewApplication.controller';
import { ReviewOpportunityService } from './review-opportunity/reviewOpportunity.service';
import { ReviewApplicationService } from './review-application/reviewApplication.service';
import { ReviewHistoryController } from './review-history/reviewHistory.controller';
import { ChallengeApiService } from 'src/shared/modules/global/challenge.service';
import { WebhookController } from './webhook/webhook.controller';
import { WebhookService } from './webhook/webhook.service';
import { GiteaSignatureGuard } from '../shared/guards/gitea-signature.guard';

@Module({
  imports: [HttpModule, GlobalProvidersModule],
  controllers: [
    HealthCheckController,
    ScorecardController,
    AppealController,
    ContactRequestsController,
    ReviewController,
    ProjectResultController,
    ReviewOpportunityController,
    ReviewApplicationController,
    ReviewHistoryController,
    WebhookController,
  ],
  providers: [
    ReviewOpportunityService,
    ReviewApplicationService,
    ChallengeApiService,
    WebhookService,
    GiteaSignatureGuard,
  ],
})
export class ApiModule {}
