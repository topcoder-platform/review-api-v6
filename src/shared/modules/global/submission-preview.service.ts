import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  ReviewStatus,
  ScorecardType,
  SubmissionPreviewStatus,
  SubmissionStatus,
  SubmissionType,
  Prisma,
} from '@prisma/client';
import { createHash } from 'crypto';
import { createWriteStream } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import * as yauzl from 'yauzl';
import { ChallengeApiService, ChallengeData } from './challenge.service';
import { JwtUser } from './jwt.service';
import { MemberService } from './member.service';
import { PrismaService } from './prisma.service';

const DEFAULT_MAX_ARCHIVE_BYTES = 250 * 1024 * 1024;
const DEFAULT_MAX_PREVIEW_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024;
const DEFAULT_MAX_ZIP_ENTRIES = 10_000;
const DEFAULT_MAX_COMPRESSION_RATIO = 100;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_RETRY_BATCH_SIZE = 10;
const DEFAULT_RECONCILE_BATCH_SIZE = 25;
const PROCESSING_LEASE_MS = 15 * 60 * 1000;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

type PreviewFile = {
  data: Buffer;
  contentType: 'image/jpeg' | 'image/png';
  extension: 'jpg' | 'png';
};

type PreviewSource = {
  bucket: string;
  key: string;
};

type ScreeningReviewSummary = {
  status: ReviewStatus | null;
  initialScore: number | null;
  finalScore: number | null;
  scorecard: {
    type: ScorecardType;
    minScore: number;
    minimumPassingScore: number;
  };
};

type ReleasedPreviewRow = {
  id: string;
  type: SubmissionType;
  submittedDate: Date | null;
  createdAt: Date;
  memberId: string | null;
  objectKey: string;
};

type PreviewReconciliationRow = {
  submissionId: string;
};

/** A released submission preview returned to the Opportunities gallery. */
export interface ReleasedSubmissionPreview {
  id: string;
  type: SubmissionType;
  submittedDate: Date | null;
  previewUrl: string;
  submitterHandle?: string;
}

/** Paginated public-safe preview gallery result. */
export interface ReleasedSubmissionPreviewPage {
  data: ReleasedSubmissionPreview[];
  meta: {
    page: number;
    perPage: number;
    totalCount: number;
    totalPages: number;
  };
}

/**
 * A classified preview-processing failure. Retryable failures are scheduled
 * again, while invalid or unsafe submission archives stop after one attempt.
 */
class PreviewProcessingError extends Error {
  /**
   * Creates a classified processing error.
   *
   * @param code - Stable diagnostic code persisted with the preview job.
   * @param message - Human-readable diagnostic text for operators.
   * @param retryable - Whether another processing attempt can reasonably work.
   */
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = PreviewProcessingError.name;
  }
}

/**
 * A transform that aborts a download as soon as it exceeds its configured
 * byte ceiling. It protects the worker when S3 object metadata is absent or
 * inaccurate.
 */
class ByteLimitTransform extends Transform {
  private bytesRead = 0;

  /**
   * Creates a bounded pass-through stream.
   *
   * @param maxBytes - Maximum bytes allowed through the stream.
   */
  constructor(private readonly maxBytes: number) {
    super();
  }

  /**
   * Passes a chunk through unless the cumulative byte limit is exceeded.
   *
   * @param chunk - Incoming stream data.
   * @param encoding - Encoding supplied by Node for non-buffer chunks.
   * @param callback - Node transform completion callback.
   * @returns Nothing; completion is reported through the callback.
   */
  override _transform(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void,
  ): void {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk, encoding);
    this.bytesRead += buffer.length;
    if (this.bytesRead > this.maxBytes) {
      callback(
        new PreviewProcessingError(
          'ARCHIVE_TOO_LARGE',
          `Submission ZIP exceeds the ${this.maxBytes}-byte processing limit.`,
          false,
        ),
      );
      return;
    }
    callback(null, buffer);
  }
}

/**
 * Extracts and publishes design-submission preview images. A durable database
 * row acts as both the retry queue and idempotency record. Preview objects use
 * an unguessable per-row token so an image uploaded after Screening cannot be
 * discovered through the public asset host before the Review visibility gate.
 */
@Injectable()
export class SubmissionPreviewService {
  private readonly logger = new Logger(SubmissionPreviewService.name);
  private retryWorkerRunning = false;

