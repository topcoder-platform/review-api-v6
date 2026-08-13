jest.mock('nanoid', () => ({
  __esModule: true,
  nanoid: () => 'mock-nanoid',
}));

import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import {
  ReviewStatus,
  ScorecardType,
  SubmissionPreviewStatus,
  SubmissionStatus,
  SubmissionType,
} from '@prisma/client';
import archiver from 'archiver';
import { PassThrough, Readable } from 'stream';
import { ChallengeStatus } from 'src/shared/enums/challengeStatus.enum';
import { SubmissionPreviewService } from './submission-preview.service';

/**
 * Builds an in-memory ZIP fixture using the same streaming format accepted by
 * production uploads.
 *
 * @param entries - ZIP entry names and byte contents.
 * @returns Complete ZIP bytes.
 */
async function buildZip(
  entries: Array<{ name: string; data: Buffer }>,
): Promise<Buffer> {
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  const completed = new Promise<Buffer>((resolve, reject) => {
    output.once('end', () => resolve(Buffer.concat(chunks)));
    output.once('error', reject);
  });
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.once('error', (error) => output.destroy(error));
  archive.pipe(output);
  for (const entry of entries) {
    archive.append(entry.data, { name: entry.name });
  }
  await archive.finalize();
  return completed;
}

/**
 * Builds a completed passing Screening review for a submission fixture.
 *
 * @param submissionType - Contest or checkpoint submission classification.
 * @returns Review relation fixture accepted by the preview eligibility check.
 */
function buildPassingScreeningReview(submissionType: SubmissionType) {
  return {
    status: ReviewStatus.COMPLETED,
    initialScore: 80,
    finalScore: 90,
    scorecard: {
      type:
        submissionType === SubmissionType.CHECKPOINT_SUBMISSION
          ? ScorecardType.CHECKPOINT_SCREENING
          : ScorecardType.SCREENING,
      minScore: 50,
      minimumPassingScore: 75,
    },
  };
}

