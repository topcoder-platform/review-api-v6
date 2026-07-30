import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ChallengeApiService } from './challenge.service';
import { EventBusService } from './eventBus.service';
import { LoggerService } from './logger.service';
import { MemberService } from './member.service';
import { PrismaService } from './prisma.service';

const CONFIRMATION_PROCESSING_LEASE_MS = 5 * 60 * 1000;
const CONFIRMATION_RETRY_DELAY_MS = 5 * 60 * 1000;
const CONFIRMATION_RETRY_BATCH_SIZE = 100;

interface SubmissionConfirmationEmailPayload {
  recipients: string[];
  version: 'v3';
  data: {
    submitter: {
      handle: string;
    };
    challenge: {
      challengeTitle: string;
    };
    submission: {
      id: string;
      challengeId: string;
    };
  };
}

/**
 * Outcomes returned when one durable confirmation request is dispatched.
 */
export enum SubmissionConfirmationDispatchStatus {
  PUBLISHED = 'published',
  ALREADY_PUBLISHED = 'already-published',
  IN_PROGRESS = 'in-progress',
  NOT_REQUESTED = 'not-requested',
}

/**
 * Optional controls for a scheduled confirmation recovery pass.
 */
export interface SubmissionConfirmationRetryOptions {
  now?: Date;
  limit?: number;
}

/**
 * Counts produced by a scheduled confirmation recovery pass.
 */
export interface SubmissionConfirmationRetryResult {
  candidates: number;
  published: number;
  skipped: number;
  failed: number;
}

/**
 * Converts an untrusted value to a trimmed nonempty string.
 *
 * @param value Event or database value to normalize.
 * @returns A trimmed string, or undefined when the value is not usable.
 * @throws This function never throws.
 * Used before identifiers and template values reach database or event-bus collaborators.
 */
function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

/**
 * Produces a bounded persistence-safe description for a failed attempt.
 *
 * @param error Unknown collaborator failure.
 * @returns A nonempty error description no longer than 1000 characters.
 * @throws This function never throws.
 * Used for operational state only; email payloads and recipient addresses are not persisted here.
 */
function toStoredError(error: unknown): string {
  const message =
    error instanceof Error && error.message.trim().length > 0
      ? error.message
      : 'Submission confirmation dispatch failed';
  return message.slice(0, 1000);
}

/**
 * Owns durable, lease-protected publication of member submission
 * confirmations. Normal submission creation writes a related request in the
 * same Prisma operation, Kafka triggers immediate dispatch, and the scheduled
 * retry provider recovers requests missed during Bus or process outages.
 */
@Injectable()
export class SubmissionConfirmationEmailService {
  private readonly logger = LoggerService.forRoot(
    'SubmissionConfirmationEmailService',
  );

