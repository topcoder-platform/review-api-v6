import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client-member';
import { LoggerService } from './logger.service';

@Injectable()
export class MemberPrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = LoggerService.forRoot('MemberPrismaService');

  constructor() {
    super({
      log: [
        { level: 'query', emit: 'event' },
        { level: 'info', emit: 'event' },
        { level: 'warn', emit: 'event' },
        { level: 'error', emit: 'event' },
      ],
      datasources: {
        db: {
          url: process.env.MEMBER_DB_URL,
        },
      },
    });

    this.$on('info' as never, (e: Prisma.LogEvent) =>
      this.logger.log(`Prisma Info: ${e.message}`),
    );
    this.$on('warn' as never, (e: Prisma.LogEvent) =>
      this.logger.warn(`Prisma Warning: ${e.message}`),
    );
    this.$on('error' as never, (e: Prisma.LogEvent) =>
      this.logger.error(`Prisma Error: ${e.message}`),
    );
  }

  async onModuleInit() {
    this.logger.log('Connecting to Member DB');
    await this.$connect();
    this.logger.log('Connected to Member DB');
  }

  async onModuleDestroy() {
    this.logger.log('Disconnecting Member DB');
    await this.$disconnect();
  }
}
