import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { LoggerService } from './logger.service';
import { Utils } from './utils.service';

@Injectable()
export class ChallengePrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = LoggerService.forRoot('ChallengePrismaService');

  constructor() {
    super({
      ...Utils.getPrismaTimeout(),
      log: [
        { level: 'query', emit: 'event' },
        { level: 'info', emit: 'event' },
        { level: 'warn', emit: 'event' },
        { level: 'error', emit: 'event' },
      ],
      datasources: {
        db: {
          url: process.env.CHALLENGE_DB_URL,
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
    this.logger.log('Connecting to Challenge DB');
    await this.$connect();
    this.logger.log('Connected to Challenge DB');
  }

  async onModuleDestroy() {
    this.logger.log('Disconnecting Challenge DB');
    await this.$disconnect();
  }
}
