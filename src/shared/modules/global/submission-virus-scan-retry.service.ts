import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SubmissionService } from 'src/api/submission/submission.service';

/**
 * Scheduled provider that retries AV scan requests for stale unscanned submissions.
 * It is registered by `GlobalProvidersModule` and delegates database scanning and
 * event publication to `SubmissionService`.
 */
@Injectable()
export class SubmissionVirusScanRetryService {
  private readonly logger = new Logger(SubmissionVirusScanRetryService.name);
  private isRunning = false;

  constructor(private readonly submissionService: SubmissionService) {}

  /**
   * Runs the stale submission AV scan retry pass every ten minutes.
   * @returns A promise that resolves when the scheduled pass has finished.
   * @throws No exceptions are intentionally rethrown; errors are logged so Nest's scheduler can continue future executions.
   * Used by Nest's scheduler to keep unscanned DMZ submissions moving through `avscan.action.scan`.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async retryStaleSubmissionScans(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn(
        'Skipping stale submission AV scan retry; previous pass is still running.',
      );
      return;
    }

    this.isRunning = true;
    try {
      const result =
        await this.submissionService.retryStaleSubmissionScanRequests();
      if (result.candidates > 0 || result.failed > 0) {
        this.logger.log(
          `Stale submission AV scan retry complete. candidates=${result.candidates} retried=${result.retried} skipped=${result.skipped} failed=${result.failed}`,
        );
      }
    } catch (error) {
      this.logger.error(
        'Stale submission AV scan retry failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.isRunning = false;
    }
  }
}
