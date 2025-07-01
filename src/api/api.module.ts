import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { GlobalProvidersModule } from 'src/shared/modules/global/globalProviders.module';
import { FileUploadModule } from 'src/shared/modules/global/file-upload.module';
import { HealthCheckController } from './health-check/healthCheck.controller';
import { ScorecardController } from './scorecard/scorecard.controller';
import { AppealController } from './appeal/appeal.controller';
import { ContactRequestsController } from './contact/contactRequests.controller';
import { ReviewController } from './review/review.controller';
import { ProjectResultController } from './project-result/projectResult.controller';

import { ReviewTypeController } from './review-type/review-type.controller';
import { SubmissionController } from './submission/submission.controller';
import { ReviewSummationController } from './review-summation/review-summation.controller';
import { ReviewOpportunityController } from './review-opportunity/reviewOpportunity.controller';
import { ReviewApplicationController } from './review-application/reviewApplication.controller';
import { ReviewOpportunityService } from './review-opportunity/reviewOpportunity.service';
import { ReviewApplicationService } from './review-application/reviewApplication.service';
import { ReviewHistoryController } from './review-history/reviewHistory.controller';
import { ChallengeApiService } from 'src/shared/modules/global/challenge.service';

@Module({
  imports: [HttpModule, GlobalProvidersModule, FileUploadModule],
  controllers: [
    HealthCheckController,
    ScorecardController,
    AppealController,
    ContactRequestsController,
    ReviewController,
    ProjectResultController,
    ReviewTypeController,
    SubmissionController,
    ReviewSummationController,
    ReviewOpportunityController,
    ReviewApplicationController,
    ReviewHistoryController
  ],
  providers: [ReviewOpportunityService, ReviewApplicationService, ChallengeApiService],
})
export class ApiModule {}