describe('SubmissionPreviewService', () => {
  const prismaMock = {
    review: { findUnique: jest.fn() },
    submission: { findUnique: jest.fn() },
    submissionPreview: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  } as any;
  const challengeServiceMock = {
    getChallengeDetail: jest.fn(),
    ensureChallengeWhitelistAccess: jest.fn(),
  } as any;
  let service: SubmissionPreviewService;
  let sourceSend: jest.Mock;
  let payloadSend: jest.Mock;
  const originalEnv = { ...process.env };

  /**
   * Configures a claimed, processable contest-submission preview job.
   *
   * @param overrides - Submission fields that should replace the defaults.
   * @returns Nothing; Prisma mocks are prepared for one processing attempt.
   */
  function mockProcessableJob(overrides: Record<string, unknown> = {}): void {
    prismaMock.submissionPreview.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.submissionPreview.findUnique.mockResolvedValue({
      submissionId: 'submission-01',
      storageToken: 'd00d4a75-542a-4f87-9292-d6396a27e818',
      attemptCount: 1,
      submission: {
        id: 'submission-01',
        challengeId: 'challenge-1',
        type: SubmissionType.CONTEST_SUBMISSION,
        status: SubmissionStatus.ACTIVE,
        virusScan: true,
        isFileSubmission: true,
        url: 's3://clean-bucket/submission.zip',
        review: [
          buildPassingScreeningReview(SubmissionType.CONTEST_SUBMISSION),
        ],
        ...overrides,
      },
    });
    prismaMock.submissionPreview.update.mockResolvedValue({});
  }

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SUBMISSION_CLEAN_S3_BUCKET = 'clean-bucket';
    process.env.PAYLOAD_S3_BUCKET = 'payload-bucket';
    process.env.PAYLOAD_S3_PREFIX = 'media';
    process.env.PAYLOAD_S3_PUBLIC_URL = 'https://assets.topcoder-dev.com';
    sourceSend = jest.fn();
    payloadSend = jest.fn();
    service = new SubmissionPreviewService(prismaMock, challengeServiceMock);
    challengeServiceMock.getChallengeDetail.mockResolvedValue({
      id: 'challenge-1',
      track: 'Design',
    });
    jest
      .spyOn(service as any, 'createSourceS3Client')
      .mockReturnValue({ send: sourceSend });
    jest
      .spyOn(service as any, 'createPayloadS3Client')
      .mockReturnValue({ send: payloadSend });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('idempotently queues a scanned submission without a challenge-service dependency', async () => {
    prismaMock.review.findUnique.mockResolvedValue({
      status: ReviewStatus.COMPLETED,
      initialScore: 80,
      finalScore: 90,
      scorecard: {
        type: ScorecardType.SCREENING,
        minScore: 50,
        minimumPassingScore: 75,
      },
      submission: {
        id: 'submission-01',
        type: SubmissionType.CONTEST_SUBMISSION,
        status: SubmissionStatus.ACTIVE,
        challengeId: 'challenge-1',
        virusScan: true,
        isFileSubmission: true,
        url: 's3://clean-bucket/submissions/design.zip',
      },
    });
    prismaMock.submissionPreview.upsert.mockResolvedValue({});

    await expect(service.enqueueFromCompletedReview('review-1')).resolves.toBe(
      true,
    );
    expect(prismaMock.submissionPreview.upsert).toHaveBeenCalledWith({
      where: { submissionId: 'submission-01' },
      create: { submissionId: 'submission-01' },
      update: {},
    });
    expect(challengeServiceMock.getChallengeDetail).not.toHaveBeenCalled();
  });

  it('selects stale processing leases so another worker can reclaim them', async () => {
    prismaMock.submissionPreview.findMany.mockResolvedValue([
      { submissionId: 'stale-submission' },
    ]);
    const processSpy = jest
      .spyOn(service, 'processSubmissionPreview')
      .mockResolvedValue(true);

    await service.processDuePreviews();

    expect(prismaMock.submissionPreview.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              status: SubmissionPreviewStatus.PROCESSING,
              processingStartedAt: { lt: expect.any(Date) },
            }),
          ]),
        }),
      }),
    );
    expect(processSpy).toHaveBeenCalledWith('stale-submission');
  });

  it('publishes a validated root preview to the Payload asset prefix', async () => {
    const png = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      Buffer.from('preview-payload'),
    ]);
    const zip = await buildZip([{ name: 'preview.png', data: png }]);
    prismaMock.submissionPreview.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.submissionPreview.findUnique.mockResolvedValue({
      submissionId: 'submission-01',
      storageToken: 'd00d4a75-542a-4f87-9292-d6396a27e818',
      submission: {
        id: 'submission-01',
        challengeId: 'challenge-1',
        type: SubmissionType.CONTEST_SUBMISSION,
        status: SubmissionStatus.ACTIVE,
        virusScan: true,
        isFileSubmission: true,
        url: 'https://clean-bucket.s3.amazonaws.com/submissions/design.zip',
        review: [
          buildPassingScreeningReview(SubmissionType.CONTEST_SUBMISSION),
        ],
      },
    });
    sourceSend.mockImplementation((command) => {
      if (command instanceof HeadObjectCommand) {
        return Promise.resolve({
          ContentLength: zip.length,
          ContentType: 'application/zip',
          ETag: '"source-etag"',
        });
      }
      if (command instanceof GetObjectCommand) {
        return Promise.resolve({ Body: Readable.from(zip) });
      }
      throw new Error('Unexpected source command');
    });
    payloadSend.mockResolvedValue({});
    prismaMock.submissionPreview.update.mockResolvedValue({});

    await expect(
      service.processSubmissionPreview('submission-01'),
    ).resolves.toBe(true);

    const put = payloadSend.mock.calls[0][0];
    expect(put).toBeInstanceOf(PutObjectCommand);
    expect(put.input).toEqual(
      expect.objectContaining({
        Bucket: 'payload-bucket',
        Key: 'media/submission-previews/challenge-1/submission-01/d00d4a75-542a-4f87-9292-d6396a27e818/preview.png',
        ContentType: 'image/png',
        ContentDisposition: 'inline',
      }),
    );
    const get = sourceSend.mock.calls.find(
      ([command]) => command instanceof GetObjectCommand,
    )?.[0] as GetObjectCommand;
    expect(get.input.IfMatch).toBe('"source-etag"');
    expect(prismaMock.submissionPreview.update).toHaveBeenLastCalledWith({
      where: { submissionId: 'submission-01' },
      data: expect.objectContaining({
        status: SubmissionPreviewStatus.READY,
        sourceETag: 'source-etag',
        sizeBytes: png.length,
        lastError: null,
      }),
    });
  });

  it('records a missing preview as a terminal, non-public state', async () => {
    const zip = await buildZip([
      { name: 'README.txt', data: Buffer.from('No preview supplied') },
    ]);
    prismaMock.submissionPreview.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.submissionPreview.findUnique.mockResolvedValue({
      storageToken: 'd00d4a75-542a-4f87-9292-d6396a27e818',
      submission: {
        id: 'submission-01',
        challengeId: 'challenge-1',
        type: SubmissionType.CONTEST_SUBMISSION,
        status: SubmissionStatus.ACTIVE,
        virusScan: true,
        isFileSubmission: true,
        url: 's3://clean-bucket/submission.zip',
        review: [
          buildPassingScreeningReview(SubmissionType.CONTEST_SUBMISSION),
        ],
      },
    });
    sourceSend
      .mockResolvedValueOnce({
        ContentLength: zip.length,
        ContentType: 'application/octet-stream',
        ETag: 'etag',
      })
      .mockResolvedValueOnce({ Body: Readable.from(zip) });
    prismaMock.submissionPreview.update.mockResolvedValue({});

    await expect(
      service.processSubmissionPreview('submission-01'),
    ).resolves.toBe(false);
    expect(payloadSend).not.toHaveBeenCalled();
    expect(prismaMock.submissionPreview.update).toHaveBeenLastCalledWith({
      where: { submissionId: 'submission-01' },
      data: expect.objectContaining({
        status: SubmissionPreviewStatus.MISSING,
        lastError: expect.stringContaining('PREVIEW_NOT_FOUND'),
      }),
    });
  });

  it('rejects traversal paths before attempting preview extraction', () => {
    expect(() =>
      (service as any).validateZipEntryPath('../preview.png'),
    ).toThrow('unsafe path');
    expect(() => (service as any).validateZipEntryPath('/preview.png')).toThrow(
      'unsafe path',
    );
  });

  it('rejects an explicitly non-ZIP source content type', async () => {
    mockProcessableJob();
    sourceSend.mockResolvedValueOnce({
      ContentLength: 100,
      ContentType: 'image/png',
    });

    await expect(
      service.processSubmissionPreview('submission-01'),
    ).resolves.toBe(false);
    expect(sourceSend).toHaveBeenCalledTimes(1);
    expect(prismaMock.submissionPreview.update).toHaveBeenLastCalledWith({
      where: { submissionId: 'submission-01' },
      data: expect.objectContaining({
        status: SubmissionPreviewStatus.FAILED,
        lastError: expect.stringContaining('INVALID_ARCHIVE_CONTENT_TYPE'),
      }),
    });
  });

  it('stops a non-Design candidate before reading its submission archive', async () => {
    mockProcessableJob();
    challengeServiceMock.getChallengeDetail.mockResolvedValue({
      id: 'challenge-1',
      track: 'Development',
    });

    await expect(
      service.processSubmissionPreview('submission-01'),
    ).resolves.toBe(false);
    expect(sourceSend).not.toHaveBeenCalled();
    expect(prismaMock.submissionPreview.update).toHaveBeenLastCalledWith({
      where: { submissionId: 'submission-01' },
      data: expect.objectContaining({
        status: SubmissionPreviewStatus.FAILED,
        lastError: expect.stringContaining('CHALLENGE_NOT_DESIGN'),
      }),
    });
  });

  it('rejects a source archive above the configured byte ceiling', async () => {
    process.env.SUBMISSION_PREVIEW_MAX_ARCHIVE_BYTES = '1024';
    mockProcessableJob();
    sourceSend.mockResolvedValueOnce({
      ContentLength: 1025,
      ContentType: 'application/zip',
    });

    try {
      await expect(
        service.processSubmissionPreview('submission-01'),
      ).resolves.toBe(false);
      expect(sourceSend).toHaveBeenCalledTimes(1);
      expect(prismaMock.submissionPreview.update).toHaveBeenLastCalledWith({
        where: { submissionId: 'submission-01' },
        data: expect.objectContaining({
          status: SubmissionPreviewStatus.FAILED,
          lastError: expect.stringContaining('ARCHIVE_TOO_LARGE'),
        }),
      });
    } finally {
      delete process.env.SUBMISSION_PREVIEW_MAX_ARCHIVE_BYTES;
    }
  });

  it('rejects a ZIP bomb using the per-entry compression-ratio limit', async () => {
    const png = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      Buffer.from('preview-payload'),
    ]);
    const zip = await buildZip([
      { name: 'preview.png', data: png },
      { name: 'bomb.bin', data: Buffer.alloc(1024 * 1024) },
    ]);
    mockProcessableJob();
    sourceSend
      .mockResolvedValueOnce({
        ContentLength: zip.length,
        ContentType: 'application/zip',
      })
      .mockResolvedValueOnce({ Body: Readable.from(zip) });

    await expect(
      service.processSubmissionPreview('submission-01'),
    ).resolves.toBe(false);
    expect(payloadSend).not.toHaveBeenCalled();
    expect(prismaMock.submissionPreview.update).toHaveBeenLastCalledWith({
      where: { submissionId: 'submission-01' },
      data: expect.objectContaining({
        status: SubmissionPreviewStatus.FAILED,
        lastError: expect.stringContaining('ZIP_COMPRESSION_RATIO_EXCEEDED'),
      }),
    });
  });

  it('rejects a preview whose extension and file signature disagree', async () => {
    const zip = await buildZip([
      { name: 'preview.png', data: Buffer.from('not an image') },
    ]);
    mockProcessableJob();
    sourceSend
      .mockResolvedValueOnce({
        ContentLength: zip.length,
        ContentType: 'application/zip',
      })
      .mockResolvedValueOnce({ Body: Readable.from(zip) });

    await expect(
      service.processSubmissionPreview('submission-01'),
    ).resolves.toBe(false);
    expect(payloadSend).not.toHaveBeenCalled();
    expect(prismaMock.submissionPreview.update).toHaveBeenLastCalledWith({
      where: { submissionId: 'submission-01' },
      data: expect.objectContaining({
        status: SubmissionPreviewStatus.FAILED,
        lastError: expect.stringContaining('PREVIEW_CONTENT_TYPE_MISMATCH'),
      }),
    });
  });

  it('rejects an expanded preview above the configured image limit', async () => {
    process.env.SUBMISSION_PREVIEW_MAX_IMAGE_BYTES = '1024';
    const payload = Buffer.allocUnsafe(2048);
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] = index % 251;
    }
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(payload, 0);
    const zip = await buildZip([{ name: 'preview.png', data: payload }]);
    mockProcessableJob();
    sourceSend
      .mockResolvedValueOnce({
        ContentLength: zip.length,
        ContentType: 'application/zip',
      })
      .mockResolvedValueOnce({ Body: Readable.from(zip) });

    try {
      await expect(
        service.processSubmissionPreview('submission-01'),
      ).resolves.toBe(false);
      expect(payloadSend).not.toHaveBeenCalled();
      expect(prismaMock.submissionPreview.update).toHaveBeenLastCalledWith({
        where: { submissionId: 'submission-01' },
        data: expect.objectContaining({
          status: SubmissionPreviewStatus.FAILED,
          lastError: expect.stringContaining('PREVIEW_TOO_LARGE'),
        }),
      });
    } finally {
      delete process.env.SUBMISSION_PREVIEW_MAX_IMAGE_BYTES;
    }
  });

  it('records transient S3 errors for a bounded retry', async () => {
    prismaMock.submissionPreview.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.submissionPreview.findUnique
      .mockResolvedValueOnce({
        storageToken: 'd00d4a75-542a-4f87-9292-d6396a27e818',
        submission: {
          id: 'submission-01',
          challengeId: 'challenge-1',
          type: SubmissionType.CONTEST_SUBMISSION,
          status: SubmissionStatus.ACTIVE,
          virusScan: true,
          isFileSubmission: true,
          url: 's3://clean-bucket/submission.zip',
          review: [
            buildPassingScreeningReview(SubmissionType.CONTEST_SUBMISSION),
          ],
        },
      })
      .mockResolvedValueOnce({ attemptCount: 1 });
    sourceSend.mockRejectedValue(new Error('temporary S3 outage'));
    prismaMock.submissionPreview.update.mockResolvedValue({});

    await expect(
      service.processSubmissionPreview('submission-01'),
    ).resolves.toBe(false);
    expect(prismaMock.submissionPreview.update).toHaveBeenLastCalledWith({
      where: { submissionId: 'submission-01' },
      data: expect.objectContaining({
        status: SubmissionPreviewStatus.FAILED,
        lastError: expect.stringContaining('temporary S3 outage'),
        nextAttemptAt: expect.any(Date),
      }),
    });
  });

  it.each([
    [SubmissionType.CONTEST_SUBMISSION, 'Review'],
    [SubmissionType.CHECKPOINT_SUBMISSION, 'Checkpoint Review'],
  ])(
    'releases %s only after the %s phase actually ends',
    async (submissionType, phaseName) => {
      prismaMock.submission.findUnique.mockResolvedValue({
        id: 'submission-01',
        challengeId: 'challenge-1',
        type: submissionType,
        status: SubmissionStatus.ACTIVE,
        review: [buildPassingScreeningReview(submissionType)],
        preview: {
          status: SubmissionPreviewStatus.READY,
          objectKey: 'media/submission-previews/token/preview.png',
        },
      });
      challengeServiceMock.ensureChallengeWhitelistAccess.mockResolvedValue(
        undefined,
      );
      challengeServiceMock.getChallengeDetail.mockResolvedValue({
        id: 'challenge-1',
        track: 'Design',
        status: ChallengeStatus.ACTIVE,
        phases: [
          {
            name: phaseName,
            isOpen: false,
            actualEndTime: '2026-08-12T00:00:00.000Z',
          },
        ],
      });

      await expect(
        service.getVisiblePreviewUrl(undefined, 'submission-01'),
      ).resolves.toBe(
        'https://assets.topcoder-dev.com/media/submission-previews/token/preview.png',
      );
      expect(
        challengeServiceMock.ensureChallengeWhitelistAccess,
      ).toHaveBeenCalledWith(undefined, 'challenge-1');
    },
  );

  it('returns the uniform 404 while the release phase is incomplete', async () => {
    prismaMock.submission.findUnique.mockResolvedValue({
      id: 'submission-01',
      challengeId: 'challenge-1',
      type: SubmissionType.CHECKPOINT_SUBMISSION,
      status: SubmissionStatus.ACTIVE,
      review: [
        buildPassingScreeningReview(SubmissionType.CHECKPOINT_SUBMISSION),
      ],
      preview: {
        status: SubmissionPreviewStatus.READY,
        objectKey: 'media/submission-previews/token/preview.png',
      },
    });
    challengeServiceMock.ensureChallengeWhitelistAccess.mockResolvedValue(
      undefined,
    );
    challengeServiceMock.getChallengeDetail.mockResolvedValue({
      id: 'challenge-1',
      track: 'Design',
      status: ChallengeStatus.ACTIVE,
      phases: [{ name: 'Checkpoint Review', isOpen: true }],
    });

    await expect(
      service.getVisiblePreviewUrl(undefined, 'submission-01'),
    ).rejects.toMatchObject({
      response: { code: 'SUBMISSION_PREVIEW_NOT_AVAILABLE' },
    });
  });

  it('returns the uniform 404 if the passing Screening review is reopened', async () => {
    prismaMock.submission.findUnique.mockResolvedValue({
      id: 'submission-01',
      challengeId: 'challenge-1',
      type: SubmissionType.CONTEST_SUBMISSION,
      status: SubmissionStatus.ACTIVE,
      review: [],
      preview: {
        status: SubmissionPreviewStatus.READY,
        objectKey: 'media/submission-previews/token/preview.png',
      },
    });

    await expect(
      service.getVisiblePreviewUrl(undefined, 'submission-01'),
    ).rejects.toMatchObject({
      response: { code: 'SUBMISSION_PREVIEW_NOT_AVAILABLE' },
    });
    expect(
      challengeServiceMock.ensureChallengeWhitelistAccess,
    ).not.toHaveBeenCalled();
  });
});