  /**
   * Creates the preview pipeline.
   *
   * @param prisma - Review database client used for jobs and review state.
   * @param challengeApiService - Challenge reader used for track and phase gates.
   * @param memberService - Optional member reader used only for public handles.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly challengeApiService: ChallengeApiService,
    private readonly memberService?: MemberService,
  ) {}

  /**
   * Durably enqueues a preview candidate after a completed, passing Screening
   * review. Checkpoint Screening is accepted only for checkpoint submissions;
   * regular Screening is accepted only for contest submissions. The worker
   * performs the Design-track check so a temporary challenge-service outage at
   * review completion cannot lose the job. Repeated events are idempotent
   * because submissionId is the job primary key.
   *
   * @param reviewId - Completed review that may make a preview eligible.
   * @returns True when an eligible preview job exists, otherwise false.
   * @throws Error when the review database cannot be queried.
   */
  async enqueueFromCompletedReview(reviewId: string): Promise<boolean> {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      select: {
        status: true,
        initialScore: true,
        finalScore: true,
        scorecard: {
          select: {
            type: true,
            minScore: true,
            minimumPassingScore: true,
          },
        },
        submission: {
          select: {
            id: true,
            type: true,
            status: true,
            challengeId: true,
            virusScan: true,
            isFileSubmission: true,
            url: true,
          },
        },
      },
    });

    if (!review?.submission || review.status !== ReviewStatus.COMPLETED) {
      return false;
    }

    if (!this.isPassingScreeningReview(review, review.submission.type)) {
      return false;
    }

    const submission = review.submission;
    if (
      submission.status !== SubmissionStatus.ACTIVE ||
      !submission.challengeId ||
      !submission.virusScan ||
      !submission.isFileSubmission ||
      !submission.url
    ) {
      return false;
    }

    await this.prisma.submissionPreview.upsert({
      where: { submissionId: submission.id },
      create: { submissionId: submission.id },
      update: {},
    });
    this.logger.log(
      `Queued preview eligibility processing for submission ${submission.id}.`,
    );
    return true;
  }

  /**
   * Runs bounded missing-job reconciliation and the retry worker once per
   * minute. An in-process overlap guard complements the database lease used
   * across multiple API replicas. Reconciliation failure never prevents
   * already-durable jobs from running.
   *
   * @returns A promise that resolves after the due batch has been attempted.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async processDuePreviews(): Promise<void> {
    if (this.retryWorkerRunning) {
      return;
    }
    this.retryWorkerRunning = true;
    try {
      try {
        await this.reconcileEligiblePreviewJobs();
      } catch (error) {
        this.logger.error(
          `Preview reconciliation failed; existing jobs will still run: ${this.errorMessage(error)}`,
        );
      }
      const maxAttempts = this.getPositiveIntegerConfig(
        'SUBMISSION_PREVIEW_MAX_ATTEMPTS',
        DEFAULT_MAX_ATTEMPTS,
        1,
        20,
      );
      const batchSize = this.getPositiveIntegerConfig(
        'SUBMISSION_PREVIEW_RETRY_BATCH_SIZE',
        DEFAULT_RETRY_BATCH_SIZE,
        1,
        100,
      );
      const now = new Date();
      const staleBefore = new Date(now.getTime() - PROCESSING_LEASE_MS);
      const jobs = await this.prisma.submissionPreview.findMany({
        where: {
          attemptCount: { lt: maxAttempts },
          OR: [
            {
              status: {
                in: [
                  SubmissionPreviewStatus.PENDING,
                  SubmissionPreviewStatus.FAILED,
                ],
              },
              nextAttemptAt: { lte: now },
            },
            {
              status: SubmissionPreviewStatus.PROCESSING,
              processingStartedAt: { lt: staleBefore },
            },
          ],
        },
        select: { submissionId: true },
        orderBy: [{ nextAttemptAt: 'asc' }, { submissionId: 'asc' }],
        take: batchSize,
      });

      for (const job of jobs) {
        await this.processSubmissionPreview(job.submissionId);
      }
    } finally {
      this.retryWorkerRunning = false;
    }
  }

  /**
   * Recreates missing preview jobs from authoritative submission, review, and
   * scorecard state. This bounded reconciliation closes the gap between a
   * committed Screening result and the best-effort lifecycle enqueue, and it
   * also backfills eligible submissions that predate the preview pipeline.
   * Duplicate rows are ignored so the method is safe across API replicas.
   *
   * @returns Number of preview jobs inserted during this reconciliation pass.
   * @throws Error when the review database query or insert fails; the caller
   * logs the failure and continues processing already-durable jobs.
   */
  async reconcileEligiblePreviewJobs(): Promise<number> {
    const batchSize = this.getPositiveIntegerConfig(
      'SUBMISSION_PREVIEW_RECONCILE_BATCH_SIZE',
      DEFAULT_RECONCILE_BATCH_SIZE,
      1,
      250,
    );
    const candidates = await this.prisma.$queryRaw<
      PreviewReconciliationRow[]
    >(Prisma.sql`
      SELECT DISTINCT s.id AS "submissionId"
      FROM submission s
      INNER JOIN review r ON r."submissionId" = s.id
      INNER JOIN scorecard sc ON sc.id = r."scorecardId"
      LEFT JOIN "submissionPreview" preview
        ON preview."submissionId" = s.id
      WHERE preview."submissionId" IS NULL
        AND s.status::text = ${SubmissionStatus.ACTIVE}
        AND s."challengeId" IS NOT NULL
        AND s."virusScan" = TRUE
        AND s."isFileSubmission" = TRUE
        AND s.url IS NOT NULL
        AND r.status::text = ${ReviewStatus.COMPLETED}
        AND (
          (
            s.type::text = ${SubmissionType.CONTEST_SUBMISSION}
            AND sc.type::text = ${ScorecardType.SCREENING}
          )
          OR (
            s.type::text = ${SubmissionType.CHECKPOINT_SUBMISSION}
            AND sc.type::text = ${ScorecardType.CHECKPOINT_SCREENING}
          )
        )
        AND GREATEST(r."initialScore", r."finalScore") >=
          COALESCE(sc."minimumPassingScore", sc."minScore")
      ORDER BY s.id ASC
      LIMIT ${batchSize}
    `);
    if (!candidates.length) {
      return 0;
    }
    const result = await this.prisma.submissionPreview.createMany({
      data: candidates.map(({ submissionId }) => ({ submissionId })),
      skipDuplicates: true,
    });
    if (result.count > 0) {
      this.logger.log(
        `Reconciled ${result.count} missing submission preview job(s).`,
      );
    }
    return result.count;
  }

  /**
   * Claims and processes one durable preview job. The method is safe to invoke
   * manually in tests or operational tooling; only one replica can hold the
   * database lease for a given submission.
   *
   * @param submissionId - Submission whose preview job should be processed.
   * @returns True when a preview was made ready, otherwise false.
   */
  async processSubmissionPreview(submissionId: string): Promise<boolean> {
    const claimed = await this.claimJob(submissionId);
    if (!claimed) {
      return false;
    }

    let tempDirectory: string | undefined;
    let sourceClient: S3Client | undefined;
    let payloadClient: S3Client | undefined;
    let sourceETag: string | undefined;
    try {
      const job = await this.prisma.submissionPreview.findUnique({
        where: { submissionId },
        include: {
          submission: {
            select: {
              id: true,
              challengeId: true,
              type: true,
              status: true,
              virusScan: true,
              isFileSubmission: true,
              url: true,
              review: {
                where: {
                  status: ReviewStatus.COMPLETED,
                  scorecard: {
                    type: {
                      in: [
                        ScorecardType.SCREENING,
                        ScorecardType.CHECKPOINT_SCREENING,
                      ],
                    },
                  },
                },
                select: {
                  status: true,
                  initialScore: true,
                  finalScore: true,
                  scorecard: {
                    select: {
                      type: true,
                      minScore: true,
                      minimumPassingScore: true,
                    },
                  },
                },
              },
            },
          },
        },
      });
      if (!job?.submission) {
        throw new PreviewProcessingError(
          'SUBMISSION_NOT_FOUND',
          'The preview job no longer has a submission.',
          false,
        );
      }

      const submission = job.submission;
      if (
        submission.status !== SubmissionStatus.ACTIVE ||
        !submission.challengeId ||
        !submission.virusScan ||
        !submission.isFileSubmission ||
        !submission.url
      ) {
        throw new PreviewProcessingError(
          'SUBMISSION_NOT_PROCESSABLE',
          'The submission is not an active, scanned file submission.',
          false,
        );
      }
      if (
        !submission.review.some((review) =>
          this.isPassingScreeningReview(review, submission.type),
        )
      ) {
        throw new PreviewProcessingError(
          'SCREENING_NOT_PASSED',
          'The submission no longer has a completed passing Screening review.',
          false,
        );
      }

      const challenge = await this.challengeApiService.getChallengeDetail(
        submission.challengeId,
      );
      if (!this.isDesignChallenge(challenge)) {
        throw new PreviewProcessingError(
          'CHALLENGE_NOT_DESIGN',
          'Submission previews are generated only for Design challenges.',
          false,
        );
      }

      const source = this.parseCleanSubmissionSource(submission.url);
      sourceClient = this.createSourceS3Client();
      const maxArchiveBytes = this.getPositiveIntegerConfig(
        'SUBMISSION_PREVIEW_MAX_ARCHIVE_BYTES',
        DEFAULT_MAX_ARCHIVE_BYTES,
        1024,
        2 * 1024 * 1024 * 1024,
      );
      const head = await sourceClient.send(
        new HeadObjectCommand({ Bucket: source.bucket, Key: source.key }),
      );
      if (
        typeof head.ContentLength === 'number' &&
        head.ContentLength > maxArchiveBytes
      ) {
        throw new PreviewProcessingError(
          'ARCHIVE_TOO_LARGE',
          `Submission ZIP is ${head.ContentLength} bytes; limit is ${maxArchiveBytes}.`,
          false,
        );
      }
      this.validateArchiveContentType(head.ContentType);

      sourceETag = String(head.ETag ?? '').replace(/^"|"$/g, '');
      tempDirectory = await mkdtemp(join(tmpdir(), 'tc-review-preview-'));
      const archivePath = join(tempDirectory, 'submission.zip');
      const object = await sourceClient.send(
        new GetObjectCommand({
          Bucket: source.bucket,
          Key: source.key,
          ...(head.ETag ? { IfMatch: head.ETag } : {}),
        }),
      );
      if (!object.Body) {
        throw new PreviewProcessingError(
          'EMPTY_ARCHIVE_BODY',
          'S3 returned no body for the submission ZIP.',
          true,
        );
      }
      const body = await this.toNodeReadable(object.Body);
      await pipeline(
        body,
        new ByteLimitTransform(maxArchiveBytes),
        createWriteStream(archivePath, { flags: 'wx', mode: 0o600 }),
      );

      const preview = await this.extractPreview(archivePath);
      if (!preview) {
        await this.prisma.submissionPreview.update({
          where: { submissionId },
          data: {
            status: SubmissionPreviewStatus.MISSING,
            sourceETag,
            processingStartedAt: null,
            processedAt: new Date(),
            lastError:
              'PREVIEW_NOT_FOUND: preview.jpg or preview.png was not found at the ZIP root.',
          },
        });
        this.logger.warn(
          `No root preview.jpg or preview.png found for submission ${submissionId}.`,
        );
        return false;
      }

      const objectKey = this.buildDestinationKey(
        submission.challengeId,
        submission.id,
        job.storageToken,
        preview.extension,
      );
      const payloadBucket = this.requireConfig('PAYLOAD_S3_BUCKET');
      payloadClient = this.createPayloadS3Client();
      await payloadClient.send(
        new PutObjectCommand({
          Bucket: payloadBucket,
          Key: objectKey,
          Body: preview.data,
          ContentType: preview.contentType,
          ContentLength: preview.data.length,
          ContentDisposition: 'inline',
          CacheControl: 'public, max-age=31536000, immutable',
          ChecksumSHA256: createHash('sha256')
            .update(preview.data)
            .digest('base64'),
          Metadata: {
            submissionid: submission.id,
            challengeid: submission.challengeId,
            sourceetag: sourceETag || 'unknown',
          },
        }),
      );

      await this.prisma.submissionPreview.update({
        where: { submissionId },
        data: {
          status: SubmissionPreviewStatus.READY,
          objectKey,
          contentType: preview.contentType,
          sizeBytes: preview.data.length,
          sourceETag,
          processingStartedAt: null,
          processedAt: new Date(),
          lastError: null,
        },
      });
      this.logger.log(`Published preview for submission ${submissionId}.`);
      return true;
    } catch (error) {
      await this.recordFailure(submissionId, error, sourceETag);
      return false;
    } finally {
      sourceClient?.destroy?.();
      payloadClient?.destroy?.();
      if (tempDirectory) {
        await rm(tempDirectory, { recursive: true, force: true }).catch(
          (error: unknown) =>
            this.logger.warn(
              `Could not remove preview temp directory: ${this.errorMessage(error)}`,
            ),
        );
      }
    }
  }

  /**
   * Resolves a public preview URL only after the relevant challenge phase is
   * actually complete. Every unavailable state returns the same 404 contract,
   * avoiding leakage of screening results or whether a ZIP contained a file.
   *
   * @param authUser - Optional interactive caller used for whitelist checks.
   * @param submissionId - Submission whose preview is requested.
   * @returns Public Payload asset URL suitable for an HTTP redirect.
   * @throws NotFoundException when the preview is absent or not yet visible.
   * @throws ForbiddenException when challenge whitelist access is denied.
   */
  async getVisiblePreviewUrl(
    authUser: JwtUser | undefined,
    submissionId: string,
  ): Promise<string> {
    const record = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        challengeId: true,
        type: true,
        status: true,
        review: {
          where: {
            status: ReviewStatus.COMPLETED,
            scorecard: {
              type: {
                in: [
                  ScorecardType.SCREENING,
                  ScorecardType.CHECKPOINT_SCREENING,
                ],
              },
            },
          },
          select: {
            status: true,
            initialScore: true,
            finalScore: true,
            scorecard: {
              select: {
                type: true,
                minScore: true,
                minimumPassingScore: true,
              },
            },
          },
        },
        preview: {
          select: { status: true, objectKey: true },
        },
      },
    });
    if (
      !record?.challengeId ||
      record.status === SubmissionStatus.DELETED ||
      record.preview?.status !== SubmissionPreviewStatus.READY ||
      !record.preview.objectKey ||
      !record.review.some((review) =>
        this.isPassingScreeningReview(review, record.type),
      )
    ) {
      throw this.previewUnavailable(submissionId);
    }

    await this.challengeApiService.ensureChallengeWhitelistAccess(
      authUser,
      record.challengeId,
    );
    const challenge = await this.challengeApiService.getChallengeDetail(
      record.challengeId,
    );
    if (!this.isDesignChallenge(challenge)) {
      throw this.previewUnavailable(submissionId);
    }

    const visibilityPhase =
      record.type === SubmissionType.CHECKPOINT_SUBMISSION
        ? 'checkpoint review'
        : record.type === SubmissionType.CONTEST_SUBMISSION
          ? 'review'
          : null;
    if (
      !visibilityPhase ||
      !this.hasPhaseActuallyCompleted(challenge, visibilityPhase)
    ) {
      throw this.previewUnavailable(submissionId);
    }

    return this.buildPublicAssetUrl(record.preview.objectKey);
  }

  /**
   * Lists only released, passing Design submission previews for one challenge.
   * This endpoint is safe for anonymous Opportunities pages: challenge
   * whitelist and group access are checked first, the relevant phase must have
   * an actual end time, and neither screening state nor queued preview state is
   * disclosed before release.
   *
   * @param authUser optional caller used for challenge visibility
   * @param challengeId owning v6 challenge UUID
   * @param page one-based result page
   * @param perPage bounded page size
   * @returns released preview cards and total metadata
   * @throws ForbiddenException when challenge visibility denies the caller
   * @throws Error when challenge or review storage cannot be read
   */
  async listVisiblePreviews(
    authUser: JwtUser | undefined,
    challengeId: string,
    page: number,
    perPage: number,
  ): Promise<ReleasedSubmissionPreviewPage> {
    const challenge = await this.challengeApiService.getChallengeDetailForUser(
      authUser,
      challengeId,
    );
    if (!this.isDesignChallenge(challenge)) {
      return this.emptyPreviewPage(page, perPage);
    }

    const visibleTypes: SubmissionType[] = [];
    if (this.hasPhaseActuallyCompleted(challenge, 'review')) {
      visibleTypes.push(SubmissionType.CONTEST_SUBMISSION);
    }
    if (this.hasPhaseActuallyCompleted(challenge, 'checkpoint review')) {
      visibleTypes.push(SubmissionType.CHECKPOINT_SUBMISSION);
    }
    if (!visibleTypes.length) {
      return this.emptyPreviewPage(page, perPage);
    }

    const offset = (page - 1) * perPage;
    const eligibleWhere = Prisma.sql`
      s."challengeId" = ${challengeId}
      AND s."status" <> ${SubmissionStatus.DELETED}::"SubmissionStatus"
      AND s."type" IN (${Prisma.join(visibleTypes)})
      AND p."status" = ${SubmissionPreviewStatus.READY}::"SubmissionPreviewStatus"
      AND p."objectKey" IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM "review" r
        INNER JOIN "scorecard" sc ON sc."id" = r."scorecardId"
        WHERE r."submissionId" = s."id"
          AND r."status" = ${ReviewStatus.COMPLETED}::"ReviewStatus"
          AND (
            (s."type" = ${SubmissionType.CONTEST_SUBMISSION}::"SubmissionType"
              AND sc."type" = ${ScorecardType.SCREENING}::"ScorecardType")
            OR
            (s."type" = ${SubmissionType.CHECKPOINT_SUBMISSION}::"SubmissionType"
              AND sc."type" = ${ScorecardType.CHECKPOINT_SCREENING}::"ScorecardType")
          )
          AND GREATEST(
            COALESCE(r."finalScore", 0),
            COALESCE(r."initialScore", 0)
          ) >= COALESCE(sc."minimumPassingScore", sc."minScore", 50)
      )
    `;

    const [rows, countRows] = await this.prisma.$transaction([
      this.prisma.$queryRaw<ReleasedPreviewRow[]>(Prisma.sql`
        SELECT
          s."id",
          s."type",
          s."submittedDate",
          s."createdAt",
          s."memberId",
          p."objectKey"
        FROM "submission" s
        INNER JOIN "submissionPreview" p ON p."submissionId" = s."id"
        WHERE ${eligibleWhere}
        ORDER BY s."submittedDate" DESC NULLS LAST, s."createdAt" DESC, s."id" ASC
        LIMIT ${perPage}
        OFFSET ${offset}
      `),
      this.prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS "total"
        FROM "submission" s
        INNER JOIN "submissionPreview" p ON p."submissionId" = s."id"
        WHERE ${eligibleWhere}
      `),
    ]);

    const handleByMemberId = await this.loadPreviewHandles(rows);
    const totalCount = Number(countRows[0]?.total ?? 0n);
    return {
      data: rows.map((row) => ({
        id: row.id,
        type: row.type,
        submittedDate: row.submittedDate ?? row.createdAt,
        previewUrl: this.buildPublicAssetUrl(row.objectKey),
        ...(row.memberId && handleByMemberId.has(row.memberId)
          ? { submitterHandle: handleByMemberId.get(row.memberId) }
          : {}),
      })),
      meta: {
        page,
        perPage,
        totalCount,
        totalPages: totalCount === 0 ? 0 : Math.ceil(totalCount / perPage),
      },
    };
  }

  /**
   * Resolves public member handles for a gallery page without making member
   * storage availability a prerequisite for preview display.
   *
   * @param rows released preview database rows
   * @returns member-id to handle mapping
   */
  private async loadPreviewHandles(
    rows: ReleasedPreviewRow[],
  ): Promise<Map<string, string>> {
    const memberIds = Array.from(
      new Set(
        rows
          .map((row) => row.memberId)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    if (!memberIds.length || !this.memberService) return new Map();
    try {
      const members = await this.memberService.getUserEmails(memberIds);
      return new Map(
        members
          .filter((member) => member.handle)
          .map((member) => [String(member.userId), member.handle]),
      );
    } catch (error) {
      this.logger.warn(
        `Could not resolve preview submitter handles: ${this.errorMessage(error)}`,
      );
      return new Map();
    }
  }

  /**
   * Creates consistent empty pagination metadata when no preview type is
   * released yet.
   *
   * @param page requested page
   * @param perPage requested page size
   * @returns empty preview page
   */
  private emptyPreviewPage(
    page: number,
    perPage: number,
  ): ReleasedSubmissionPreviewPage {
    return {
      data: [],
      meta: { page, perPage, totalCount: 0, totalPages: 0 },
    };
  }

  /**
   * Claims a due job using an atomic update and a stale-processing lease.
   *
   * @param submissionId - Preview job primary key.
   * @returns True only for the worker that acquired the lease.
   */
  private async claimJob(submissionId: string): Promise<boolean> {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - PROCESSING_LEASE_MS);
    const maxAttempts = this.getPositiveIntegerConfig(
      'SUBMISSION_PREVIEW_MAX_ATTEMPTS',
      DEFAULT_MAX_ATTEMPTS,
      1,
      20,
    );
    const result = await this.prisma.submissionPreview.updateMany({
      where: {
        submissionId,
        attemptCount: { lt: maxAttempts },
        OR: [
          {
            status: {
              in: [
                SubmissionPreviewStatus.PENDING,
                SubmissionPreviewStatus.FAILED,
              ],
            },
            nextAttemptAt: { lte: now },
          },
          {
            status: SubmissionPreviewStatus.PROCESSING,
            processingStartedAt: { lt: staleBefore },
          },
        ],
      },
      data: {
        status: SubmissionPreviewStatus.PROCESSING,
        processingStartedAt: now,
        attemptCount: { increment: 1 },
        lastError: null,
      },
    });
    return result.count === 1;
  }

  /**
   * Records a processing failure and applies bounded exponential backoff.
   *
   * @param submissionId - Failed preview job identifier.
   * @param error - Error thrown by ZIP, S3, or database processing.
   * @param sourceETag - Source object version observed before the failure.
   * @returns A promise that resolves when durable failure state is stored.
   */
  private async recordFailure(
    submissionId: string,
    error: unknown,
    sourceETag?: string,
  ): Promise<void> {
    const classified =
      error instanceof PreviewProcessingError
        ? error
        : new PreviewProcessingError(
            'PREVIEW_PROCESSING_FAILED',
            this.errorMessage(error),
            true,
          );
    const job = await this.prisma.submissionPreview.findUnique({
      where: { submissionId },
      select: { attemptCount: true },
    });
    if (!job) {
      this.logger.error(
        `Preview processing failed without a durable job for ${submissionId}: ${classified.message}`,
      );
      return;
    }

    const maxAttempts = this.getPositiveIntegerConfig(
      'SUBMISSION_PREVIEW_MAX_ATTEMPTS',
      DEFAULT_MAX_ATTEMPTS,
      1,
      20,
    );
    const retryable = classified.retryable && job.attemptCount < maxAttempts;
    const delayMinutes = Math.min(60, 2 ** Math.max(0, job.attemptCount - 1));
    const nextAttemptAt = retryable
      ? new Date(Date.now() + delayMinutes * 60 * 1000)
      : new Date(8640000000000000);
    await this.prisma.submissionPreview.update({
      where: { submissionId },
      data: {
        status: SubmissionPreviewStatus.FAILED,
        processingStartedAt: null,
        nextAttemptAt,
        processedAt: retryable ? null : new Date(),
        ...(sourceETag !== undefined ? { sourceETag } : {}),
        lastError: `${classified.code}: ${classified.message}`.slice(0, 10_000),
      },
    });
    this.logger.error(
      `Preview processing failed for ${submissionId} (${classified.code}, retry=${retryable}): ${classified.message}`,
    );
  }

  /**
   * Extracts the single root preview file after validating every central
   * directory entry for traversal, encryption, count, expanded size, and
   * compression-ratio limits.
   *
   * @param archivePath - Local path to the bounded temporary ZIP.
   * @returns Validated preview bytes, or null when the file is absent.
   * @throws PreviewProcessingError for unsafe or malformed archives.
   */
  private async extractPreview(
    archivePath: string,
  ): Promise<PreviewFile | null> {
    const zip = await this.openZip(archivePath);
    try {
      const entry = await this.inspectZip(zip);
      if (!entry) {
        return null;
      }
      const maxPreviewBytes = this.getPositiveIntegerConfig(
        'SUBMISSION_PREVIEW_MAX_IMAGE_BYTES',
        DEFAULT_MAX_PREVIEW_BYTES,
        1024,
        100 * 1024 * 1024,
      );
      const data = await this.readZipEntry(zip, entry, maxPreviewBytes);
      const lowerName = entry.fileName.toLowerCase();
      const isPng = data
        .subarray(0, PNG_SIGNATURE.length)
        .equals(PNG_SIGNATURE);
      const isJpeg =
        data.length >= 3 &&
        data[0] === 0xff &&
        data[1] === 0xd8 &&
        data[2] === 0xff;
      if (lowerName.endsWith('.png') && isPng) {
        return { data, contentType: 'image/png', extension: 'png' };
      }
      if (lowerName.endsWith('.jpg') && isJpeg) {
        return { data, contentType: 'image/jpeg', extension: 'jpg' };
      }
      throw new PreviewProcessingError(
        'PREVIEW_CONTENT_TYPE_MISMATCH',
        'The preview extension does not match its PNG or JPEG file signature.',
        false,
      );
    } finally {
      zip.close();
    }
  }

  /**
   * Opens a ZIP with lazy entry reads and expanded-size validation enabled.
   *
   * @param archivePath - Local archive path.
   * @returns Open yauzl archive handle.
   * @throws PreviewProcessingError when the archive is not a valid ZIP.
   */
  private openZip(archivePath: string): Promise<yauzl.ZipFile> {
    return new Promise((resolve, reject) => {
      yauzl.open(
        archivePath,
        {
          autoClose: false,
          lazyEntries: true,
          decodeStrings: true,
          validateEntrySizes: true,
          strictFileNames: true,
        },
        (error, zip) => {
          if (error || !zip) {
            reject(
              new PreviewProcessingError(
                'INVALID_ZIP',
                error?.message ?? 'Submission archive could not be opened.',
                false,
              ),
            );
            return;
          }
          resolve(zip);
        },
      );
    });
  }

  /**
   * Validates ZIP metadata and locates an unambiguous root preview entry.
   *
   * @param zip - Open lazy yauzl archive.
   * @returns The preview entry or null when neither supported name exists.
   * @throws PreviewProcessingError when any entry violates safety limits.
   */
  private inspectZip(zip: yauzl.ZipFile): Promise<yauzl.Entry | null> {
    const maxEntries = this.getPositiveIntegerConfig(
      'SUBMISSION_PREVIEW_MAX_ZIP_ENTRIES',
      DEFAULT_MAX_ZIP_ENTRIES,
      1,
      100_000,
    );
    const maxExpanded = this.getPositiveIntegerConfig(
      'SUBMISSION_PREVIEW_MAX_UNCOMPRESSED_BYTES',
      DEFAULT_MAX_UNCOMPRESSED_BYTES,
      1024,
      4 * 1024 * 1024 * 1024,
    );
    const maxRatio = this.getPositiveIntegerConfig(
      'SUBMISSION_PREVIEW_MAX_COMPRESSION_RATIO',
      DEFAULT_MAX_COMPRESSION_RATIO,
      1,
      10_000,
    );
    if (zip.entryCount > maxEntries) {
      return Promise.reject(
        new PreviewProcessingError(
          'ZIP_ENTRY_LIMIT_EXCEEDED',
          `ZIP contains ${zip.entryCount} entries; limit is ${maxEntries}.`,
          false,
        ),
      );
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      let totalExpanded = 0;
      const previews: yauzl.Entry[] = [];
      const fail = (error: Error): void => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };

      zip.on('error', (error) =>
        fail(
          error instanceof PreviewProcessingError
            ? error
            : new PreviewProcessingError('INVALID_ZIP', error.message, false),
        ),
      );
      zip.on('entry', (entry: yauzl.Entry) => {
        try {
          const name = this.validateZipEntryPath(entry.fileName);
          if (entry.isEncrypted()) {
            throw new PreviewProcessingError(
              'ENCRYPTED_ZIP_ENTRY',
              `Encrypted ZIP entry is not allowed: ${name}`,
              false,
            );
          }
          const isDirectory = name.endsWith('/');
          if (!isDirectory) {
            totalExpanded += entry.uncompressedSize;
            if (
              !Number.isSafeInteger(totalExpanded) ||
              totalExpanded > maxExpanded
            ) {
              throw new PreviewProcessingError(
                'ZIP_EXPANDED_SIZE_EXCEEDED',
                `ZIP expanded size exceeds the ${maxExpanded}-byte limit.`,
                false,
              );
            }
            const ratio =
              entry.compressedSize === 0
                ? entry.uncompressedSize === 0
                  ? 1
                  : Number.POSITIVE_INFINITY
                : entry.uncompressedSize / entry.compressedSize;
            if (ratio > maxRatio) {
              throw new PreviewProcessingError(
                'ZIP_COMPRESSION_RATIO_EXCEEDED',
                `ZIP entry ${name} exceeds the ${maxRatio}:1 compression-ratio limit.`,
                false,
              );
            }
          }
          if (name === 'preview.jpg' || name === 'preview.png') {
            previews.push(entry);
          }
          zip.readEntry();
        } catch (error) {
          fail(
            error instanceof Error
              ? error
              : new PreviewProcessingError('INVALID_ZIP', String(error), false),
          );
        }
      });
      zip.on('end', () => {
        if (settled) {
          return;
        }
        settled = true;
        if (previews.length > 1) {
          reject(
            new PreviewProcessingError(
              'MULTIPLE_PREVIEWS',
              'ZIP contains more than one root preview.jpg or preview.png.',
              false,
            ),
          );
          return;
        }
        resolve(previews[0] ?? null);
      });
      zip.readEntry();
    });
  }

  /**
   * Reads one validated ZIP entry into a bounded buffer.
   *
   * @param zip - Open archive handle.
   * @param entry - Preview entry selected during central-directory inspection.
   * @param maxBytes - Maximum permitted expanded preview size.
   * @returns Preview bytes.
   * @throws PreviewProcessingError when streaming fails or exceeds the limit.
   */
  private readZipEntry(
    zip: yauzl.ZipFile,
    entry: yauzl.Entry,
    maxBytes: number,
  ): Promise<Buffer> {
    if (entry.uncompressedSize > maxBytes) {
      return Promise.reject(
        new PreviewProcessingError(
          'PREVIEW_TOO_LARGE',
          `Preview is ${entry.uncompressedSize} bytes; limit is ${maxBytes}.`,
          false,
        ),
      );
    }
    return new Promise((resolve, reject) => {
      zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) {
          reject(
            new PreviewProcessingError(
              'PREVIEW_EXTRACTION_FAILED',
              error?.message ?? 'Preview entry could not be opened.',
              false,
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on('data', (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += buffer.length;
          if (size > maxBytes) {
            stream.destroy(
              new PreviewProcessingError(
                'PREVIEW_TOO_LARGE',
                `Preview exceeds the ${maxBytes}-byte limit.`,
                false,
              ),
            );
            return;
          }
          chunks.push(buffer);
        });
        stream.once('error', (streamError) => reject(streamError));
        stream.once('end', () => resolve(Buffer.concat(chunks, size)));
      });
    });
  }

  /**
   * Rejects absolute paths, parent traversal, NULs, and platform-specific drive
   * paths even though preview extraction never writes an entry path to disk.
   *
   * @param fileName - Decoded ZIP entry name.
   * @returns Normalized lowercase POSIX entry path.
   * @throws PreviewProcessingError when the path is unsafe.
   */
  private validateZipEntryPath(fileName: string): string {
    const normalized = fileName.replace(/\\/g, '/').toLowerCase();
    const segments = normalized.split('/');
    if (
      !normalized ||
      normalized.includes('\0') ||
      normalized.startsWith('/') ||
      /^[a-z]:\//i.test(normalized) ||
      segments.some((segment) => segment === '..')
    ) {
      throw new PreviewProcessingError(
        'UNSAFE_ZIP_PATH',
        `ZIP entry uses an unsafe path: ${basename(fileName) || '(unnamed)'}`,
        false,
      );
    }
    return normalized.replace(/^\.\//, '');
  }

  /**
   * Converts an AWS streaming body implementation to a Node readable stream.
   *
   * @param body - AWS SDK GetObject body.
   * @returns Node-readable body stream.
   * @throws PreviewProcessingError when the runtime body cannot be consumed.
   */
  private async toNodeReadable(body: unknown): Promise<Readable> {
    if (body instanceof Readable) {
      return body;
    }
    const sdkBody = body as {
      transformToByteArray?: () => Promise<Uint8Array>;
    };
    if (typeof sdkBody?.transformToByteArray === 'function') {
      return Readable.from(Buffer.from(await sdkBody.transformToByteArray()));
    }
    throw new PreviewProcessingError(
      'UNSUPPORTED_S3_BODY',
      'S3 returned an unsupported streaming body.',
      true,
    );
  }

  /**
   * Parses a scanned submission URL and enforces that it targets the configured
   * clean bucket. DMZ, quarantine, and arbitrary external URLs are rejected.
   *
   * @param sourceUrl - Submission object URL stored after antivirus scanning.
   * @returns Clean S3 bucket and decoded object key.
   * @throws PreviewProcessingError for non-clean or malformed URLs.
   */
  private parseCleanSubmissionSource(sourceUrl: string): PreviewSource {
    const cleanBucket = this.requireConfig('SUBMISSION_CLEAN_S3_BUCKET');
    let bucket = '';
    let key = '';
    try {
      if (sourceUrl.startsWith('s3://')) {
        const withoutScheme = sourceUrl.slice(5);
        const slash = withoutScheme.indexOf('/');
        bucket = slash > 0 ? withoutScheme.slice(0, slash) : '';
        key = slash > 0 ? withoutScheme.slice(slash + 1) : '';
      } else {
        const parsed = new URL(sourceUrl);
        const virtualHost = parsed.hostname.match(
          /^(?<bucket>.+)\.s3(?:[.-][^.]+)?\.amazonaws\.com$/i,
        );
        if (virtualHost?.groups?.bucket) {
          bucket = virtualHost.groups.bucket;
          key = parsed.pathname.replace(/^\//, '');
        } else if (
          /^s3(?:[.-][^.]+)?\.amazonaws\.com$/i.test(parsed.hostname)
        ) {
          const parts = parsed.pathname.replace(/^\//, '').split('/');
          bucket = parts.shift() ?? '';
          key = parts.join('/');
        }
      }
      key = decodeURIComponent(key);
    } catch {
      bucket = '';
      key = '';
    }
    if (bucket !== cleanBucket || !key || key.includes('\0')) {
      throw new PreviewProcessingError(
        'INVALID_SUBMISSION_SOURCE',
        'Submission URL does not identify an object in the configured clean bucket.',
        false,
      );
    }
    return { bucket, key };
  }

  /**
   * Rejects an explicitly non-ZIP S3 content type. Generic binary and missing
   * metadata remain accepted because ZIP validity is verified by yauzl.
   *
   * @param contentType - S3 Content-Type metadata, when present.
   * @returns Nothing when the type is acceptable.
   * @throws PreviewProcessingError for known non-ZIP media types.
   */
  private validateArchiveContentType(contentType?: string): void {
    if (!contentType) {
      return;
    }
    const normalized = contentType.split(';')[0].trim().toLowerCase();
    if (
      ![
        'application/zip',
        'application/x-zip-compressed',
        'application/octet-stream',
        'binary/octet-stream',
      ].includes(normalized)
    ) {
      throw new PreviewProcessingError(
        'INVALID_ARCHIVE_CONTENT_TYPE',
        `Submission object has unsupported content type ${normalized}.`,
        false,
      );
    }
  }

  /**
   * Verifies that a completed review is the matching Screening type and that
   * its greater finite initial/final score meets the scorecard threshold. This
   * matches the existing Screening gate used when opening Review work.
   *
   * @param review - Screening review and scorecard values to evaluate.
   * @param submissionType - Contest or checkpoint submission classification.
   * @returns True only for a completed, matching, passing Screening review.
   */
  private isPassingScreeningReview(
    review: ScreeningReviewSummary,
    submissionType: SubmissionType,
  ): boolean {
    if (review.status !== ReviewStatus.COMPLETED) {
      return false;
    }
    const expectedType =
      submissionType === SubmissionType.CONTEST_SUBMISSION
        ? ScorecardType.SCREENING
        : submissionType === SubmissionType.CHECKPOINT_SUBMISSION
          ? ScorecardType.CHECKPOINT_SCREENING
          : null;
    if (!expectedType || review.scorecard.type !== expectedType) {
      return false;
    }

    const scores = [review.initialScore, review.finalScore].filter(
      (score): score is number =>
        typeof score === 'number' && Number.isFinite(score),
    );
    const score = scores.length ? Math.max(...scores) : null;
    const passingScore = Number.isFinite(review.scorecard.minimumPassingScore)
      ? review.scorecard.minimumPassingScore
      : Number.isFinite(review.scorecard.minScore)
        ? review.scorecard.minScore
        : null;
    return score !== null && passingScore !== null && score >= passingScore;
  }

  /**
   * Determines whether challenge metadata identifies the Design track.
   *
   * @param challenge - Challenge data loaded from challenge-api storage.
   * @returns True only for a Design challenge.
   */
  private isDesignChallenge(challenge: ChallengeData): boolean {
    const names = [challenge.track, challenge.legacy?.track]
      .map((value) =>
        String(value ?? '')
          .trim()
          .toLowerCase(),
      )
      .filter(Boolean);
    return names.includes('design');
  }

  /**
   * Checks for a named phase with an actual end timestamp no later than now.
   * Scheduled end dates and a closed flag alone never release a preview.
   *
   * @param challenge - Challenge containing phase state.
   * @param phaseName - Normalized phase name to evaluate.
   * @returns True when at least one matching phase actually completed.
   */
  private hasPhaseActuallyCompleted(
    challenge: ChallengeData,
    phaseName: string,
  ): boolean {
    const now = Date.now();
    return (challenge.phases ?? []).some((phase) => {
      if (phase.name.trim().toLowerCase() !== phaseName) {
        return false;
      }
      const actualEnd = phase.actualEndTime
        ? new Date(phase.actualEndTime).getTime()
        : Number.NaN;
      return Number.isFinite(actualEnd) && actualEnd <= now;
    });
  }

  /**
   * Builds a stable, unguessable key inside the Payload media prefix.
   *
   * @param challengeId - Owning challenge identifier.
   * @param submissionId - Owning submission identifier.
   * @param storageToken - Random database token not exposed before visibility.
   * @param extension - Validated image extension.
   * @returns Payload S3 object key.
   */
  private buildDestinationKey(
    challengeId: string,
    submissionId: string,
    storageToken: string,
    extension: 'jpg' | 'png',
  ): string {
    const basePrefix = this.normalizeS3Prefix(
      process.env.PAYLOAD_S3_PREFIX ?? 'media',
    );
    const previewPrefix = this.normalizeS3Prefix(
      process.env.SUBMISSION_PREVIEW_S3_PREFIX ?? 'submission-previews',
    );
    const segments = [
      basePrefix,
      previewPrefix,
      this.safeKeySegment(challengeId),
      this.safeKeySegment(submissionId),
      this.safeKeySegment(storageToken),
      `preview.${extension}`,
    ].filter(Boolean);
    return segments.join('/');
  }

  /**
   * Builds an HTTPS URL beneath the configured Payload public asset origin.
   *
   * @param objectKey - Published Payload S3 key.
   * @returns Public asset URL.
   * @throws PreviewProcessingError when the configured origin is unsafe.
   */
  private buildPublicAssetUrl(objectKey: string): string {
    const rawOrigin = this.requireConfig('PAYLOAD_S3_PUBLIC_URL');
    let origin: URL;
    try {
      origin = new URL(rawOrigin);
    } catch {
      throw new PreviewProcessingError(
        'INVALID_PAYLOAD_PUBLIC_URL',
        'PAYLOAD_S3_PUBLIC_URL must be a valid HTTPS origin.',
        false,
      );
    }
    if (
      origin.protocol !== 'https:' ||
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash
    ) {
      throw new PreviewProcessingError(
        'INVALID_PAYLOAD_PUBLIC_URL',
        'PAYLOAD_S3_PUBLIC_URL must be a credential-free HTTPS origin.',
        false,
      );
    }
    const encodedKey = objectKey
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return `${origin.toString().replace(/\/$/, '')}/${encodedKey}`;
  }

  /**
   * Normalizes a configurable S3 key prefix and rejects traversal segments.
   *
   * @param prefix - Raw slash-delimited prefix.
   * @returns Normalized prefix without leading or trailing slashes.
   * @throws PreviewProcessingError when the prefix contains unsafe segments.
   */
  private normalizeS3Prefix(prefix: string): string {
    const normalized = prefix.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const segments = normalized.split('/').filter(Boolean);
    if (segments.some((segment) => segment === '.' || segment === '..')) {
      throw new PreviewProcessingError(
        'INVALID_S3_PREFIX',
        'Preview S3 prefixes cannot contain dot traversal segments.',
        false,
      );
    }
    return segments.map((segment) => this.safeKeySegment(segment)).join('/');
  }

  /**
   * Restricts dynamic S3 path components to a conservative character set.
   *
   * @param value - Dynamic key component.
   * @returns Sanitized non-empty component.
   * @throws PreviewProcessingError when no safe characters remain.
   */
  private safeKeySegment(value: string): string {
    const safe = value.trim().replace(/[^A-Za-z0-9_-]/g, '_');
    if (!safe) {
      throw new PreviewProcessingError(
        'INVALID_S3_KEY_SEGMENT',
        'Preview S3 key contains an empty dynamic segment.',
        false,
      );
    }
    return safe;
  }

  /**
   * Creates an S3 client for the clean submission bucket.
   *
   * @returns AWS SDK S3 client using the task-role credential chain.
   */
  private createSourceS3Client(): S3Client {
    return this.createS3Client(process.env.AWS_REGION);
  }

  /**
   * Creates an S3 client for the Payload asset bucket and its optional region.
   *
   * @returns AWS SDK S3 client using the task-role credential chain.
   */
  private createPayloadS3Client(): S3Client {
    return this.createS3Client(
      process.env.PAYLOAD_S3_REGION ?? process.env.AWS_REGION,
    );
  }

  /**
   * Creates a configured AWS SDK client. Endpoint and path-style options make
   * local S3-compatible testing possible without embedding credentials.
   *
   * @param region - AWS region resolved for the target bucket.
   * @returns Configured S3 client.
   */
  private createS3Client(region?: string): S3Client {
    const endpoint = process.env.S3_ENDPOINT?.trim();
    return new S3Client({
      ...(region ? { region } : {}),
      ...(endpoint ? { endpoint } : {}),
      forcePathStyle:
        String(process.env.S3_FORCE_PATH_STYLE).toLowerCase() === 'true',
    });
  }

  /**
   * Reads a required environment variable without accepting blank values.
   *
   * @param name - Environment variable name.
   * @returns Trimmed configured value.
   * @throws PreviewProcessingError when the variable is missing.
   */
  private requireConfig(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) {
      throw new PreviewProcessingError(
        'PREVIEW_CONFIGURATION_MISSING',
        `${name} is required for submission preview processing.`,
        true,
      );
    }
    return value;
  }

  /**
   * Reads a bounded positive integer configuration value with a safe fallback.
   *
   * @param name - Environment variable name.
   * @param fallback - Value used when configuration is absent or malformed.
   * @param minimum - Inclusive lower bound.
   * @param maximum - Inclusive upper bound.
   * @returns Parsed value or fallback.
   */
  private getPositiveIntegerConfig(
    name: string,
    fallback: number,
    minimum: number,
    maximum: number,
  ): number {
    const parsed = Number(process.env[name]);
    return Number.isSafeInteger(parsed) &&
      parsed >= minimum &&
      parsed <= maximum
      ? parsed
      : fallback;
  }

  /**
   * Creates the uniform public 404 response for every unavailable preview.
   *
   * @param submissionId - Requested submission identifier.
   * @returns Nest 404 exception with a stable code.
   */
  private previewUnavailable(submissionId: string): NotFoundException {
    return new NotFoundException({
      message: 'Submission preview is not available.',
      code: 'SUBMISSION_PREVIEW_NOT_AVAILABLE',
      details: { submissionId },
    });
  }

  /**
   * Converts an unknown thrown value to safe operator-facing text.
   *
   * @param error - Unknown thrown value.
   * @returns Error message string.
   */
  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
