import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { LoggerService } from './logger.service';
import { PrismaErrorService } from './prisma-error.service';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger: LoggerService;

  constructor(private readonly prismaErrorService?: PrismaErrorService) {
    super({
      log: [
        { level: 'query', emit: 'event' },
        { level: 'info', emit: 'event' },
        { level: 'warn', emit: 'event' },
        { level: 'error', emit: 'event' },
      ],
      // Set connection pool configuration
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
    });

    this.logger = LoggerService.forRoot('PrismaService');

    // Setup logging for Prisma queries and errors
    this.$on('query' as never, (e: Prisma.QueryEvent) => {
      const queryTime = e.duration;

      // Log query details - full query for dev, just time for production
      if (process.env.NODE_ENV !== 'production') {
        this.logger.debug(
          `Query: ${e.query} | Params: ${e.params} | Duration: ${queryTime}ms`,
        );
      } else if (queryTime > 500) {
        // In production, only log slow queries (> 500ms)
        this.logger.warn(
          `Slow query detected! Duration: ${queryTime}ms | Query: ${e.query}`,
        );
      }
    });

    this.$on('info' as never, (e: Prisma.LogEvent) => {
      this.logger.log(`Prisma Info: ${e.message}`);
    });

    this.$on('warn' as never, (e: Prisma.LogEvent) => {
      this.logger.warn(`Prisma Warning: ${e.message}`);
    });

    this.$on('error' as never, (e: Prisma.LogEvent) => {
      this.logger.error(`Prisma Error: ${e.message}`, e.target);
    });
  }

  async onModuleInit() {
    this.logger.log('Initializing Prisma connection');
    try {
      await this.$connect();
      this.logger.log('Prisma connected successfully');

      // Configure query performance
      if (process.env.NODE_ENV === 'production') {
        try {
          // In production, increase the maximum number of connections (NestJS already sets sensible defaults)
          await this.$executeRaw`SET max_connections = 100;`;
          this.logger.log('Database connection pool configured');
        } catch (error) {
          this.logger.warn(
            `Could not configure database connections: ${error.message}`,
          );
        }
      }
    } catch (error) {
      const errorMsg = this.prismaErrorService
        ? this.prismaErrorService.handleError(error, 'connecting to database')
            .message
        : error.message;

      this.logger.error(
        `Failed to connect to the database: ${errorMsg}`,
        error.stack,
      );
      throw error;
    }
  }

  async onModuleDestroy() {
    this.logger.log('Disconnecting Prisma');
    await this.$disconnect();
  }
}
