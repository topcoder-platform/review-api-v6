import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaService } from './prisma.service';
import { TokenRolesGuard } from '../../guards/tokenRoles.guard';
import { JwtService } from './jwt.service';
import { LoggerService } from './logger.service';
import { PrismaErrorService } from './prisma-error.service';

// Global module for providing global providers
// Add any provider you want to be global here
@Global()
@Module({
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
  ],
  exports: [PrismaService, JwtService, LoggerService, PrismaErrorService],
})
export class GlobalProvidersModule {}
