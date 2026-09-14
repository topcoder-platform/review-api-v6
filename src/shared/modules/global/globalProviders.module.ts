import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { HttpModule } from '@nestjs/axios';
import { PrismaService } from './prisma.service';
import { TokenRolesGuard } from '../../guards/tokenRoles.guard';
import { JwtService } from './jwt.service';
import { LoggerService } from './logger.service';
import { PrismaErrorService } from './prisma-error.service';
import { M2MService } from './m2m.service';
import { ChallengeApiService } from './challenge.service';
import { EventBusService } from './eventBus.service';
import { MemberService } from './member.service';
import { ResourceApiService } from './resource.service';
import { ResourcePrismaService } from './resource-prisma.service';
import { KafkaModule } from '../kafka/kafka.module';
import { SubmissionBaseService } from './submission-base.service';
import { GiteaService } from './gitea.service';
import { SubmissionScanCompleteOrchestrator } from './submission-scan-complete.orchestrator';
import { AiPhaseOpenedOrchestrator } from './ai-phase-opened.orchestrator';
import { AiWorkflowQueueService } from './ai-workflow-queue.service';
import { ChallengeCatalogService } from './challenge-catalog.service';
import { SubmissionService } from 'src/api/submission/submission.service';
import { ChallengePrismaService } from './challenge-prisma.service';
import { MemberPrismaService } from './member-prisma.service';
import { WorkflowQueueHandler } from './workflow-queue.handler';
import { AiReviewerDecisionMakerService } from './ai-reviewer-decision-maker.service';
import { SubmissionScanCompleteHandler } from '../kafka/handlers/submission-scan-complete.handler';
import { AiPhaseOpenedHandler } from '../kafka/handlers/ai-phase-opened.handler';
import { SubmissionVirusScanRetryService } from './submission-virus-scan-retry.service';
import { SubmissionNotificationCreateHandler } from '../kafka/handlers/submission-notification-create.handler';
import { SubmissionConfirmationEmailService } from './submission-confirmation-email.service';
import { SubmissionConfirmationEmailRetryService } from './submission-confirmation-email-retry.service';
import { SubmissionPreviewService } from './submission-preview.service';
import { GiteaTeamMembershipService } from './gitea-team-membership.service';
import { GiteaTeamSearchService } from './gitea-team-search.service';
import { ChallengeResourceCreateHandler } from '../kafka/handlers/challenge-resource-create.handler';
import { ChallengeResourceDeleteHandler } from '../kafka/handlers/challenge-resource-delete.handler';

// Global module for providing global providers
// Add any provider you want to be global here
@Global()
@Module({
  imports: [HttpModule, KafkaModule.forRoot()],
  providers: [
    {
      provide: APP_GUARD,
      useClass: TokenRolesGuard,
    },
    PrismaService,
    JwtService,
    {
      provide: LoggerService,
      useFactory: () => {
        return new LoggerService('Global');
      },
    },
    PrismaErrorService,
    M2MService,
    ChallengeApiService,
    ChallengeCatalogService,
    ChallengePrismaService,
    MemberPrismaService,
    ResourcePrismaService,
    ResourceApiService,
    EventBusService,
    MemberService,
    SubmissionBaseService,
    GiteaService,
    GiteaTeamMembershipService,
    GiteaTeamSearchService,
    SubmissionScanCompleteOrchestrator,
    AiPhaseOpenedOrchestrator,
    AiWorkflowQueueService,
    SubmissionService,
    WorkflowQueueHandler,
    AiReviewerDecisionMakerService,
    SubmissionScanCompleteHandler,
    SubmissionNotificationCreateHandler,
    ChallengeResourceCreateHandler,
    ChallengeResourceDeleteHandler,
    SubmissionConfirmationEmailService,
    SubmissionConfirmationEmailRetryService,
    SubmissionPreviewService,
    AiPhaseOpenedHandler,
    SubmissionVirusScanRetryService,
  ],
  exports: [
    KafkaModule,
    PrismaService,
    JwtService,
    LoggerService,
    PrismaErrorService,
    M2MService,
    ChallengeApiService,
    ChallengeCatalogService,
    ChallengePrismaService,
    MemberPrismaService,
    ResourcePrismaService,
    ResourceApiService,
    EventBusService,
    MemberService,
    SubmissionBaseService,
    GiteaService,
    GiteaTeamMembershipService,
    GiteaTeamSearchService,
    SubmissionScanCompleteOrchestrator,
    AiPhaseOpenedOrchestrator,
    AiWorkflowQueueService,
    WorkflowQueueHandler,
    AiReviewerDecisionMakerService,
    SubmissionScanCompleteHandler,
    SubmissionNotificationCreateHandler,
    ChallengeResourceCreateHandler,
    ChallengeResourceDeleteHandler,
    SubmissionConfirmationEmailService,
    SubmissionPreviewService,
    AiPhaseOpenedHandler,
  ],
})
export class GlobalProvidersModule {}
