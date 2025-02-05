import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// Global module for providing global providers
// Add any provider you want to be global here
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class GlobalProvidersModule {}
