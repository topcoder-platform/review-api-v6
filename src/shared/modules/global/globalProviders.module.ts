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
import { KafkaModule } from '../kafka/kafka.module';

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
    EventBusService,
    MemberService,
  ],
  exports: [
    PrismaService,
    JwtService,
    LoggerService,
    PrismaErrorService,
    M2MService,
    ChallengeApiService,
    EventBusService,
    MemberService,
  ],
})
export class GlobalProvidersModule {}
