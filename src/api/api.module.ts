import { Module } from '@nestjs/common';
import { GlobalProvidersModule } from 'src/shared/modules/global/globalProviders.module';
import { HealthCheckController } from './health-check/healthCheck.controller';
import { ScorecardController } from './scorecard/scorecard.controller';
import { AppealController } from './appeal/appeal.controller';
import { ContactRequestsController } from './contact/contactRequests.controller';
import { ReviewController } from './review/review.controller';
import { ProjectResultController } from './project-result/projectResult.controller';

@Module({
  imports: [GlobalProvidersModule],
  controllers: [
    HealthCheckController,
    ScorecardController,
    AppealController,
    ContactRequestsController,
    ReviewController,
    ProjectResultController,
  ],
  providers: [],
})
export class ApiModule {}
