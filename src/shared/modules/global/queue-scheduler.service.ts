import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as PgBoss from 'pg-boss';
import { policies, Queue } from 'pg-boss';

/**
 * QueueSchedulerService
 */
@Injectable()
export class QueueSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger: Logger = new Logger(QueueSchedulerService.name);
  private boss: PgBoss;

  private tasksMap = new Map<string, () => void>();

  constructor() {
    this.logger.log('QueueSchedulerService initialized');
    this.boss = new PgBoss(process.env.PG_BOSS_DB_URL!);
    this.boss.on('error', (err) => this.logger.error('pg-boss error:', err));
  }

  async onModuleInit() {
    await this.boss.start();
  }

  async onModuleDestroy() {
    await this.boss.stop();
  }

  async createQueue(queueName: string, options?: Partial<Queue>) {
    await this.boss.createQueue(queueName, {
      name: queueName,
      policy: policies.singleton,
      ...options,
    });

    this.logger.log(`Created queue with name "${queueName}"`);
  }

  async queueJob(queueName: string, jobId, payload?: any, options?: Queue) {
    if (!(await this.boss.getQueue(queueName))) {
      await this.createQueue(queueName, options);
    }

    await this.boss.send(queueName, {
      jobId,
      ...payload,
    });

    this.logger.log(`Started job ${jobId}`);
  }

  async completeJob(queueName: string, jobId: string, result?: any) {
    await this.boss.complete(queueName, jobId, result);
    if (this.tasksMap.has(jobId)) {
      this.tasksMap.get(jobId)?.call(null);
      this.tasksMap.delete(jobId);
    }
    this.logger.log(`Job ${jobId} completed with result:`, result);
  }

  async handleWorkForQueues<T>(
    queuesNames: string[],
    handlerFn: PgBoss.WorkHandler<T>,
  ) {
    await this.boss.start();
    return Promise.all(
      queuesNames.map(async (queueName) => {
        const queue = await this.boss.getQueue(queueName);

        // if queue not found, create it so we can start the worker
        if (!queue) {
          this.logger.warn(`Queue ${queueName} not found!`);
          await this.createQueue(queueName);
        }

        return this.boss.work(queueName, handlerFn);
      }),
    );
  }

  trackTask(jobId: string, handler: () => void) {
    this.tasksMap.set(jobId, handler);
  }
}
