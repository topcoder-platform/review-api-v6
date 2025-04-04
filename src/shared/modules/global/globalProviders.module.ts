import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaService } from './prisma.service';
import { TokenRolesGuard } from '../../guards/tokenRoles.guard';
import { JwtService } from './jwt.service';

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
  ],
  exports: [PrismaService, JwtService],
})
export class GlobalProvidersModule {}
