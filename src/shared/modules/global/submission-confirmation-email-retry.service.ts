import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SubmissionConfirmationEmailService } from './submission-confirmation-email.service';

/**
 * Scheduled recovery provider for durable submission-confirmation requests.
 * A local overlap guard protects each ECS task, while the dispatcher's database
 * lease ensures only one task publishes a particular request at a time.
 */
@Injectable()
export class SubmissionConfirmationEmailRetryService {
  private readonly logger = new Logger(
    SubmissionConfirmationEmailRetryService.name,
  );
  private isRunning = false;

  /**
   * Creates the scheduler around the shared durable dispatcher.
   *
   * @param confirmationService Service that selects and dispatches pending requests.
   * @throws This constructor does not intentionally throw.
   */
  constructor(
    private readonly confirmationService: SubmissionConfirmationEmailService,
  ) {}

  /**
   * Retries pending submission confirmations once per minute.
   *
   * @returns A promise resolved after the bounded recovery pass completes.
   * @throws No exceptions are intentionally rethrown; failures are logged so future schedules continue.
   * Used by Nest ScheduleModule to recover missed Kafka triggers and transient enrichment or Bus failures.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async retryPendingConfirmations(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn(
        'Skipping submission confirmation retry; previous pass is still running.',
      );
      return;
    }

    this.isRunning = true;
    try {
      const result =
        await this.confirmationService.retryPendingConfirmations();
      if (result.candidates > 0 || result.failed > 0) {
        this.logger.log(
          `Submission confirmation retry complete. candidates=${result.candidates} published=${result.published} skipped=${result.skipped} failed=${result.failed}`,
        );
      }
    } catch (error) {
      this.logger.error(
        'Submission confirmation retry pass failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.isRunning = false;
    }
  }
}
