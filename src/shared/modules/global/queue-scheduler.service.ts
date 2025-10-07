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
  private $start;

  private jobsHandlersMap = new Map<
    string,
    (resolution?: 'fail' | 'complete', result?: any) => void
  >();

  get isEnabled() {
    return String(process.env.DISPATCH_AI_REVIEW_WORKFLOWS) === 'true';
  }

  constructor() {
    if (!this.isEnabled) {
      this.logger.log(
        'env.DISPATCH_AI_REVIEW_WORKFLOWS is not true, pgboss is disabled.',
      );
      return;
    }
    if (!process.env.PGBOSS_DATABASE_URL) {
      throw new Error(
        `Env var 'PGBOSS_DATABASE_URL' is missing! Please configure it or set 'DISPATCH_AI_REVIEW_WORKFLOWS' to false.`,
      );
    }
    this.logger.log('QueueSchedulerService initialized');
    this.boss = new PgBoss(process.env.PGBOSS_DATABASE_URL);
    this.boss.on('error', (err) => this.logger.error('pg-boss error:', err));
  }

  async onModuleInit() {
    if (!this.isEnabled) {
      return;
    }

    await (this.$start = this.boss.start());
  }

  async onModuleDestroy() {
    if (!this.isEnabled) {
      return;
    }

    await this.boss.stop();
  }

  async createQueue(queueName: string, options?: Partial<Queue>) {
    if (!this.isEnabled) {
      return;
    }
    await this.boss.createQueue(queueName, {
      name: queueName,
      policy: policies.singleton,
      retryLimit: 1,
      expireInSeconds: 3600,
      ...options,
    });

    this.logger.log(`Created queue with name "${queueName}"`);
  }

  async queueJob(
    queueName: string,
    jobId: string,
    payload?: any,
    options?: Queue,
  ) {
    if (!this.isEnabled) {
      this.logger.log('PgBoss is disabled, skipping queueing job!', {
        queueName,
        jobId,
      });
      return;
    }

    if (!(await this.boss.getQueue(queueName))) {
      await this.createQueue(queueName, options);
    }

    await this.boss.send(queueName, {
      jobId,
      ...payload,
    });

    this.logger.log(`Started job ${jobId}`);
  }

  async completeJob(
    queueName: string,
    jobId: string,
    resolution: 'complete' | 'fail' = 'complete',
  ) {
    if (!this.isEnabled) {
      this.logger.log(
        'PgBoss is disabled, skipping marking job as completed!',
        {
          queueName,
          jobId,
        },
      );
      return;
    }

    if (resolution === 'fail') {
      // IMPORTANT!
      // thes 4 operations will update the cache for the active singletons in the database
      // and will allow the jobs queue to go next or retry
      await this.boss.cancel(queueName, jobId);
      await this.boss.getQueueStats(queueName);
      await this.boss.supervise(queueName);
      await this.boss.resume(queueName, jobId);
    }

    if (this.jobsHandlersMap.has(jobId)) {
      this.logger.log(
        `Found job handler for ${jobId}. Calling with '${resolution}' resolution.`,
      );
      this.jobsHandlersMap.get(jobId)?.call(null, resolution);
      this.jobsHandlersMap.delete(jobId);
      this.logger.log('JobHandlers left:', [...this.jobsHandlersMap.keys()]);
    } else {
      await this.boss[resolution](queueName, jobId);
    }

    this.logger.log(`Job ${jobId} ${resolution} called.`);

    if (resolution === 'fail') {
      const bossJob = await this.boss.getJobById(queueName, jobId);
      if (bossJob && bossJob.retryCount >= bossJob.retryLimit) {
        throw new Error('Job failed! Retry limit reached!');
      }
    }
  }

  async handleWorkForQueues<T>(
    queuesNames: string[],
    handlerFn: PgBoss.WorkHandler<T>,
  ) {
    if (!this.isEnabled) {
      this.logger.log('PgBoss is disabled, cannot register worker!', {
        queuesNames,
      });
      return;
    }

    await this.$start;
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

  registerJobHandler(
    jobId: string,
    handler: (resolution?: string, result?: any) => void,
  ) {
    this.logger.log(`Registering job handler for job ${jobId}.`);
    this.jobsHandlersMap.set(jobId, handler);
  }
}
