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
import { ChallengeCatalogService } from './challenge-catalog.service';
import { SubmissionService } from 'src/api/submission/submission.service';
import { ChallengePrismaService } from './challenge-prisma.service';
import { MemberPrismaService } from './member-prisma.service';
import { QueueSchedulerService } from './queue-scheduler.service';
import { WorkflowQueueHandler } from './workflow-queue.handler';

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
    SubmissionScanCompleteOrchestrator,
    SubmissionService,
    QueueSchedulerService,
    WorkflowQueueHandler,
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
    SubmissionScanCompleteOrchestrator,
    QueueSchedulerService,
    WorkflowQueueHandler,
  ],
})
export class GlobalProvidersModule {}
