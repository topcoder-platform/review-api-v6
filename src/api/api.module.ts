import { Module } from '@nestjs/common';
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

@Module({
  imports: [GlobalProvidersModule, FileUploadModule],
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
  ],
  providers: [],
  exports: [],
})
export class ApiModule {}
