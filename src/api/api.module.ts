import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { GlobalProvidersModule } from 'src/shared/modules/global/globalProviders.module';
import { FileUploadModule } from 'src/shared/modules/global/file-upload.module';
import { HealthCheckController } from './health-check/healthCheck.controller';
import { ScorecardController } from './scorecard/scorecard.controller';
import { AppealController } from './appeal/appeal.controller';
import { ContactRequestsController } from './contact/contactRequests.controller';
import { ReviewController } from './review/review.controller';
import { ProjectResultModule } from './project-result/projectResult.module';

import { ReviewTypeController } from './review-type/review-type.controller';
import { SubmissionController } from './submission/submission.controller';
import { ReviewSummationController } from './review-summation/review-summation.controller';
import { ReviewOpportunityController } from './review-opportunity/reviewOpportunity.controller';
import { ReviewApplicationController } from './review-application/reviewApplication.controller';
import { ReviewOpportunityService } from './review-opportunity/reviewOpportunity.service';
import { ReviewApplicationService } from './review-application/reviewApplication.service';
import { ReviewHistoryController } from './review-history/reviewHistory.controller';
import { ChallengeApiService } from 'src/shared/modules/global/challenge.service';
import { ResourceApiService } from 'src/shared/modules/global/resource.service';
import { SubmissionService } from './submission/submission.service';
import { ReviewSummationService } from './review-summation/review-summation.service';
import { WebhookController } from './webhook/webhook.controller';
import { WebhookService } from './webhook/webhook.service';
import { GiteaWebhookAuthGuard } from '../shared/guards/gitea-webhook-auth.guard';
import { ScoreCardService } from './scorecard/scorecard.service';
import { AiWorkflowService } from './ai-workflow/ai-workflow.service';
import { AiWorkflowController } from './ai-workflow/ai-workflow.controller';
import { ReviewService } from './review/review.service';

@Module({
  imports: [
    HttpModule,
    GlobalProvidersModule,
    FileUploadModule,
    ProjectResultModule,
  ],
  controllers: [
    HealthCheckController,
    ScorecardController,
    AppealController,
    ContactRequestsController,
    ReviewController,
    ReviewTypeController,
    SubmissionController,
    ReviewSummationController,
    ReviewOpportunityController,
    ReviewApplicationController,
    ReviewHistoryController,
    WebhookController,
    AiWorkflowController,
  ],
  providers: [
    ReviewService,
    ReviewOpportunityService,
    ReviewApplicationService,
    ChallengeApiService,
    ResourceApiService,
    WebhookService,
    GiteaWebhookAuthGuard,
    ScoreCardService,
    SubmissionService,
    ReviewSummationService,
    AiWorkflowService,
  ],
})
export class ApiModule {}
