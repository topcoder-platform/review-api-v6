import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as PgBoss from 'pg-boss';
import { policies, Queue } from 'pg-boss';

const PGBOSS_JOB_POLLING_INTERVAL_SEC = parseFloat(
  process.env.PGBOSS_JOB_POLLING_INTERVAL_SEC || '10',
);

/**
 * QueueSchedulerService
 */
@Injectable()
export class QueueSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger: Logger = new Logger(QueueSchedulerService.name);
  private boss: PgBoss;
  private $start;

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

    await this.boss[resolution](queueName, jobId);

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

        /**
         * Continuously polls a job queue and processes jobs one at a time.
         *
         * @typeParam T - The type of the job payload/data.
         *
         * @remarks
         * - Fetches a single job from the queue (batchSize = 1) via `this.boss.fetch<T>(queueName, { batchSize: 1 })`.
         * - If a job is returned, logs the job and invokes `handlerFn([job])`, awaiting its completion.
         * - After each iteration (whether a job was found or not), schedules the next poll using
         *   `setTimeout(..., PGBOSS_JOB_POLLING_INTERVAL)` to avoid deep recursion and to yield to the event loop.
         * - The scheduled, recursive invocation calls `poll().catch(() => {})` so that errors from those future
         *   invocations are swallowed and do not produce unhandled promise rejections. Note that errors thrown
         *   by the current invocation (for example from `handlerFn`) will propagate to the caller of this invocation
         *   unless the caller handles them.
         *
         * @returns A Promise that resolves when this single poll iteration completes.
         */
        const poll = async () => {
          try {
            // guard: ensure boss still exists and service still enabled
            if (!this.boss || !this.isEnabled) {
              this.logger.warn(
                `Polling for queue "${queueName}" stopped: boss not available or service disabled.`,
              );
              return;
            }

            const [job] = await this.boss.fetch<T>(queueName, { batchSize: 1 });
            if (job) {
              // avoid throwing from here to keep the loop alive
              try {
                this.logger.log(
                  `Starting job processing for job ${job.id} from queue "${queueName}"`,
                );
                this.logger.debug(
                  `Job ${job.id} payload: ${JSON.stringify(job.data)}`,
                );
              } catch {
                // ignore stringify errors
              }

              try {
                await handlerFn([job]);
              } catch (err) {
                this.logger.error(
                  `Handler error while processing job ${job.id} from "${queueName}": ${
                    (err && (err as Error).message) || err
                  }`,
                  err,
                );
                // don't rethrow so the scheduled next poll still runs
              }
            }
          } catch (err) {
            this.logger.error(
              `Error fetching job from queue "${queueName}": ${
                (err && (err as Error).message) || err
              }`,
              err,
            );
            // swallow to avoid unhandled promise rejection; next poll still scheduled
          } finally {
            // schedule next poll (non-blocking). Any errors from the scheduled invocation are logged.
            setTimeout(() => {
              poll().catch((err) =>
                this.logger.error('Unhandled poll error', err),
              );
            }, PGBOSS_JOB_POLLING_INTERVAL_SEC * 1000);
          }
        };

        await poll();
      }),
    );
  }
}