  /**
   * Creates the confirmation dispatcher with its data and publication collaborators.
   *
   * @param prisma Review database client used for requests, leases, and submissions.
   * @param memberService Member lookup used to resolve the recipient and handle.
   * @param challengeApiService Challenge lookup used to resolve the title.
   * @param eventBusService Bus API publisher used to emit the email-ready event.
   * @throws This constructor does not intentionally throw.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly memberService: MemberService,
    private readonly challengeApiService: ChallengeApiService,
    private readonly eventBusService: EventBusService,
  ) {}

  /**
   * Claims and publishes one durable submission-confirmation request.
   *
   * @param submissionId Persisted submission whose request should be dispatched.
   * @param now Clock value used to acquire or recover the processing lease.
   * @returns Publication, duplicate, in-progress, or not-requested status.
   * @throws Propagates database, member, challenge, and Bus API failures after releasing the lease when possible.
   * Used by the submission-created Kafka handler and scheduled recovery pass.
   */
  async dispatchForSubmission(
    submissionId: string,
    now: Date = new Date(),
  ): Promise<SubmissionConfirmationDispatchStatus> {
    const normalizedSubmissionId = toNonEmptyString(submissionId);
    if (!normalizedSubmissionId) {
      throw new Error('Submission ID is required for confirmation dispatch');
    }

    const staleBefore = new Date(
      now.getTime() - CONFIRMATION_PROCESSING_LEASE_MS,
    );
    const processingToken = randomUUID();
    const claim = await this.prisma.submissionConfirmationEmail.updateMany({
      where: {
        submissionId: normalizedSubmissionId,
        publishedAt: null,
        nextAttemptAt: { lte: now },
        OR: [
          { processingStartedAt: null },
          { processingStartedAt: { lt: staleBefore } },
        ],
      },
      data: {
        processingStartedAt: now,
        processingToken,
        attemptCount: { increment: 1 },
        lastError: null,
      },
    });

    if (claim.count === 0) {
      const state =
        await this.prisma.submissionConfirmationEmail.findUnique({
          where: { submissionId: normalizedSubmissionId },
          select: {
            publishedAt: true,
            processingStartedAt: true,
          },
        });

      if (!state) {
        this.logger.warn(
          `No confirmation request exists for submission ${normalizedSubmissionId}`,
        );
        return SubmissionConfirmationDispatchStatus.NOT_REQUESTED;
      }
      if (state.publishedAt) {
        return SubmissionConfirmationDispatchStatus.ALREADY_PUBLISHED;
      }
      return SubmissionConfirmationDispatchStatus.IN_PROGRESS;
    }

    try {
      const submission = await this.prisma.submission.findUnique({
        where: { id: normalizedSubmissionId },
        select: {
          id: true,
          memberId: true,
          challengeId: true,
        },
      });
      if (!submission) {
        throw new Error(
          `Submission ${normalizedSubmissionId} no longer exists`,
        );
      }

      const memberId = toNonEmptyString(submission.memberId);
      const challengeId = toNonEmptyString(submission.challengeId);
      if (!memberId || !challengeId) {
        throw new Error(
          `Submission ${submission.id} is missing memberId or challengeId`,
        );
      }

      const members = await this.memberService.getUserEmails([memberId]);
      const member = members.find(
        (candidate) => String(candidate.userId) === memberId,
      );
      const recipient = toNonEmptyString(member?.email);
      const handle = toNonEmptyString(member?.handle);
      if (!recipient || !handle) {
        throw new Error(`Member ${memberId} has no usable email or handle`);
      }

      const challenge =
        await this.challengeApiService.getChallengeDetail(challengeId);
      const challengeTitle = toNonEmptyString(challenge?.name);
      if (!challengeTitle) {
        throw new Error(`Challenge ${challengeId} has no usable title`);
      }

      const payload: SubmissionConfirmationEmailPayload = {
        recipients: [recipient],
        version: 'v3',
        data: {
          submitter: { handle },
          challenge: { challengeTitle },
          submission: {
            id: submission.id,
            challengeId,
          },
        },
      };

      await this.eventBusService.publish(
        'submission.notification.send',
        payload,
        `submission-confirmation:${submission.id}`,
      );

      const completion =
        await this.prisma.submissionConfirmationEmail.updateMany({
          where: {
            submissionId: submission.id,
            publishedAt: null,
            processingToken,
          },
          data: {
            processingStartedAt: null,
            processingToken: null,
            publishedAt: new Date(),
            lastError: null,
          },
        });

      if (completion.count === 0) {
        // A successful Bus publication is a terminal fact even if this
        // worker's lease expired while the request was in flight. Recording it
        // prevents a third worker from publishing after the new owner finishes.
        await this.prisma.submissionConfirmationEmail.updateMany({
          where: {
            submissionId: submission.id,
            publishedAt: null,
          },
          data: {
            processingStartedAt: null,
            processingToken: null,
            publishedAt: new Date(),
            lastError: null,
          },
        });
      }

      this.logger.log(
        `Published submission.notification.send for submission ${submission.id}`,
      );
      return SubmissionConfirmationDispatchStatus.PUBLISHED;
    } catch (error) {
      const nextAttemptAt = new Date(
        now.getTime() + CONFIRMATION_RETRY_DELAY_MS,
      );
      try {
        await this.prisma.submissionConfirmationEmail.updateMany({
          where: {
            submissionId: normalizedSubmissionId,
            publishedAt: null,
            processingToken,
          },
          data: {
            processingStartedAt: null,
            processingToken: null,
            nextAttemptAt,
            lastError: toStoredError(error),
          },
        });
      } catch (stateError) {
        this.logger.error(
          `Failed to release confirmation lease for submission ${normalizedSubmissionId}`,
          stateError instanceof Error
            ? (stateError.stack ?? stateError.message)
            : String(stateError),
        );
      }
      throw error;
    }
  }

  /**
   * Dispatches a bounded batch of unprocessed or stale-leased requests.
   *
   * @param options Optional clock and batch-size controls used by tests and operations.
   * @returns Candidate, published, skipped, and failed counts.
   * @throws Propagates failure to select recovery candidates; individual dispatch failures are counted and retained for later retries.
   * Used by SubmissionConfirmationEmailRetryService on its scheduler interval.
   */
  async retryPendingConfirmations(
    options: SubmissionConfirmationRetryOptions = {},
  ): Promise<SubmissionConfirmationRetryResult> {
    const now = options.now ?? new Date();
    const requestedLimit = options.limit ?? CONFIRMATION_RETRY_BATCH_SIZE;
    const limit = Math.max(
      1,
      Math.min(requestedLimit, CONFIRMATION_RETRY_BATCH_SIZE),
    );
    const staleBefore = new Date(
      now.getTime() - CONFIRMATION_PROCESSING_LEASE_MS,
    );
    const requests = await this.prisma.submissionConfirmationEmail.findMany({
      where: {
        publishedAt: null,
        nextAttemptAt: { lte: now },
        OR: [
          { processingStartedAt: null },
          { processingStartedAt: { lt: staleBefore } },
        ],
      },
      orderBy: [
        { nextAttemptAt: 'asc' },
        { createdAt: 'asc' },
        { submissionId: 'asc' },
      ],
      take: limit,
      select: { submissionId: true },
    });

    const result: SubmissionConfirmationRetryResult = {
      candidates: requests.length,
      published: 0,
      skipped: 0,
      failed: 0,
    };

    for (const request of requests) {
      try {
        const status = await this.dispatchForSubmission(
          request.submissionId,
          now,
        );
        if (status === SubmissionConfirmationDispatchStatus.PUBLISHED) {
          result.published += 1;
        } else {
          result.skipped += 1;
        }
      } catch (error) {
        result.failed += 1;
        this.logger.error(
          `Submission confirmation retry failed for submission ${request.submissionId}`,
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error),
        );
      }
    }

    return result;
  }
}
