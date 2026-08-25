import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  ReviewStatus,
  ScorecardType,
  SubmissionStatus,
  SubmissionType,
} from '@prisma/client';
import { createHash } from 'crypto';
import { Readable } from 'stream';
import { SubmissionService } from './submission.service';
import { UserRole } from 'src/shared/enums/userRole.enum';
import { ChallengeStatus } from 'src/shared/enums/challengeStatus.enum';
import { CommonConfig } from 'src/shared/config/common.config';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

jest.mock('nanoid', () => ({
  __esModule: true,
  nanoid: () => 'mock-nanoid',
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  __esModule: true,
  getSignedUrl: jest.fn(),
}));

describe('SubmissionService', () => {
  let service: SubmissionService;
  let resourceApiService: { getMemberResourcesRoles: jest.Mock };
  let resourcePrisma: { resource: { findMany: jest.Mock } };
  let s3Send: jest.Mock;
  const submission = {
    id: 'submission-123',
    memberId: 'owner-user',
    challengeId: 'challenge-abc',
  };
  const s3Contents = [
    { Key: `${submission.id}/regular-artifact.zip` },
    { Key: `${submission.id}/internal-notes.txt` },
  ];
  let originalBucket: string | undefined;
  let originalCleanBucket: string | undefined;
  let originalDmzBucket: string | undefined;
  let originalQuarantineBucket: string | undefined;
  let originalDownloadUrlExpiresInSeconds: string | undefined;

  beforeAll(() => {
    originalBucket = process.env.ARTIFACTS_S3_BUCKET;
    originalCleanBucket = process.env.SUBMISSION_CLEAN_S3_BUCKET;
    originalDmzBucket = process.env.SUBMISSION_DMZ_S3_BUCKET;
    originalQuarantineBucket = process.env.SUBMISSION_QUARANTINE_S3_BUCKET;
    originalDownloadUrlExpiresInSeconds =
      process.env.SUBMISSION_DOWNLOAD_URL_EXPIRES_IN_SECONDS;
  });

  beforeEach(() => {
    resourceApiService = {
      getMemberResourcesRoles: jest.fn().mockResolvedValue([]),
    };
    resourcePrisma = {
      resource: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    service = new SubmissionService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      resourceApiService as any,
      resourcePrisma as any,
      {} as any,
      {} as any,
      {} as any,
    );

    jest
      .spyOn(service as any, 'checkSubmission')
      .mockResolvedValue({ ...submission });

    s3Send = jest.fn().mockResolvedValue({
      Contents: s3Contents,
      IsTruncated: false,
    });
    jest.spyOn(service as any, 'getS3Client').mockReturnValue({
      send: s3Send,
    });

    process.env.ARTIFACTS_S3_BUCKET = 'unit-test-bucket';
    process.env.SUBMISSION_CLEAN_S3_BUCKET = 'unit-test-clean-bucket';
    process.env.SUBMISSION_DMZ_S3_BUCKET = 'unit-test-dmz-bucket';
    process.env.SUBMISSION_QUARANTINE_S3_BUCKET = 'unit-test-quarantine-bucket';
    delete process.env.SUBMISSION_DOWNLOAD_URL_EXPIRES_IN_SECONDS;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    if (originalBucket === undefined) {
      delete process.env.ARTIFACTS_S3_BUCKET;
    } else {
      process.env.ARTIFACTS_S3_BUCKET = originalBucket;
    }
    if (originalCleanBucket === undefined) {
      delete process.env.SUBMISSION_CLEAN_S3_BUCKET;
    } else {
      process.env.SUBMISSION_CLEAN_S3_BUCKET = originalCleanBucket;
    }
    if (originalDmzBucket === undefined) {
      delete process.env.SUBMISSION_DMZ_S3_BUCKET;
    } else {
      process.env.SUBMISSION_DMZ_S3_BUCKET = originalDmzBucket;
    }
    if (originalQuarantineBucket === undefined) {
      delete process.env.SUBMISSION_QUARANTINE_S3_BUCKET;
    } else {
      process.env.SUBMISSION_QUARANTINE_S3_BUCKET = originalQuarantineBucket;
    }
    if (originalDownloadUrlExpiresInSeconds === undefined) {
      delete process.env.SUBMISSION_DOWNLOAD_URL_EXPIRES_IN_SECONDS;
    } else {
      process.env.SUBMISSION_DOWNLOAD_URL_EXPIRES_IN_SECONDS =
        originalDownloadUrlExpiresInSeconds;
    }
  });

  describe('stripSubmitterSubmissionDetails', () => {
    it('continues sanitizing later challenges after a reviewer-visible row', () => {
      const submissions = [
        {
          id: 'reviewer-visible',
          challengeId: 'reviewer-challenge',
          memberId: 'other-member',
          url: 'https://example.com/reviewer.zip',
          review: [
            {
              reviewItems: [{ id: 'item-1' }],
              initialScore: 90,
              finalScore: 92,
            },
          ],
        },
        {
          id: 'must-be-sanitized',
          challengeId: 'unprivileged-challenge',
          memberId: 'other-member',
          url: 'https://example.com/private.zip',
          initialScore: 80,
          finalScore: 81,
          aiDecisionScore: 0.9,
          aiDecisionStatus: 'PASS',
          reviewSummation: { aggregateScore: 81 },
          review: [
            {
              reviewItems: [{ id: 'item-2' }],
              initialScore: 80,
              finalScore: 81,
            },
          ],
        },
      ];
      const reviewerSummary = {
        hasCopilot: false,
        hasManager: false,
        hasReviewer: true,
        hasSubmitter: false,
        reviewerResourceIds: [],
      };
      const noAccessSummary = {
        hasCopilot: false,
        hasManager: false,
        hasReviewer: false,
        hasSubmitter: false,
        reviewerResourceIds: [],
      };

      (service as any).stripSubmitterSubmissionDetails(
        {
          userId: 'requester',
          roles: [UserRole.User],
          isMachine: false,
        },
        submissions,
        {
          requesterUserId: 'requester',
          roleSummaryByChallenge: new Map([
            ['reviewer-challenge', reviewerSummary],
            ['unprivileged-challenge', noAccessSummary],
          ]),
          challengeDetailsById: new Map([
            [
              'reviewer-challenge',
              { status: ChallengeStatus.ACTIVE, type: 'Challenge' },
            ],
            [
              'unprivileged-challenge',
              { status: ChallengeStatus.ACTIVE, type: 'Challenge' },
            ],
          ]),
        },
      );

      expect(submissions[0].url).toBe('https://example.com/reviewer.zip');
      expect(submissions[0].review[0].reviewItems).toEqual([{ id: 'item-1' }]);
      expect(submissions[1].url).toBeNull();
      expect(submissions[1].review[0].reviewItems).toBeUndefined();
      expect(submissions[1].review[0].initialScore).toBeNull();
      expect(submissions[1].review[0].finalScore).toBeNull();
      expect(submissions[1]).not.toHaveProperty('reviewSummation');
      expect(submissions[1]).not.toHaveProperty('initialScore');
      expect(submissions[1]).not.toHaveProperty('finalScore');
      expect(submissions[1]).not.toHaveProperty('aiDecisionScore');
      expect(submissions[1]).not.toHaveProperty('aiDecisionStatus');
    });
  });

  describe('retryStaleSubmissionScanRequests', () => {
    const createRetryService = (
      submissions: Array<{
        id: string;
        challengeId: string;
        systemFileName: string | null;
        url: string;
      }>,
      activeChallengeIds = ['challenge-active'],
    ) => {
      const prisma = {
        submission: {
          findMany: jest.fn().mockResolvedValue(submissions),
        },
      };
      const challengePrisma = {
        $queryRaw: jest
          .fn()
          .mockResolvedValue(activeChallengeIds.map((id) => ({ id }))),
      };
      const eventBusService = {
        publish: jest.fn().mockResolvedValue(undefined),
      };
      const retryService = new SubmissionService(
        prisma as any,
        {} as any,
        challengePrisma as any,
        {} as any,
        {} as any,
        {} as any,
        eventBusService as any,
        {} as any,
        {} as any,
      );
      const headObjectSend = jest.fn().mockResolvedValue({});
      jest.spyOn(retryService as any, 'getS3Client').mockReturnValue({
        send: headObjectSend,
      });

      return {
        challengePrisma,
        eventBusService,
        headObjectSend,
        prisma,
        retryService,
      };
    };

    it('retries stale unscanned submissions for active challenges when the file is still in DMZ', async () => {
      const submissionUrl =
        'https://s3.amazonaws.com/unit-test-dmz-bucket/manual/challenge/member/solution.zip';
      const { eventBusService, headObjectSend, prisma, retryService } =
        createRetryService([
          {
            id: 'submission-retry',
            challengeId: 'challenge-active',
            systemFileName: 'solution.zip',
            url: submissionUrl,
          },
        ]);

      const result = await retryService.retryStaleSubmissionScanRequests({
        limit: 5,
        now: new Date('2026-06-15T00:20:00.000Z'),
      });

      expect(prisma.submission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            challengeId: { in: ['challenge-active'] },
            createdAt: { lte: new Date('2026-06-15T00:10:00.000Z') },
            isFileSubmission: true,
            status: SubmissionStatus.ACTIVE,
            url: { not: null },
            virusScan: false,
          }),
          take: 5,
        }),
      );
      expect(headObjectSend).toHaveBeenCalledTimes(1);
      expect(eventBusService.publish).toHaveBeenCalledWith(
        'avscan.action.scan',
        {
          callbackKafkaTopic: 'submission.scan.complete',
          callbackOption: 'kafka',
          cleanDestinationBucket: 'unit-test-clean-bucket',
          fileName: 'solution.zip',
          moveFile: true,
          quarantineDestinationBucket: 'unit-test-quarantine-bucket',
          submissionId: 'submission-retry',
          url: submissionUrl,
        },
      );
      expect(result).toEqual({
        candidates: 1,
        failed: 0,
        retried: 1,
        skipped: 0,
      });
    });

    it('skips retry when the submission file is not verified in DMZ', async () => {
      const { eventBusService, headObjectSend, retryService } =
        createRetryService([
          {
            id: 'submission-clean',
            challengeId: 'challenge-active',
            systemFileName: 'clean.zip',
            url: 'https://s3.amazonaws.com/unit-test-clean-bucket/manual/clean.zip',
          },
          {
            id: 'submission-quarantine',
            challengeId: 'challenge-active',
            systemFileName: 'quarantine.zip',
            url: 'https://s3.amazonaws.com/unit-test-quarantine-bucket/manual/quarantine.zip',
          },
          {
            id: 'submission-missing',
            challengeId: 'challenge-active',
            systemFileName: 'missing.zip',
            url: 'https://s3.amazonaws.com/unit-test-dmz-bucket/manual/missing.zip',
          },
        ]);
      headObjectSend.mockRejectedValueOnce(new Error('NotFound'));

      const result = await retryService.retryStaleSubmissionScanRequests({
        now: new Date('2026-06-15T00:20:00.000Z'),
      });

      expect(headObjectSend).toHaveBeenCalledTimes(1);
      expect(eventBusService.publish).not.toHaveBeenCalled();
      expect(result).toEqual({
        candidates: 3,
        failed: 0,
        retried: 0,
        skipped: 3,
      });
    });
  });

  describe('createValidationSubmissionUpload', () => {
    const createValidationService = () => {
      const prisma = {
        submission: {
          create: jest.fn(),
        },
      };
      const prismaErrorService = {
        handleError: jest.fn(),
      };
      const challengeApiService = {
        validateChallengeExists: jest.fn(),
      };
      const validationResourceApiService = {
        getMemberResourcesRoles: jest.fn(),
        validateSubmitterRegistration: jest.fn(),
      };
      const challengeCatalogService = {
        ensureSubmissionTypeAllowed: jest.fn(),
      };
      const validationService = new SubmissionService(
        prisma as any,
        prismaErrorService as any,
        {} as any,
        challengeApiService as any,
        validationResourceApiService as any,
        {} as any,
        {} as any,
        challengeCatalogService as any,
        {} as any,
      );

      return {
        challengeApiService,
        challengeCatalogService,
        prisma,
        validationResourceApiService,
        validationService,
      };
    };

    it('creates a clean active validation submission without submitter registration checks', async () => {
      const {
        challengeApiService,
        challengeCatalogService,
        prisma,
        validationResourceApiService,
        validationService,
      } = createValidationService();
      const submittedDate = new Date('2026-06-01T00:00:00.000Z');

      challengeApiService.validateChallengeExists.mockResolvedValue({
        id: 'challenge-abc',
        track: 'DATA_SCIENCE',
        type: 'Marathon Match',
      });
      jest
        .spyOn(
          validationService as any,
          'uploadValidationSubmissionFileToClean',
        )
        .mockResolvedValue({
          fileName: 'solution.zip',
          fileSize: 12,
          fileType: 'zip',
          url: 'https://s3.amazonaws.com/clean/validation/challenge-abc/member-1/solution.zip',
        });
      prisma.submission.create.mockResolvedValue({
        challengeId: 'challenge-abc',
        createdBy: 'machine-token',
        eventRaised: true,
        fileSize: 12,
        fileType: 'zip',
        id: 'submission-1',
        isFileSubmission: true,
        memberId: 'member-1',
        status: SubmissionStatus.ACTIVE,
        submittedDate,
        systemFileName: 'solution.zip',
        type: SubmissionType.CONTEST_SUBMISSION,
        updatedBy: 'machine-token',
        url: 'https://s3.amazonaws.com/clean/validation/challenge-abc/member-1/solution.zip',
        viewCount: 0,
        virusScan: true,
      });

      const result = await validationService.createValidationSubmissionUpload(
        {
          isMachine: true,
          scopes: ['create:submission'],
        } as any,
        {
          challengeId: 'challenge-abc',
          memberId: 'member-1',
          submittedDate: submittedDate.toISOString(),
          type: SubmissionType.CONTEST_SUBMISSION,
        },
        {
          buffer: Buffer.from('zip'),
          mimetype: 'application/zip',
          originalname: 'solution.zip',
          size: 12,
        } as Express.Multer.File,
      );

      expect(result.id).toBe('submission-1');
      expect(challengeApiService.validateChallengeExists).toHaveBeenCalledWith(
        'challenge-abc',
      );
      expect(
        challengeCatalogService.ensureSubmissionTypeAllowed,
      ).toHaveBeenCalledWith(
        SubmissionType.CONTEST_SUBMISSION,
        expect.objectContaining({ id: 'challenge-abc' }),
      );
      expect(
        validationResourceApiService.validateSubmitterRegistration,
      ).not.toHaveBeenCalled();
      expect(prisma.submission.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          challengeId: 'challenge-abc',
          eventRaised: true,
          isFileSubmission: true,
          memberId: 'member-1',
          status: SubmissionStatus.ACTIVE,
          type: SubmissionType.CONTEST_SUBMISSION,
          virusScan: true,
        }),
      });
      expect(prisma.submission.create.mock.calls[0][0].data).not.toHaveProperty(
        'confirmationEmail',
      );
      expect(prisma.submission.create.mock.calls[0][0].data.sha256Hash).toBe(
        createHash('sha256').update(Buffer.from('zip')).digest('hex'),
      );
    });

    it('rejects validation upload requests without file contents', async () => {
      const { validationService } = createValidationService();

      await expect(
        validationService.createValidationSubmissionUpload(
          {
            isMachine: true,
            scopes: ['create:submission'],
          } as any,
          {
            challengeId: 'challenge-abc',
            memberId: 'member-1',
            type: SubmissionType.CONTEST_SUBMISSION,
          },
          {
            buffer: Buffer.alloc(0),
            originalname: 'solution.zip',
            size: 0,
          } as Express.Multer.File,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('listArtifacts', () => {
    it('filters internal artifacts for submission owners', async () => {
      const result = await service.listArtifacts(
        {
          userId: submission.memberId,
          isMachine: false,
          roles: [],
        } as any,
        submission.id,
      );

      expect(result.artifacts).toEqual(['regular-artifact']);
      expect(resourceApiService.getMemberResourcesRoles).not.toHaveBeenCalled();
    });

    it('returns all artifacts for admins', async () => {
      const result = await service.listArtifacts(
        {
          userId: 'admin-user',
          isMachine: false,
          roles: [UserRole.Admin],
        } as any,
        submission.id,
      );

      expect(result.artifacts).toEqual(['regular-artifact', 'internal-notes']);
      expect(resourceApiService.getMemberResourcesRoles).not.toHaveBeenCalled();
    });

    it('returns all artifacts for challenge copilots', async () => {
      resourceApiService.getMemberResourcesRoles.mockResolvedValue([
        { roleName: 'Copilot' },
      ]);

      const result = await service.listArtifacts(
        {
          userId: 'copilot-user',
          isMachine: false,
          roles: [],
        } as any,
        submission.id,
      );

      expect(resourceApiService.getMemberResourcesRoles).toHaveBeenCalledWith(
        submission.challengeId,
        'copilot-user',
      );
      expect(result.artifacts).toEqual(['regular-artifact', 'internal-notes']);
    });

    it('denies access when requester is neither owner, copilot, nor admin', async () => {
      resourceApiService.getMemberResourcesRoles.mockResolvedValue([
        { roleName: 'Observer' },
      ]);

      await expect(
        service.listArtifacts(
          {
            userId: 'unauthorized-user',
            isMachine: false,
            roles: [],
          } as any,
          submission.id,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(s3Send).not.toHaveBeenCalled();
    });
  });

  describe('getArtifactStream', () => {
    const listResponse = {
      Contents: [{ Key: `${submission.id}/regular-artifact.zip` }],
      IsTruncated: false,
    };
    const internalListResponse = {
      Contents: [{ Key: `${submission.id}/internal-notes.txt` }],
      IsTruncated: false,
    };

    beforeEach(() => {
      s3Send.mockReset();
    });

    it('allows submission owners to download non-internal artifacts', async () => {
      s3Send
        .mockResolvedValueOnce(listResponse)
        .mockResolvedValueOnce({
          ContentType: 'application/zip',
          Metadata: { originalfilename: 'regular-artifact.zip' },
        })
        .mockResolvedValueOnce({
          Body: Readable.from(['artifact-data']),
        });

      const result = await service.getArtifactStream(
        {
          userId: submission.memberId,
          isMachine: false,
          roles: [],
        } as any,
        submission.id,
        'regular-artifact',
      );

      expect(result.fileName).toBe('regular-artifact.zip');
      expect(s3Send).toHaveBeenCalledTimes(3);
    });

    it('prevents submission owners from downloading internal artifacts', async () => {
      await expect(
        service.getArtifactStream(
          {
            userId: submission.memberId,
            isMachine: false,
            roles: [],
          } as any,
          submission.id,
          'internal-notes',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(s3Send).not.toHaveBeenCalled();
    });

    it('allows admins to download internal artifacts', async () => {
      s3Send
        .mockResolvedValueOnce(internalListResponse)
        .mockResolvedValueOnce({
          ContentType: 'text/plain',
          Metadata: { originalfilename: 'internal-notes.txt' },
        })
        .mockResolvedValueOnce({
          Body: Readable.from(['secret-data']),
        });

      const result = await service.getArtifactStream(
        {
          userId: 'admin-user',
          isMachine: false,
          roles: [UserRole.Admin],
        } as any,
        submission.id,
        'internal-notes',
      );

      expect(result.fileName).toBe('internal-notes.txt');
      expect(s3Send).toHaveBeenCalledTimes(3);
    });

    it('allows challenge copilots to download internal artifacts', async () => {
      resourceApiService.getMemberResourcesRoles.mockResolvedValue([
        { roleName: 'Copilot' },
      ]);
      s3Send
        .mockResolvedValueOnce(internalListResponse)
        .mockResolvedValueOnce({
          ContentType: 'text/plain',
          Metadata: { originalfilename: 'internal-notes.txt' },
        })
        .mockResolvedValueOnce({
          Body: Readable.from(['copilot-data']),
        });

      const result = await service.getArtifactStream(
        {
          userId: 'copilot-user',
          isMachine: false,
          roles: [],
        } as any,
        submission.id,
        'internal-notes',
      );

      expect(resourceApiService.getMemberResourcesRoles).toHaveBeenCalledWith(
        submission.challengeId,
        'copilot-user',
      );
      expect(result.fileName).toBe('internal-notes.txt');
      expect(s3Send).toHaveBeenCalledTimes(3);
    });

    it('denies access when requester lacks required role', async () => {
      resourceApiService.getMemberResourcesRoles.mockResolvedValue([
        { roleName: 'Reviewer' },
      ]);

      await expect(
        service.getArtifactStream(
          {
            userId: 'unauthorized-user',
            isMachine: false,
            roles: [],
          } as any,
          submission.id,
          'regular-artifact',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(s3Send).not.toHaveBeenCalled();
    });
  });

  describe('getSubmissionDownloadUrl', () => {
    const signedUrl = 'https://signed.example/submission.zip';
    const getSignedUrlMock = getSignedUrl as jest.Mock;
    let prismaMock: {
      challengeResult: { findUnique: jest.Mock };
      reviewSummation: { findMany: jest.Mock };
      submission: { findFirst: jest.Mock; findMany: jest.Mock };
    };
    let challengeApiServiceMock: { getChallengeDetail: jest.Mock };
    let checkSubmissionSpy: jest.SpyInstance;
    let recordSubmissionDownloadSpy: jest.SpyInstance;
    let s3ClientMock: { send: jest.Mock };

    beforeEach(() => {
      prismaMock = {
        challengeResult: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
        reviewSummation: {
          findMany: jest.fn().mockResolvedValue([]),
        },
        submission: {
          findFirst: jest.fn(),
          findMany: jest.fn().mockResolvedValue([]),
        },
      };
      challengeApiServiceMock = {
        getChallengeDetail: jest.fn(),
      };
      resourceApiService = {
        getMemberResourcesRoles: jest.fn(),
      };
      resourcePrisma = {
        resource: {
          findMany: jest.fn().mockResolvedValue([]),
        },
      };
      service = new SubmissionService(
        prismaMock as any,
        {} as any,
        {} as any,
        challengeApiServiceMock as any,
        resourceApiService as any,
        resourcePrisma as any,
        {} as any,
        {} as any,
        {} as any,
      );
      checkSubmissionSpy = jest
        .spyOn(service as any, 'checkSubmission')
        .mockResolvedValue({
          id: 'sub-123',
          memberId: 'owner-user',
          challengeId: 'challenge-xyz',
          type: SubmissionType.CONTEST_SUBMISSION,
          status: SubmissionStatus.ACTIVE,
          placement: null,
          url: 'https://s3.amazonaws.com/dummy/submission.zip',
        });
      jest
        .spyOn(service as any, 'parseS3Url')
        .mockReturnValue({ key: 'dummy/submission.zip' });
      recordSubmissionDownloadSpy = jest
        .spyOn(service as any, 'recordSubmissionDownload')
        .mockResolvedValue(undefined);
      getSignedUrlMock.mockReset().mockResolvedValue(signedUrl);
      s3Send = jest.fn().mockResolvedValue({ ContentType: 'application/zip' });
      s3ClientMock = { send: s3Send };
      jest.spyOn(service as any, 'getS3Client').mockReturnValue(s3ClientMock);
    });

    it('allows screeners to download submissions', async () => {
      resourceApiService.getMemberResourcesRoles.mockResolvedValue([
        { roleName: 'Screener' },
      ]);

      const result = await service.getSubmissionDownloadUrl(
        {
          userId: 'screener-user',
          isMachine: false,
          roles: [],
        } as any,
        'sub-123',
      );

      expect(result).toBe(signedUrl);
      expect(resourceApiService.getMemberResourcesRoles).toHaveBeenCalledWith(
        'challenge-xyz',
        'screener-user',
      );
    });

    it('allows checkpoint screeners to download checkpoint submissions', async () => {
      checkSubmissionSpy.mockResolvedValueOnce({
        id: 'checkpoint-sub-123',
        memberId: 'owner-user',
        challengeId: 'challenge-xyz',
        url: 'https://s3.amazonaws.com/dummy/checkpoint.zip',
        type: SubmissionType.CHECKPOINT_SUBMISSION,
      });
      resourceApiService.getMemberResourcesRoles.mockResolvedValue([
        { roleName: 'Checkpoint Screener' },
      ]);

      const result = await service.getSubmissionDownloadUrl(
        {
          userId: 'checkpoint-screener-user',
          isMachine: false,
          roles: [],
        } as any,
        'checkpoint-sub-123',
      );

      expect(result).toBe(signedUrl);
      expect(resourceApiService.getMemberResourcesRoles).toHaveBeenCalledWith(
        'challenge-xyz',
        'checkpoint-screener-user',
      );
    });

    it('preserves submission-owner access outside the registered-Submitter winner gate', async () => {
      challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
        status: ChallengeStatus.COMPLETED,
        metadata: {
          allowAllRegistrantsToDownloadWinningSubmissions: 'true',
        },
        winners: [{ userId: 'different-owner', placement: 1 }],
      });

      const result = await service.getSubmissionDownloadUrl(
        {
          userId: 'owner-user',
          isMachine: false,
          roles: [],
        } as any,
        'sub-123',
      );

      expect(result).toBe(signedUrl);
      expect(resourceApiService.getMemberResourcesRoles).not.toHaveBeenCalled();
      expect(challengeApiServiceMock.getChallengeDetail).not.toHaveBeenCalled();
      expect(prismaMock.challengeResult.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.submission.findFirst).not.toHaveBeenCalled();
      expect(s3Send).toHaveBeenCalledTimes(1);
    });

    it('signs a clean-bucket GetObject without proxying the file through the API', async () => {
      const authUser = {
        userId: 'owner-user',
        isMachine: false,
        roles: [],
      } as any;

      const result = await service.getSubmissionDownloadUrl(
        authUser,
        'sub-123',
      );

      expect(result).toBe(signedUrl);
      expect(s3Send).toHaveBeenCalledTimes(1);
      expect(s3Send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand);
      expect(s3Send.mock.calls[0][0].input).toEqual({
        Bucket: 'unit-test-clean-bucket',
        Key: 'dummy/submission.zip',
      });
      expect(getSignedUrlMock).toHaveBeenCalledTimes(1);
      const [signedClient, signedCommand, signedOptions] =
        getSignedUrlMock.mock.calls[0];
      expect(signedClient).toBe(s3ClientMock);
      expect(signedCommand).toBeInstanceOf(GetObjectCommand);
      expect(signedCommand.input).toEqual({
        Bucket: 'unit-test-clean-bucket',
        Key: 'dummy/submission.zip',
        ResponseContentDisposition:
          'attachment; filename="submission-sub-123.zip"',
        ResponseContentType: 'application/zip',
        ResponseCacheControl: 'private, no-store',
      });
      expect(signedOptions).toEqual({ expiresIn: 300 });
      expect(recordSubmissionDownloadSpy).toHaveBeenCalledWith(
        'sub-123',
        authUser,
      );
      expect(getSignedUrlMock.mock.invocationCallOrder[0]).toBeLessThan(
        recordSubmissionDownloadSpy.mock.invocationCallOrder[0],
      );
    });

    it('uses a configured signed URL lifetime within the allowed range', async () => {
      process.env.SUBMISSION_DOWNLOAD_URL_EXPIRES_IN_SECONDS = '120';

      await service.getSubmissionDownloadUrl(
        {
          userId: 'owner-user',
          isMachine: false,
          roles: [],
        } as any,
        'sub-123',
      );

      expect(getSignedUrlMock.mock.calls[0][2]).toEqual({ expiresIn: 120 });
    });

    it('falls back to five minutes for an unsafe signed URL lifetime', async () => {
      process.env.SUBMISSION_DOWNLOAD_URL_EXPIRES_IN_SECONDS = '301';

      await service.getSubmissionDownloadUrl(
        {
          userId: 'owner-user',
          isMachine: false,
          roles: [],
        } as any,
        'sub-123',
      );

      expect(getSignedUrlMock.mock.calls[0][2]).toEqual({ expiresIn: 300 });
    });

    it('uses the ZIP content type when clean object metadata omits it', async () => {
      s3Send.mockResolvedValueOnce({});

      await service.getSubmissionDownloadUrl(
        {
          userId: 'owner-user',
          isMachine: false,
          roles: [],
        } as any,
        'sub-123',
      );

      expect(getSignedUrlMock.mock.calls[0][1].input).toEqual(
        expect.objectContaining({ ResponseContentType: 'application/zip' }),
      );
    });

    it('sanitizes the submission ID used in the attachment filename', async () => {
      checkSubmissionSpy.mockResolvedValueOnce({
        id: 'sub"\r\nunsafe',
        memberId: 'owner-user',
        challengeId: 'challenge-xyz',
        type: SubmissionType.CONTEST_SUBMISSION,
        status: SubmissionStatus.ACTIVE,
        placement: null,
        url: 'https://s3.amazonaws.com/dummy/submission.zip',
      });

      await service.getSubmissionDownloadUrl(
        {
          userId: 'owner-user',
          isMachine: false,
          roles: [],
        } as any,
        'sub-123',
      );

      expect(getSignedUrlMock.mock.calls[0][1].input).toEqual(
        expect.objectContaining({
          ResponseContentDisposition:
            'attachment; filename="submission-sub___unsafe.zip"',
        }),
      );
    });

    it('does not audit or sign when the clean object cannot be found', async () => {
      s3Send.mockRejectedValueOnce(new Error('missing object'));

      await expect(
        service.getSubmissionDownloadUrl(
          {
            userId: 'owner-user',
            isMachine: false,
            roles: [],
          } as any,
          'sub-123',
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'SUBMISSION_NOT_CLEAN' }),
      });

      expect(getSignedUrlMock).not.toHaveBeenCalled();
      expect(recordSubmissionDownloadSpy).not.toHaveBeenCalled();
    });

    it('does not audit when signing the download URL fails', async () => {
      getSignedUrlMock.mockRejectedValueOnce(new Error('signing failed'));

      await expect(
        service.getSubmissionDownloadUrl(
          {
            userId: 'owner-user',
            isMachine: false,
            roles: [],
          } as any,
          'sub-123',
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'S3_DOWNLOAD_URL_FAILED' }),
      });

      expect(recordSubmissionDownloadSpy).not.toHaveBeenCalled();
    });

    it('returns the signed URL when access auditing fails', async () => {
      recordSubmissionDownloadSpy.mockRejectedValueOnce(
        new Error('audit unavailable'),
      );

      const result = await service.getSubmissionDownloadUrl(
        {
          userId: 'owner-user',
          isMachine: false,
          roles: [],
        } as any,
        'sub-123',
      );

      expect(result).toBe(signedUrl);
      expect(recordSubmissionDownloadSpy).toHaveBeenCalledTimes(1);
    });

    it('preserves legacy passing-submitter download behavior when the feature flag is disabled', async () => {
      resourceApiService.getMemberResourcesRoles.mockResolvedValue([
        { roleName: 'Submitter' },
      ]);
      challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
        status: ChallengeStatus.COMPLETED,
        type: 'Something Else',
        metadata: {
          allowAllRegistrantsToDownloadWinningSubmissions: 'false',
        },
      });
      prismaMock.submission.findFirst.mockResolvedValue({
        id: 'passing-sub',
      });

      const result = await service.getSubmissionDownloadUrl(
        {
          userId: 'submitter-user',
          isMachine: false,
          roles: [],
        } as any,
        'sub-123',
      );

      expect(result).toBe(signedUrl);
      expect(resourceApiService.getMemberResourcesRoles).toHaveBeenCalledWith(
        'challenge-xyz',
        'submitter-user',
      );
      expect(challengeApiServiceMock.getChallengeDetail).toHaveBeenCalledWith(
        'challenge-xyz',
      );
      expect(prismaMock.submission.findFirst).toHaveBeenCalledWith({
        where: {
          challengeId: 'challenge-xyz',
          memberId: 'submitter-user',
          reviewSummation: {
            some: {
              isPassing: true,
            },
          },
        },
        select: { id: true },
      });
      expect(s3Send).toHaveBeenCalledTimes(1);
    });

    it('uses an adjusted passing Review score when the stored summation is stale', async () => {
      resourceApiService.getMemberResourcesRoles.mockResolvedValue([
        { roleName: 'Submitter' },
      ]);
      challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
        status: ChallengeStatus.COMPLETED,
        track: 'Design',
        metadata: {
          submissionsViewable: 'true',
        },
        winners: [{ userId: 'owner-user', placement: 1 }],
      });
      prismaMock.submission.findFirst.mockResolvedValue(null);
      prismaMock.reviewSummation.findMany.mockResolvedValue([
        {
          scorecardId: 'review-scorecard',
          updatedAt: new Date('2026-07-24T07:18:53.107Z'),
          submission: {
            review: [
              {
                scorecardId: 'review-scorecard',
                initialScore: 68.13,
                finalScore: 76.13,
                updatedAt: new Date('2026-07-24T07:20:20.000Z'),
                scorecard: {
                  minScore: 75,
                  minimumPassingScore: 75,
                },
              },
            ],
          },
        },
      ]);

      const result = await service.getSubmissionDownloadUrl(
        {
          userId: 'passing-submitter',
          isMachine: false,
          roles: [],
        } as any,
        'sub-123',
      );

      expect(result).toBe(signedUrl);
      expect(prismaMock.reviewSummation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isFinal: true,
            isPassing: false,
            submission: {
              challengeId: 'challenge-xyz',
              memberId: 'passing-submitter',
            },
          }),
        }),
      );
      expect(s3Send).toHaveBeenCalledTimes(1);
    });

    it('denies a stale summation when the adjusted Review average is below the passing score', async () => {
      resourceApiService.getMemberResourcesRoles.mockResolvedValue([
        { roleName: 'Submitter' },
      ]);
      challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
        status: ChallengeStatus.COMPLETED,
        track: 'Design',
        metadata: {
          submissionsViewable: 'true',
        },
        winners: [{ userId: 'owner-user', placement: 1 }],
      });
      prismaMock.submission.findFirst.mockResolvedValue(null);
      prismaMock.reviewSummation.findMany.mockResolvedValue([
        {
          scorecardId: 'review-scorecard',
          updatedAt: new Date('2026-07-24T07:18:53.107Z'),
          submission: {
            review: [
              {
                scorecardId: 'review-scorecard',
                initialScore: 80,
                finalScore: 80,
                updatedAt: new Date('2026-07-24T07:20:20.000Z'),
                scorecard: {
                  minScore: 75,
                  minimumPassingScore: 75,
                },
              },
              {
                scorecardId: 'review-scorecard',
                initialScore: 60,
                finalScore: 60,
                updatedAt: new Date('2026-07-24T07:20:21.000Z'),
                scorecard: {
                  minScore: 75,
                  minimumPassingScore: 75,
                },
              },
            ],
          },
        },
      ]);

      await expect(
        service.getSubmissionDownloadUrl(
          {
            userId: 'non-passing-submitter',
            isMachine: false,
            roles: [],
          } as any,
          'sub-123',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(s3Send).not.toHaveBeenCalled();
    });

    it('matches the exact canonical winner across duplicate owner placements despite completed-without-win status', async () => {
      checkSubmissionSpy.mockResolvedValueOnce({
        id: 'winning-submission',
        memberId: '4242',
        challengeId: 'challenge-xyz',
        type: SubmissionType.CONTEST_SUBMISSION,
        status: SubmissionStatus.COMPLETED_WITHOUT_WIN,
        placement: null,
        url: 'https://s3.amazonaws.com/dummy/winning-submission.zip',
      });
      resourceApiService.getMemberResourcesRoles.mockResolvedValue([
        {
          roleName: '',
          roleId: CommonConfig.roles.submitterRoleId,
        },
      ]);
      challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
        status: ChallengeStatus.COMPLETED,
        track: 'Development',
        metadata: {
          allowAllRegistrantsToDownloadWinningSubmissions: 'true',
        },
        winners: [
          { userId: 4242, placement: 2, type: 'PLACEMENT' },
          { userId: 4242, placement: 1, type: 'PLACEMENT' },
        ],
      });
      prismaMock.challengeResult.findUnique.mockResolvedValue({
        submissionId: 'winning-submission',
        userId: '4242',
        placement: 1,
      });

      const result = await service.getSubmissionDownloadUrl(
        {
          userId: 'registered-user-without-submission',
          isMachine: false,
          roles: [],
        } as any,
        'winning-submission',
      );

      expect(result).toBe(signedUrl);
      expect(prismaMock.challengeResult.findUnique).toHaveBeenCalledWith({
        where: {
          challengeId_userId: {
            challengeId: 'challenge-xyz',
            userId: '4242',
          },
        },
        select: {
          submissionId: true,
          userId: true,
          placement: true,
        },
      });
      expect(prismaMock.submission.findFirst).not.toHaveBeenCalled();
      expect(s3Send).toHaveBeenCalledTimes(1);
    });

    it('denies a passing winner access to a canonical sibling submission when the feature flag is enabled', async () => {
      checkSubmissionSpy.mockResolvedValueOnce({
        id: 'same-owner-sibling-submission',
        memberId: 'owner-user',
        challengeId: 'challenge-xyz',
        type: SubmissionType.CONTEST_SUBMISSION,
        status: SubmissionStatus.ACTIVE,
        placement: null,
        url: 'https://s3.amazonaws.com/dummy/sibling.zip',
      });
      resourceApiService.getMemberResourcesRoles.mockResolvedValue([
        { roleName: 'Submitter' },
      ]);
      challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
        status: ChallengeStatus.COMPLETED,
        track: 'Development',
        metadata: {
          allowAllRegistrantsToDownloadWinningSubmissions: 'true',
        },
        winners: [
          { userId: 'owner-user', placement: 1, type: 'PLACEMENT' },
          {
            userId: 'passing-winner-requester',
            placement: 2,
            type: 'PLACEMENT',
          },
        ],
      });
      prismaMock.challengeResult.findUnique.mockResolvedValue({
        submissionId: 'actual-winning-submission',
        userId: 'owner-user',
        placement: 1,
      });
      prismaMock.submission.findFirst.mockResolvedValue({
        id: 'requester-passing-submission',
      });

      await expect(
        service.getSubmissionDownloadUrl(
          {
            userId: 'passing-winner-requester',
            isMachine: false,
            roles: [],
          } as any,
          'same-owner-sibling-submission',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(prismaMock.challengeResult.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            challengeId_userId: {
              challengeId: 'challenge-xyz',
              userId: 'owner-user',
            },
          },
        }),
      );
      expect(prismaMock.submission.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.submission.findMany).not.toHaveBeenCalled();
      expect(s3Send).not.toHaveBeenCalled();
    });

    it('does not expand enabled access to a non-contest submission owned by a placement winner', async () => {
      checkSubmissionSpy.mockResolvedValueOnce({
        id: 'winner-checkpoint',
        memberId: 'owner-user',
        challengeId: 'challenge-xyz',
        type: SubmissionType.CHECKPOINT_SUBMISSION,
        status: SubmissionStatus.ACTIVE,
        placement: 1,
        url: 'https://s3.amazonaws.com/dummy/checkpoint.zip',
      });
      resourceApiService.getMemberResourcesRoles.mockResolvedValue([
        { roleName: 'Submitter' },
      ]);
      challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
        status: ChallengeStatus.COMPLETED,
        track: 'Design',
        metadata: {
          submissionsViewable: 'true',
          allowAllRegistrantsToDownloadWinningSubmissions: 'true',
        },
        winners: [{ userId: 'owner-user', placement: 1, type: 'PLACEMENT' }],
      });
      prismaMock.challengeResult.findUnique.mockResolvedValue({
        submissionId: 'winner-checkpoint',
        userId: 'owner-user',
        placement: 1,
      });
      prismaMock.submission.findFirst.mockResolvedValue(null);

      await expect(
        service.getSubmissionDownloadUrl(
          {
            userId: 'registered-user-without-passing-submission',
            isMachine: false,
            roles: [],
          } as any,
          'winner-checkpoint',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(prismaMock.challengeResult.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.submission.findMany).not.toHaveBeenCalled();
      expect(s3Send).not.toHaveBeenCalled();
    });

    it.each([
      SubmissionStatus.FAILED_REVIEW,
      SubmissionStatus.COMPLETED_WITHOUT_WIN,
    ])(
      'does not accept an exact legacy placement for a %s submission',
      async (nonWinningStatus) => {
        const requestedSubmissionId = `non-winning-${nonWinningStatus.toLowerCase()}`;
        checkSubmissionSpy.mockResolvedValueOnce({
          id: requestedSubmissionId,
          memberId: 'owner-user',
          challengeId: 'challenge-xyz',
          type: SubmissionType.CONTEST_SUBMISSION,
          status: nonWinningStatus,
          placement: 1,
          url: 'https://s3.amazonaws.com/dummy/non-winner.zip',
        });
        resourceApiService.getMemberResourcesRoles.mockResolvedValue([
          { roleName: 'Submitter' },
        ]);
        challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
          status: ChallengeStatus.COMPLETED,
          track: 'Development',
          metadata: {
            allowAllRegistrantsToDownloadWinningSubmissions: 'true',
          },
          winners: [{ userId: 'owner-user', placement: 1, type: 'PLACEMENT' }],
        });
        prismaMock.submission.findFirst.mockResolvedValue(null);

        await expect(
          service.getSubmissionDownloadUrl(
            {
              userId: 'registered-user-without-passing-submission',
              isMachine: false,
              roles: [],
            } as any,
            requestedSubmissionId,
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);

        expect(prismaMock.challengeResult.findUnique).toHaveBeenCalledTimes(1);
        expect(prismaMock.submission.findMany).not.toHaveBeenCalled();
        expect(s3Send).not.toHaveBeenCalled();
      },
    );

    it('supports an exact legacy placement when no canonical challenge result exists', async () => {
      checkSubmissionSpy.mockResolvedValueOnce({
        id: 'legacy-winning-submission',
        memberId: 'owner-user',
        challengeId: 'challenge-xyz',
        type: SubmissionType.CONTEST_SUBMISSION,
        status: SubmissionStatus.ACTIVE,
        placement: 1,
        url: 'https://s3.amazonaws.com/dummy/legacy-winner.zip',
      });
      resourceApiService.getMemberResourcesRoles.mockResolvedValue([
        { roleName: 'Submitter' },
      ]);
      challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
        status: ChallengeStatus.COMPLETED,
        track: 'Development',
        metadata: {
          allowAllRegistrantsToDownloadWinningSubmissions: 'true',
        },
        winners: [{ userId: 'owner-user', placement: 1, type: 'PLACEMENT' }],
      });

      const result = await service.getSubmissionDownloadUrl(
        {
          userId: 'registered-user',
          isMachine: false,
          roles: [],
        } as any,
        'legacy-winning-submission',
      );

      expect(result).toBe(signedUrl);
      expect(prismaMock.challengeResult.findUnique).toHaveBeenCalledTimes(1);
      expect(prismaMock.submission.findMany).not.toHaveBeenCalled();
      expect(s3Send).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['First2Finish', { type: 'First2Finish' }, undefined],
      [
        'limited submissions',
        { track: 'Development' },
        '{"limit":true,"count":1}',
      ],
      ['unlimited submissions', { track: 'Development' }, '{"unlimited":true}'],
    ])(
      'fails closed without canonical result or legacy placement for %s winner selection',
      async (_description, challengeOverrides, submissionLimit) => {
        checkSubmissionSpy.mockResolvedValueOnce({
          id: 'winner-owned-submission-without-exact-evidence',
          memberId: 'owner-user',
          challengeId: 'challenge-xyz',
          type: SubmissionType.CONTEST_SUBMISSION,
          status: SubmissionStatus.ACTIVE,
          placement: null,
          url: 'https://s3.amazonaws.com/dummy/unverified-winner.zip',
        });
        resourceApiService.getMemberResourcesRoles.mockResolvedValue([
          { roleName: 'Submitter' },
        ]);
        challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
          status: ChallengeStatus.COMPLETED,
          metadata: {
            allowAllRegistrantsToDownloadWinningSubmissions: 'true',
            ...(submissionLimit ? { submissionLimit } : {}),
          },
          winners: [{ userId: 'owner-user', placement: 1, type: 'PLACEMENT' }],
          ...challengeOverrides,
        });
        prismaMock.submission.findFirst.mockResolvedValue(null);

        await expect(
          service.getSubmissionDownloadUrl(
            {
              userId: 'registered-user-without-legacy-eligibility',
              isMachine: false,
              roles: [],
            } as any,
            'winner-owned-submission-without-exact-evidence',
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);

        expect(prismaMock.challengeResult.findUnique).toHaveBeenCalledTimes(1);
        expect(prismaMock.submission.findMany).not.toHaveBeenCalled();
        expect(s3Send).not.toHaveBeenCalled();
      },
    );

    it('denies a passing winner access to a failed non-winning submission when the feature flag is enabled', async () => {
      checkSubmissionSpy.mockResolvedValueOnce({
        id: 'failed-non-winning-submission',
        memberId: 'failed-submitter',
        challengeId: 'challenge-xyz',
        type: SubmissionType.CONTEST_SUBMISSION,
        status: SubmissionStatus.FAILED_REVIEW,
        placement: null,
        url: 'https://s3.amazonaws.com/dummy/failed-non-winner.zip',
      });
      resourceApiService.getMemberResourcesRoles.mockResolvedValue([
        { roleName: 'Submitter' },
      ]);
      challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
        status: ChallengeStatus.COMPLETED,
        track: 'Development',
        metadata: {
          allowAllRegistrantsToDownloadWinningSubmissions: 'true',
        },
        winners: [
          {
            userId: 'passing-winner-requester',
            placement: 1,
            type: 'PLACEMENT',
          },
        ],
      });
      prismaMock.submission.findFirst.mockResolvedValue({
        id: 'requester-passing-submission',
      });

      await expect(
        service.getSubmissionDownloadUrl(
          {
            userId: 'passing-winner-requester',
            isMachine: false,
            roles: [],
          } as any,
          'failed-non-winning-submission',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(prismaMock.challengeResult.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.submission.findFirst).not.toHaveBeenCalled();
      expect(s3Send).not.toHaveBeenCalled();
    });

    it('preserves legacy passing-submitter target scope when the feature flag is disabled', async () => {
      resourceApiService.getMemberResourcesRoles.mockResolvedValue([
        { roleName: 'Submitter' },
      ]);
      challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
        status: ChallengeStatus.COMPLETED,
        track: 'Development',
        metadata: {
          allowAllRegistrantsToDownloadWinningSubmissions: 'false',
        },
        winners: [{ userId: 'different-owner', placement: 1 }],
      });
      prismaMock.submission.findFirst.mockResolvedValue({
        id: 'requester-passing-submission',
      });

      const result = await service.getSubmissionDownloadUrl(
        {
          userId: 'passing-registered-user',
          isMachine: false,
          roles: [],
        } as any,
        'sub-123',
      );

      expect(result).toBe(signedUrl);
      expect(prismaMock.challengeResult.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.submission.findFirst).toHaveBeenCalledWith({
        where: {
          challengeId: 'challenge-xyz',
          memberId: 'passing-registered-user',
          reviewSummation: { some: { isPassing: true } },
        },
        select: { id: true },
      });
      expect(s3Send).toHaveBeenCalledTimes(1);
    });

    it('does not treat a checkpoint winner as a final winning submission', async () => {
      resourceApiService.getMemberResourcesRoles.mockResolvedValue([
        { roleName: 'Submitter' },
      ]);
      challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
        status: ChallengeStatus.COMPLETED,
        track: 'Design',
        metadata: {
          submissionsViewable: 'true',
          allowAllRegistrantsToDownloadWinningSubmissions: 'true',
        },
        winners: [{ userId: 'owner-user', placement: 1, type: 'CHECKPOINT' }],
      });
      prismaMock.submission.findFirst.mockResolvedValue(null);

      await expect(
        service.getSubmissionDownloadUrl(
          {
            userId: 'registered-user-without-passing-submission',
            isMachine: false,
            roles: [],
          } as any,
          'sub-123',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(prismaMock.submission.findFirst).not.toHaveBeenCalled();
      expect(s3Send).not.toHaveBeenCalled();
    });

    it.each([
      ['missing', undefined],
      ['false', 'false'],
      ['differently-cased', 'TRUE'],
      ['non-string', true],
    ])(
      'does not enable all-registrant access when the feature flag is %s',
      async (_description, metadataValue) => {
        resourceApiService.getMemberResourcesRoles.mockResolvedValue([
          { roleName: 'Submitter' },
        ]);
        challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
          status: ChallengeStatus.COMPLETED,
          track: 'Development',
          metadata: {
            allowAllRegistrantsToDownloadWinningSubmissions: metadataValue,
          },
          winners: [{ userId: 'owner-user', placement: 1 }],
        });
        prismaMock.submission.findFirst.mockResolvedValue(null);

        await expect(
          service.getSubmissionDownloadUrl(
            {
              userId: 'registered-user-without-passing-submission',
              isMachine: false,
              roles: [],
            } as any,
            'sub-123',
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);

        expect(prismaMock.challengeResult.findUnique).not.toHaveBeenCalled();
        expect(prismaMock.submission.findFirst).toHaveBeenCalledTimes(1);
        expect(s3Send).not.toHaveBeenCalled();
      },
    );

    it('does not grant enabled winner access without a Submitter resource role', async () => {
      resourceApiService.getMemberResourcesRoles.mockResolvedValue([
        { roleName: 'Observer' },
      ]);

      await expect(
        service.getSubmissionDownloadUrl(
          {
            userId: 'unregistered-user',
            isMachine: false,
            roles: [],
          } as any,
          'sub-123',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(challengeApiServiceMock.getChallengeDetail).not.toHaveBeenCalled();
      expect(prismaMock.submission.findFirst).not.toHaveBeenCalled();
      expect(s3Send).not.toHaveBeenCalled();
    });

    it('allows all Design registrants to download winner submissions when legacy visibility is disabled', async () => {
      resourceApiService.getMemberResourcesRoles.mockResolvedValue([
        { roleName: 'Submitter' },
      ]);
      challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
        status: ChallengeStatus.COMPLETED,
        track: 'Design',
        metadata: {
          submissionsViewable: 'false',
          allowAllRegistrantsToDownloadWinningSubmissions: 'true',
        },
        winners: [{ userId: 'owner-user', placement: 1 }],
      });
      prismaMock.challengeResult.findUnique.mockResolvedValue({
        submissionId: 'sub-123',
        userId: 'owner-user',
        placement: 1,
      });

      const result = await service.getSubmissionDownloadUrl(
        {
          userId: 'registered-user',
          isMachine: false,
          roles: [],
        } as any,
        'sub-123',
      );

      expect(result).toBe(signedUrl);
      expect(prismaMock.submission.findFirst).not.toHaveBeenCalled();
      expect(s3Send).toHaveBeenCalledTimes(1);
    });

    it('uses passing-submitter eligibility for Design challenges when legacy visibility is disabled', async () => {
      resourceApiService.getMemberResourcesRoles.mockResolvedValue([
        { roleName: 'Submitter' },
      ]);
      challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
        status: ChallengeStatus.COMPLETED,
        track: 'Design',
        metadata: {
          submissionsViewable: 'false',
          allowAllRegistrantsToDownloadWinningSubmissions: 'false',
        },
        winners: [{ userId: 'owner-user', placement: 1 }],
      });
      prismaMock.submission.findFirst.mockResolvedValue({ id: 'passing-sub' });

      const result = await service.getSubmissionDownloadUrl(
        {
          userId: 'passing-registered-user',
          isMachine: false,
          roles: [],
        } as any,
        'sub-123',
      );

      expect(result).toBe(signedUrl);
      expect(prismaMock.submission.findFirst).toHaveBeenCalledTimes(1);
      expect(s3Send).toHaveBeenCalledTimes(1);
    });

    it('denies a non-passing Design submitter when the new flag is disabled regardless of legacy visibility', async () => {
      resourceApiService.getMemberResourcesRoles.mockResolvedValue([
        { roleName: 'Submitter' },
      ]);
      challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
        status: ChallengeStatus.COMPLETED,
        track: 'Design',
        metadata: {
          submissionsViewable: 'false',
          allowAllRegistrantsToDownloadWinningSubmissions: 'false',
        },
        winners: [{ userId: 'owner-user', placement: 1 }],
      });
      prismaMock.submission.findFirst.mockResolvedValue(null);

      await expect(
        service.getSubmissionDownloadUrl(
          {
            userId: 'non-passing-registered-user',
            isMachine: false,
            roles: [],
          } as any,
          'sub-123',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(prismaMock.submission.findFirst).toHaveBeenCalledTimes(1);
      expect(s3Send).not.toHaveBeenCalled();
    });

    it('denies a failed Design First2Finish submitter when the new flag is disabled', async () => {
      resourceApiService.getMemberResourcesRoles.mockResolvedValue([
        { roleName: 'Submitter' },
      ]);
      challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
        status: ChallengeStatus.COMPLETED,
        type: 'First2Finish',
        track: 'Design',
        metadata: {
          submissionsViewable: 'true',
        },
        winners: [{ userId: 'owner-user', placement: 1 }],
      });
      prismaMock.submission.findFirst.mockImplementation(({ where }) =>
        Promise.resolve(
          where.reviewSummation ? null : { id: 'failed-own-submission' },
        ),
      );

      await expect(
        service.getSubmissionDownloadUrl(
          {
            userId: 'failed-first2finish-submitter',
            isMachine: false,
            roles: [],
          } as any,
          'sub-123',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(prismaMock.submission.findFirst).toHaveBeenCalledTimes(1);
      expect(prismaMock.submission.findFirst).toHaveBeenCalledWith({
        where: {
          challengeId: 'challenge-xyz',
          memberId: 'failed-first2finish-submitter',
          reviewSummation: {
            some: {
              isPassing: true,
            },
          },
        },
        select: { id: true },
      });
      expect(s3Send).not.toHaveBeenCalled();
    });

    it('preserves manager access when Design submissions are not viewable', async () => {
      resourceApiService.getMemberResourcesRoles.mockResolvedValue([
        { roleName: 'Manager' },
      ]);

      const result = await service.getSubmissionDownloadUrl(
        {
          userId: 'manager-user',
          isMachine: false,
          roles: [],
        } as any,
        'sub-123',
      );

      expect(result).toBe(signedUrl);
      expect(challengeApiServiceMock.getChallengeDetail).not.toHaveBeenCalled();
      expect(prismaMock.submission.findFirst).not.toHaveBeenCalled();
      expect(s3Send).toHaveBeenCalledTimes(1);
    });

    it('denies submitters when the challenge is not completed', async () => {
      resourceApiService.getMemberResourcesRoles.mockResolvedValue([
        { roleName: 'Submitter' },
      ]);
      challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
        status: ChallengeStatus.ACTIVE,
        track: 'Development',
        metadata: {
          allowAllRegistrantsToDownloadWinningSubmissions: 'true',
        },
        winners: [{ userId: 'owner-user', placement: 1 }],
      });

      await expect(
        service.getSubmissionDownloadUrl(
          {
            userId: 'submitter-user',
            isMachine: false,
            roles: [],
          } as any,
          'sub-123',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.submission.findFirst).not.toHaveBeenCalled();
    });

    it('preserves legacy First2Finish target scope when the feature flag is missing', async () => {
      resourceApiService.getMemberResourcesRoles.mockResolvedValue([
        { roleName: 'Submitter' },
      ]);
      challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
        status: ChallengeStatus.COMPLETED,
        type: 'First2Finish',
        legacy: { subTrack: 'first_2_finish' },
      });
      prismaMock.submission.findFirst.mockResolvedValue({
        id: 'own-submission',
      });

      const result = await service.getSubmissionDownloadUrl(
        {
          userId: 'submitter-user',
          isMachine: false,
          roles: [],
        } as any,
        'sub-123',
      );

      expect(result).toBe(signedUrl);
      expect(resourceApiService.getMemberResourcesRoles).toHaveBeenCalledWith(
        'challenge-xyz',
        'submitter-user',
      );
      expect(challengeApiServiceMock.getChallengeDetail).toHaveBeenCalledWith(
        'challenge-xyz',
      );
      expect(prismaMock.submission.findFirst).toHaveBeenCalledTimes(1);
      expect(prismaMock.submission.findFirst).toHaveBeenCalledWith({
        where: {
          challengeId: 'challenge-xyz',
          memberId: 'submitter-user',
        },
        select: { id: true },
      });
      expect(s3Send).toHaveBeenCalledTimes(1);
    });

    it('denies a First2Finish submitter a non-winner without legacy fallback when the feature flag is enabled', async () => {
      resourceApiService.getMemberResourcesRoles.mockResolvedValue([
        { roleName: 'Submitter' },
      ]);
      challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
        status: ChallengeStatus.COMPLETED,
        type: 'First2Finish',
        legacy: { subTrack: 'first_2_finish' },
        metadata: {
          allowAllRegistrantsToDownloadWinningSubmissions: 'true',
        },
        winners: [{ userId: 'different-owner', placement: 1 }],
      });
      prismaMock.submission.findFirst.mockResolvedValue({
        id: 'requester-own-submission',
      });

      await expect(
        service.getSubmissionDownloadUrl(
          {
            userId: 'first2finish-submitter',
            isMachine: false,
            roles: [],
          } as any,
          'sub-123',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(prismaMock.challengeResult.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.submission.findFirst).not.toHaveBeenCalled();
      expect(s3Send).not.toHaveBeenCalled();
    });

    it('allows every registered First2Finish submitter an exact winner when the feature flag is enabled', async () => {
      resourceApiService.getMemberResourcesRoles.mockResolvedValue([
        { roleName: 'Submitter' },
      ]);
      challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
        status: ChallengeStatus.COMPLETED,
        type: 'First2Finish',
        legacy: { subTrack: 'first_2_finish' },
        metadata: {
          allowAllRegistrantsToDownloadWinningSubmissions: 'true',
        },
        winners: [{ userId: 'owner-user', placement: 1 }],
      });
      prismaMock.challengeResult.findUnique.mockResolvedValue({
        submissionId: 'sub-123',
        userId: 'owner-user',
        placement: 1,
      });
      prismaMock.submission.findFirst.mockResolvedValue(null);

      const result = await service.getSubmissionDownloadUrl(
        {
          userId: 'registered-first2finish-user',
          isMachine: false,
          roles: [],
        } as any,
        'sub-123',
      );

      expect(result).toBe(signedUrl);
      expect(prismaMock.challengeResult.findUnique).toHaveBeenCalledTimes(1);
      expect(prismaMock.submission.findFirst).not.toHaveBeenCalled();
      expect(s3Send).toHaveBeenCalledTimes(1);
    });
  });

  describe('createSubmission URL First2Finish event', () => {
    let prismaMock: {
      submission: {
        create: jest.Mock;
      };
    };
    let prismaErrorServiceMock: { handleError: jest.Mock };
    let challengeApiServiceMock: {
      validateChallengeExists: jest.Mock;
      validateSubmissionCreation: jest.Mock;
      validateCheckpointSubmissionCreation: jest.Mock;
      validateFinalFixSubmissionCreation: jest.Mock;
      getChallengeDetail: jest.Mock;
    };
    let resourceApiServiceMock: {
      validateSubmitterRegistration: jest.Mock;
    };
    let resourcePrismaMock: {
      resource: {
        findFirst: jest.Mock;
      };
    };
    let eventBusServiceMock: {
      publish: jest.Mock;
    };
    let challengeCatalogServiceMock: {
      ensureSubmissionTypeAllowed: jest.Mock;
    };
    let challengePrismaMock: {
      $executeRaw: jest.Mock;
      $queryRaw: jest.Mock;
    };
    let createService: SubmissionService;

    const createdSubmission = {
      challengeId: 'challenge-f2f',
      createdAt: new Date('2026-07-10T13:00:00Z'),
      createdBy: '1001',
      eventRaised: false,
      fileType: undefined,
      id: 'submission-f2f-url',
      isFileSubmission: false,
      legacyChallengeId: null,
      legacySubmissionId: null,
      legacyUploadId: null,
      memberId: '1001',
      prizeId: null,
      status: SubmissionStatus.ACTIVE,
      submissionPhaseId: 'submission-phase',
      submittedDate: new Date('2026-07-10T13:00:00Z'),
      systemFileName: 'submission',
      type: SubmissionType.CONTEST_SUBMISSION,
      updatedAt: new Date('2026-07-10T13:00:00Z'),
      updatedBy: '1001',
      url: 'https://example.com/submission',
      virusScan: false,
      viewCount: 0,
    };

    beforeEach(() => {
      prismaMock = {
        submission: {
          create: jest.fn().mockResolvedValue(createdSubmission),
        },
      };
      prismaErrorServiceMock = {
        handleError: jest.fn().mockReturnValue({
          message: 'Unexpected error',
          code: 'INTERNAL_ERROR',
          details: {},
        }),
      };
      challengeApiServiceMock = {
        validateChallengeExists: jest.fn().mockResolvedValue({
          id: 'challenge-f2f',
          legacy: {},
          status: ChallengeStatus.ACTIVE,
          track: 'Development',
          type: 'First2Finish',
        }),
        validateSubmissionCreation: jest.fn().mockResolvedValue(undefined),
        validateCheckpointSubmissionCreation: jest
          .fn()
          .mockResolvedValue(undefined),
        validateFinalFixSubmissionCreation: jest
          .fn()
          .mockResolvedValue(undefined),
        getChallengeDetail: jest.fn().mockResolvedValue({
          id: 'challenge-f2f',
          type: 'First2Finish',
        }),
      };
      resourceApiServiceMock = {
        validateSubmitterRegistration: jest.fn().mockResolvedValue(undefined),
      };
      resourcePrismaMock = {
        resource: {
          findFirst: jest.fn().mockResolvedValue({
            memberHandle: 'submitterHandle',
          }),
        },
      };
      eventBusServiceMock = {
        publish: jest.fn().mockResolvedValue(undefined),
      };
      challengeCatalogServiceMock = {
        ensureSubmissionTypeAllowed: jest.fn(),
      };
      challengePrismaMock = {
        $executeRaw: jest.fn().mockResolvedValue(1),
        $queryRaw: jest.fn().mockResolvedValue([]),
      };

      createService = new SubmissionService(
        prismaMock as any,
        prismaErrorServiceMock as any,
        challengePrismaMock as any,
        challengeApiServiceMock as any,
        resourceApiServiceMock as any,
        resourcePrismaMock as any,
        eventBusServiceMock as any,
        challengeCatalogServiceMock as any,
        {} as any,
      );

      jest
        .spyOn(createService as any, 'publishSubmissionCreateEvent')
        .mockResolvedValue(undefined);
      jest
        .spyOn(createService as any, 'publishSubmissionScanEvent')
        .mockResolvedValue(undefined);
      jest
        .spyOn(createService as any, 'populateLatestSubmissionFlags')
        .mockResolvedValue(undefined);
      jest
        .spyOn(createService as any, 'stripIsLatestForUnlimitedChallenges')
        .mockResolvedValue(undefined);
    });

    it('publishes first2finish.submission.received immediately for URL submissions', async () => {
      await createService.createSubmission(
        {
          isMachine: false,
          roles: [],
          userId: '1001',
        } as any,
        {
          challengeId: 'challenge-f2f',
          memberId: '1001',
          type: SubmissionType.CONTEST_SUBMISSION,
          url: 'https://example.com/submission',
        },
      );

      expect(
        (createService as any).publishSubmissionScanEvent,
      ).not.toHaveBeenCalled();
      expect(eventBusServiceMock.publish).toHaveBeenCalledWith(
        'first2finish.submission.received',
        {
          challengeId: 'challenge-f2f',
          memberHandle: 'submitterHandle',
          memberId: '1001',
          submissionId: 'submission-f2f-url',
          submissionUrl: 'https://example.com/submission',
          submittedDate: '2026-07-10T13:00:00.000Z',
        },
      );
    });
  });

  describe('createSubmission Final Fix', () => {
    let prismaMock: {
      submission: {
        create: jest.Mock;
      };
    };
    let challengeApiServiceMock: {
      validateChallengeExists: jest.Mock;
      validateSubmissionCreation: jest.Mock;
      validateCheckpointSubmissionCreation: jest.Mock;
      validateFinalFixSubmissionCreation: jest.Mock;
    };
    let resourceApiServiceMock: {
      validateSubmitterRegistration: jest.Mock;
    };
    let challengeCatalogServiceMock: {
      ensureSubmissionTypeAllowed: jest.Mock;
    };
    let challengePrismaMock: {
      $executeRaw: jest.Mock;
      $queryRaw: jest.Mock;
    };
    let createService: SubmissionService;

    const buildCreatedSubmission = (type: SubmissionType) => ({
      challengeId: 'challenge-final-fix',
      createdAt: new Date('2026-02-01T12:00:00Z'),
      createdBy: '1001',
      eventRaised: false,
      fileType: 'zip',
      id: `submission-${type}`,
      isFileSubmission: false,
      legacyChallengeId: null,
      legacySubmissionId: null,
      legacyUploadId: null,
      memberId: '1001',
      prizeId: null,
      status: SubmissionStatus.ACTIVE,
      submissionPhaseId: 'phase-final-fix',
      submittedDate: new Date('2026-02-01T12:00:00Z'),
      systemFileName: 'submission.zip',
      type,
      updatedAt: new Date('2026-02-01T12:00:00Z'),
      updatedBy: '1001',
      url: 'https://example.com/submission.zip',
      virusScan: false,
      viewCount: 0,
    });

    const createBody = (
      type: SubmissionType,
    ): {
      challengeId: string;
      memberId: string;
      type: SubmissionType;
      url: string;
    } => ({
      challengeId: 'challenge-final-fix',
      memberId: '1001',
      type,
      url: 'https://example.com/submission.zip',
    });

    beforeEach(() => {
      prismaMock = {
        submission: {
          create: jest.fn(),
        },
      };
      challengeApiServiceMock = {
        validateChallengeExists: jest.fn().mockResolvedValue({
          id: 'challenge-final-fix',
          legacy: {},
          status: ChallengeStatus.ACTIVE,
          track: 'Design',
          type: 'Challenge',
        }),
        validateSubmissionCreation: jest.fn().mockResolvedValue(undefined),
        validateCheckpointSubmissionCreation: jest
          .fn()
          .mockResolvedValue(undefined),
        validateFinalFixSubmissionCreation: jest
          .fn()
          .mockResolvedValue(undefined),
      };
      resourceApiServiceMock = {
        validateSubmitterRegistration: jest.fn().mockResolvedValue(undefined),
      };
      challengeCatalogServiceMock = {
        ensureSubmissionTypeAllowed: jest.fn(),
      };
      challengePrismaMock = {
        $executeRaw: jest.fn().mockResolvedValue(1),
        $queryRaw: jest.fn().mockResolvedValue([]),
      };

      createService = new SubmissionService(
        prismaMock as any,
        { handleError: jest.fn() } as any,
        challengePrismaMock as any,
        challengeApiServiceMock as any,
        resourceApiServiceMock as any,
        {} as any,
        { publish: jest.fn() } as any,
        challengeCatalogServiceMock as any,
        {} as any,
      );

      jest
        .spyOn(createService as any, 'publishSubmissionCreateEvent')
        .mockResolvedValue(undefined);
      jest
        .spyOn(createService as any, 'publishTopgearSubmissionEventIfEligible')
        .mockResolvedValue(undefined);
      jest
        .spyOn(createService as any, 'populateLatestSubmissionFlags')
        .mockResolvedValue(undefined);
      jest
        .spyOn(createService as any, 'stripIsLatestForUnlimitedChallenges')
        .mockResolvedValue(undefined);
      jest
        .spyOn(createService as any, 'publishSubmissionScanEvent')
        .mockResolvedValue(undefined);
    });

    it('accepts Final Fix submission when Final Fix phase is open and member is a winner', async () => {
      const created = buildCreatedSubmission(
        SubmissionType.STUDIO_FINAL_FIX_SUBMISSION,
      );
      prismaMock.submission.create.mockResolvedValue(created);
      challengePrismaMock.$queryRaw.mockResolvedValue([
        { userId: 1001 },
        { userId: 2002 },
      ]);

      const result = await createService.createSubmission(
        {
          isMachine: false,
          roles: [],
          userId: '1001',
        } as any,
        createBody(SubmissionType.STUDIO_FINAL_FIX_SUBMISSION),
      );

      expect(
        challengeApiServiceMock.validateFinalFixSubmissionCreation,
      ).toHaveBeenCalledWith('challenge-final-fix');
      expect(challengePrismaMock.$queryRaw).toHaveBeenCalled();
      expect(prismaMock.submission.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          confirmationEmail: {
            create: {},
          },
        }),
      });
      expect(result.type).toBe(SubmissionType.STUDIO_FINAL_FIX_SUBMISSION);
    });

    it('rejects Final Fix submission for non-winner member', async () => {
      challengePrismaMock.$queryRaw.mockResolvedValue([{ userId: 2002 }]);

      await expect(
        createService.createSubmission(
          {
            isMachine: false,
            roles: [],
            userId: '1001',
          } as any,
          createBody(SubmissionType.STUDIO_FINAL_FIX_SUBMISSION),
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'FORBIDDEN_FINAL_FIX_SUBMISSION',
        }),
      });
      expect(prismaMock.submission.create).not.toHaveBeenCalled();
    });

    it('maps Final Fix closed phase to SUBMISSION_PHASE_CLOSED', async () => {
      challengeApiServiceMock.validateFinalFixSubmissionCreation.mockRejectedValue(
        new Error('Final Fix phase is not currently open'),
      );

      await expect(
        createService.createSubmission(
          {
            isMachine: false,
            roles: [],
            userId: '1001',
          } as any,
          createBody(SubmissionType.STUDIO_FINAL_FIX_SUBMISSION),
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'SUBMISSION_PHASE_CLOSED',
          details: expect.objectContaining({
            requiredPhase: 'Final Fix',
          }),
        }),
      });
      expect(challengePrismaMock.$queryRaw).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when Final Fix phase is closed', async () => {
      challengeApiServiceMock.validateFinalFixSubmissionCreation.mockRejectedValue(
        new Error('Final Fix phase is not currently open'),
      );

      await expect(
        createService.createSubmission(
          {
            isMachine: false,
            roles: [],
            userId: '1001',
          } as any,
          createBody(SubmissionType.STUDIO_FINAL_FIX_SUBMISSION),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('listSubmission', () => {
    let prismaMock: {
      submission: {
        findMany: jest.Mock;
        count: jest.Mock;
        findFirst: jest.Mock;
        findUnique: jest.Mock;
      };
      reviewType: {
        findMany: jest.Mock;
      };
      $queryRaw: jest.Mock;
    };
    let prismaErrorServiceMock: { handleError: jest.Mock };
    let challengePrismaMock: {
      $queryRaw: jest.Mock;
    };
    let challengeApiServiceMock: {
      getChallengeDetail: jest.Mock;
      getChallenges: jest.Mock;
    };
    let resourceApiServiceListMock: {
      validateSubmitterRegistration: jest.Mock;
      getMemberResourcesRoles: jest.Mock;
    };
    let resourcePrismaListMock: { resource: { findMany: jest.Mock } };
    let memberPrismaMock: { member: { findMany: jest.Mock } };
    let listService: SubmissionService;

    beforeEach(() => {
      prismaMock = {
        submission: {
          findMany: jest.fn(),
          count: jest.fn(),
          findFirst: jest.fn(),
          findUnique: jest.fn(),
        },
        reviewType: {
          findMany: jest.fn().mockResolvedValue([]),
        },
        $queryRaw: jest.fn().mockResolvedValue([]),
      };
      prismaErrorServiceMock = {
        handleError: jest.fn().mockReturnValue({
          message: 'Unexpected error',
          code: 'INTERNAL_ERROR',
          details: {},
        }),
      };
      challengePrismaMock = {
        $queryRaw: jest.fn().mockResolvedValue([]),
      };
      challengeApiServiceMock = {
        getChallengeDetail: jest.fn().mockResolvedValue({
          id: 'challenge-1',
          status: ChallengeStatus.ACTIVE,
          type: 'Challenge',
          legacy: {},
          phases: [
            {
              id: 'phase-123',
              phaseId: 'legacy-phase-123',
              name: 'Review Phase',
            },
          ],
        }),
        getChallenges: jest.fn(),
      };
      resourceApiServiceListMock = {
        validateSubmitterRegistration: jest.fn(),
        getMemberResourcesRoles: jest.fn().mockResolvedValue([]),
      };
      resourcePrismaListMock = {
        resource: {
          findMany: jest.fn().mockResolvedValue([]),
        },
      };
      memberPrismaMock = {
        member: { findMany: jest.fn().mockResolvedValue([]) },
      };
      listService = new SubmissionService(
        prismaMock as any,
        prismaErrorServiceMock as any,
        challengePrismaMock as any,
        challengeApiServiceMock as any,
        resourceApiServiceListMock as any,
        resourcePrismaListMock as any,
        {} as any,
        {} as any,
        memberPrismaMock as any,
      );
    });

    it('applies default ordering and marks the newest submission as latest', async () => {
      const submissions = [
        {
          id: 'submission-old',
          challengeId: 'challenge-1',
          memberId: 'member-1',
          submittedDate: new Date('2024-01-01T10:00:00Z'),
          createdAt: new Date('2024-01-01T10:00:00Z'),
          updatedAt: new Date('2024-01-01T10:00:00Z'),
          type: SubmissionType.CONTEST_SUBMISSION,
          status: SubmissionStatus.ACTIVE,
          review: [],
          reviewSummation: [],
          legacyChallengeId: null,
          prizeId: null,
        },
        {
          id: 'submission-new',
          challengeId: 'challenge-1',
          memberId: 'member-1',
          submittedDate: new Date('2024-01-02T12:00:00Z'),
          createdAt: new Date('2024-01-02T12:00:00Z'),
          updatedAt: new Date('2024-01-02T12:00:00Z'),
          type: SubmissionType.CONTEST_SUBMISSION,
          status: SubmissionStatus.ACTIVE,
          review: [],
          reviewSummation: [],
          legacyChallengeId: null,
          prizeId: null,
        },
      ];

      prismaMock.submission.findMany.mockResolvedValue(
        submissions.map((entry) => ({ ...entry })),
      );
      prismaMock.submission.count.mockResolvedValue(submissions.length);
      prismaMock.submission.findFirst.mockResolvedValue({
        id: 'submission-new',
      });
      prismaMock.$queryRaw
        .mockResolvedValueOnce([{ id: 'submission-new' }])
        .mockResolvedValueOnce([
          { memberId: 'member-1', submissionCount: BigInt(2) },
        ]);

      const result = await listService.listSubmission(
        { isMachine: false } as any,
        { challengeId: 'challenge-1' } as any,
        { page: 1, perPage: 50 } as any,
      );

      expect(prismaMock.submission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [
            { submittedDate: 'desc' },
            { createdAt: 'desc' },
            { updatedAt: 'desc' },
            { id: 'desc' },
          ],
        }),
      );

      expect(challengePrismaMock.$queryRaw).toHaveBeenCalledTimes(1);

      const latestEntries = result.data.filter((entry) => entry.isLatest);
      expect(latestEntries.map((entry) => entry.id)).toEqual([
        'submission-new',
      ]);
    });

    it('filters latest submissions before pagination when isLatest=true', async () => {
      const latestSubmission = {
        id: 'submission-new',
        challengeId: 'challenge-1',
        memberId: 'member-1',
        submittedDate: new Date('2024-01-02T12:00:00Z'),
        createdAt: new Date('2024-01-02T12:00:00Z'),
        updatedAt: new Date('2024-01-02T12:00:00Z'),
        type: SubmissionType.CONTEST_SUBMISSION,
        status: SubmissionStatus.ACTIVE,
        review: [],
        reviewSummation: [],
        legacyChallengeId: null,
        prizeId: null,
      };

      const latestSpy = jest
        .spyOn(listService as any, 'findLatestSubmissionIdsForQuery')
        .mockResolvedValue(['submission-new']);
      const countSpy = jest
        .spyOn(listService as any, 'populateSubmissionCountsForQuery')
        .mockImplementation((submissions: any[]) => {
          submissions.forEach((submission) => {
            submission.submissionCount = 2;
          });
          return Promise.resolve();
        });
      prismaMock.submission.findMany.mockResolvedValue([
        { ...latestSubmission },
      ]);
      prismaMock.submission.count.mockResolvedValue(1);

      const result = await listService.listSubmission(
        { isMachine: false } as any,
        { challengeId: 'challenge-1', isLatest: 'true' } as any,
        { page: 1, perPage: 50 } as any,
      );

      expect(latestSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          challengeId: 'challenge-1',
          isLatest: 'true',
        }),
      );
      expect(countSpy).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: 'submission-new' }),
        ]),
        expect.objectContaining({
          challengeId: 'challenge-1',
          isLatest: 'true',
        }),
      );
      expect(prismaMock.submission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            challengeId: 'challenge-1',
            id: { in: ['submission-new'] },
          }),
          skip: 0,
          take: 50,
        }),
      );
      expect(prismaMock.submission.count).toHaveBeenCalledWith({
        where: expect.objectContaining({
          challengeId: 'challenge-1',
          id: { in: ['submission-new'] },
        }),
      });
      expect(result.meta.totalCount).toBe(1);
      expect(result.data).toEqual([
        expect.objectContaining({
          id: 'submission-new',
          isLatest: true,
          submissionCount: 2,
        }),
      ]);
    });

    it('requires challengeId when filtering by isLatest', async () => {
      await expect(
        listService.listSubmission(
          { isMachine: false } as any,
          { isLatest: 'true' } as any,
          { page: 1, perPage: 50 } as any,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prismaMock.submission.findMany).not.toHaveBeenCalled();
    });

    it('enriches reviews with review type names when typeId is present', async () => {
      const submissions = [
        {
          id: 'submission-1',
          challengeId: 'challenge-1',
          memberId: 'member-1',
          submittedDate: new Date('2024-01-01T10:00:00Z'),
          createdAt: new Date('2024-01-01T10:00:00Z'),
          updatedAt: new Date('2024-01-01T10:00:00Z'),
          type: SubmissionType.CONTEST_SUBMISSION,
          status: SubmissionStatus.ACTIVE,
          review: [
            {
              id: 'review-1',
              typeId: 'type-123',
              resourceId: 'resource-1',
              phaseId: 'phase-123',
              reviewItems: [],
            },
          ],
          reviewSummation: [],
          legacyChallengeId: null,
          prizeId: null,
        },
      ];

      prismaMock.submission.findMany.mockResolvedValue(
        submissions.map((entry) => ({ ...entry })),
      );
      prismaMock.submission.count.mockResolvedValue(submissions.length);
      prismaMock.submission.findFirst.mockResolvedValue({
        id: 'submission-1',
      });
      prismaMock.reviewType.findMany.mockResolvedValue([
        { id: 'type-123', name: 'Iterative Review' },
      ]);

      const result = await listService.listSubmission(
        { isMachine: false, roles: [UserRole.Admin] } as any,
        { challengeId: 'challenge-1' } as any,
        { page: 1, perPage: 20 } as any,
      );

      expect(result.data[0].review?.[0]?.reviewType).toBe('Iterative Review');
      expect(result.data[0].review?.[0]?.phaseName).toBe('Review Phase');
      expect(prismaMock.reviewType.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['type-123'] } },
        select: { id: true, name: true },
      });
    });

    it('omits isLatest when submission metadata indicates unlimited submissions', async () => {
      challengePrismaMock.$queryRaw.mockResolvedValue([
        {
          value: '{"unlimited":"true","limit":"false","count":""}',
        },
      ]);

      const submissions = [
        {
          id: 'submission-old',
          challengeId: 'challenge-1',
          memberId: 'member-1',
          submittedDate: new Date('2024-01-01T10:00:00Z'),
          createdAt: new Date('2024-01-01T10:00:00Z'),
          updatedAt: new Date('2024-01-01T10:00:00Z'),
          type: SubmissionType.CONTEST_SUBMISSION,
          status: SubmissionStatus.ACTIVE,
          review: [],
          reviewSummation: [],
          legacyChallengeId: null,
          prizeId: null,
        },
        {
          id: 'submission-new',
          challengeId: 'challenge-1',
          memberId: 'member-1',
          submittedDate: new Date('2024-01-02T12:00:00Z'),
          createdAt: new Date('2024-01-02T12:00:00Z'),
          updatedAt: new Date('2024-01-02T12:00:00Z'),
          type: SubmissionType.CONTEST_SUBMISSION,
          status: SubmissionStatus.ACTIVE,
          review: [],
          reviewSummation: [],
          legacyChallengeId: null,
          prizeId: null,
        },
      ];

      prismaMock.submission.findMany.mockResolvedValue(
        submissions.map((entry) => ({ ...entry })),
      );
      prismaMock.submission.count.mockResolvedValue(submissions.length);
      prismaMock.submission.findFirst.mockResolvedValue({
        id: 'submission-new',
      });

      const result = await listService.listSubmission(
        { isMachine: false } as any,
        { challengeId: 'challenge-1' } as any,
        { page: 1, perPage: 50 } as any,
      );

      expect(result.data[0]).not.toHaveProperty('isLatest');
      expect(result.data[1]).not.toHaveProperty('isLatest');
    });

    it('omits review data and submission id for other submitters while challenge is active', async () => {
      const submissions = [
        {
          id: 'submission-own',
          challengeId: 'challenge-1',
          memberId: 'user-1',
          submittedDate: new Date('2025-01-02T12:00:00Z'),
          createdAt: new Date('2025-01-02T12:00:00Z'),
          updatedAt: new Date('2025-01-02T12:00:00Z'),
          type: SubmissionType.CONTEST_SUBMISSION,
          status: SubmissionStatus.ACTIVE,
          review: [{ id: 'review-own' }],
          reviewSummation: [],
          legacyChallengeId: null,
          prizeId: null,
        },
        {
          id: 'submission-other',
          challengeId: 'challenge-1',
          memberId: 'user-2',
          submittedDate: new Date('2025-01-01T12:00:00Z'),
          createdAt: new Date('2025-01-01T12:00:00Z'),
          updatedAt: new Date('2025-01-01T12:00:00Z'),
          type: SubmissionType.CONTEST_SUBMISSION,
          status: SubmissionStatus.ACTIVE,
          review: [{ id: 'review-other' }],
          reviewSummation: [],
          legacyChallengeId: null,
          prizeId: null,
        },
      ];

      resourceApiServiceListMock.getMemberResourcesRoles.mockResolvedValue([
        {
          roleName: 'Submitter',
          roleId: CommonConfig.roles.submitterRoleId,
        },
      ]);

      prismaMock.submission.findMany.mockResolvedValue(
        submissions.map((entry) => ({ ...entry })),
      );
      prismaMock.submission.count.mockResolvedValue(submissions.length);
      prismaMock.submission.findFirst.mockResolvedValue({
        id: 'submission-own',
      });

      const result = await listService.listSubmission(
        {
          userId: 'user-1',
          isMachine: false,
          roles: [UserRole.User],
        } as any,
        { challengeId: 'challenge-1' } as any,
        { page: 1, perPage: 50 } as any,
      );

      const own = result.data.find((entry) => entry.memberId === 'user-1');
      const other = result.data.find((entry) => entry.memberId === 'user-2');

      expect(own?.review).toBeDefined();
      expect(other).toBeDefined();
      expect(other).not.toHaveProperty('review');
      expect(other).not.toHaveProperty('id');
      expect(
        resourceApiServiceListMock.getMemberResourcesRoles,
      ).toHaveBeenCalledWith('challenge-1', 'user-1');
      expect(challengeApiServiceMock.getChallengeDetail).toHaveBeenCalledWith(
        'challenge-1',
      );
    });

    it('omits review data for unrelated users before completion', async () => {
      const submissions = [
        {
          id: 'submission-other',
          challengeId: 'challenge-1',
          memberId: 'user-2',
          submittedDate: new Date('2025-01-01T12:00:00Z'),
          createdAt: new Date('2025-01-01T12:00:00Z'),
          updatedAt: new Date('2025-01-01T12:00:00Z'),
          type: SubmissionType.CONTEST_SUBMISSION,
          status: SubmissionStatus.ACTIVE,
          review: [{ id: 'review-other' }],
          reviewSummation: [],
          legacyChallengeId: null,
          prizeId: null,
        },
      ];

      resourceApiServiceListMock.getMemberResourcesRoles.mockResolvedValue([]);

      prismaMock.submission.findMany.mockResolvedValue(
        submissions.map((entry) => ({ ...entry })),
      );
      prismaMock.submission.count.mockResolvedValue(submissions.length);
      prismaMock.submission.findFirst.mockResolvedValue({
        id: 'submission-other',
      });

      const result = await listService.listSubmission(
        {
          userId: 'user-3',
          isMachine: false,
          roles: [],
        } as any,
        { challengeId: 'challenge-1' } as any,
        { page: 1, perPage: 50 } as any,
      );

      const other = result.data[0];
      expect(other).not.toHaveProperty('review');
      expect(other.reviewSummation).toEqual([]);
      expect(
        resourceApiServiceListMock.getMemberResourcesRoles,
      ).toHaveBeenCalledWith('challenge-1', 'user-3');
      expect(challengeApiServiceMock.getChallengeDetail).toHaveBeenCalledWith(
        'challenge-1',
      );
    });

    it('strips review details for unauthorized active challenge getSubmission requests', async () => {
      const submission = {
        id: 'submission-unauthorized',
        challengeId: 'challenge-1',
        memberId: 'user-2',
        submittedDate: new Date('2025-01-01T12:00:00Z'),
        createdAt: new Date('2025-01-01T12:00:00Z'),
        updatedAt: new Date('2025-01-01T12:00:00Z'),
        type: SubmissionType.CONTEST_SUBMISSION,
        status: SubmissionStatus.ACTIVE,
        review: [
          {
            id: 'review-1',
            initialScore: 50,
            finalScore: 55,
            reviewItems: [],
          },
        ],
        reviewSummation: [{ id: 'summation-1', metadata: { foo: 'bar' } }],
        legacyChallengeId: null,
        prizeId: null,
      };

      prismaMock.submission.findUnique.mockResolvedValue(submission);
      resourceApiServiceListMock.getMemberResourcesRoles.mockResolvedValue([]);
      challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
        id: 'challenge-1',
        status: ChallengeStatus.ACTIVE,
        type: 'Challenge',
        legacy: {},
        phases: [],
      });

      const result = await listService.getSubmission(
        {
          userId: 'user-3',
          isMachine: false,
          roles: [],
        } as any,
        'submission-unauthorized',
      );

      expect(result.review).toBeUndefined();
      expect(result.reviewSummation).toBeDefined();
      expect(challengeApiServiceMock.getChallengeDetail).toHaveBeenCalledWith(
        'challenge-1',
      );
    });

    it('allows submitters to see review scores for their own submission while the challenge is active', async () => {
      const now = new Date('2025-01-02T12:00:00Z');
      const submissions = [
        {
          id: 'submission-own',
          challengeId: 'challenge-1',
          memberId: 'user-1',
          submittedDate: now,
          createdAt: now,
          updatedAt: now,
          type: SubmissionType.CONTEST_SUBMISSION,
          status: SubmissionStatus.ACTIVE,
          review: [
            {
              id: 'review-own',
              phaseId: 'phase-review',
              initialScore: 90,
              finalScore: 95,
              reviewItems: [
                {
                  id: 'item-1',
                  scorecardQuestionId: 'q1',
                  initialAnswer: 'YES',
                  finalAnswer: 'YES',
                  reviewItemComments: [],
                },
              ],
            },
          ],
          reviewSummation: [],
          legacyChallengeId: null,
          prizeId: null,
        },
      ];

      resourceApiServiceListMock.getMemberResourcesRoles.mockResolvedValue([
        {
          roleName: 'Submitter',
          roleId: CommonConfig.roles.submitterRoleId,
        },
      ]);
      challengeApiServiceMock.getChallengeDetail.mockResolvedValueOnce({
        id: 'challenge-1',
        status: ChallengeStatus.ACTIVE,
        type: 'Challenge',
        legacy: {},
        phases: [
          {
            id: 'phase-review',
            phaseId: 'phase-review',
            name: 'Review',
            isOpen: false,
            actualEndTime: new Date('2025-01-01T12:00:00Z').toISOString(),
          },
        ],
      });

      prismaMock.submission.findMany.mockResolvedValue(
        submissions.map((entry) => ({ ...entry })),
      );
      prismaMock.submission.count.mockResolvedValue(submissions.length);
      prismaMock.submission.findFirst.mockResolvedValue({
        id: 'submission-own',
      });

      const result = await listService.listSubmission(
        {
          userId: 'user-1',
          isMachine: false,
          roles: [UserRole.User],
        } as any,
        { challengeId: 'challenge-1' } as any,
        { page: 1, perPage: 50 } as any,
      );

      const submissionResult = result.data[0];
      expect(submissionResult.review).toHaveLength(1);
      expect(submissionResult.review?.[0]?.initialScore).toBe(90);
      expect(submissionResult.review?.[0]?.finalScore).toBe(95);
      expect(submissionResult.review?.[0]?.reviewItems).toHaveLength(1);
    });

    it('retains review data for other submissions once the challenge completes', async () => {
      challengeApiServiceMock.getChallengeDetail.mockResolvedValueOnce({
        id: 'challenge-1',
        status: ChallengeStatus.COMPLETED,
        type: 'Challenge',
        legacy: {},
        phases: [],
      });
      resourceApiServiceListMock.getMemberResourcesRoles.mockResolvedValue([
        {
          roleName: 'Submitter',
          roleId: CommonConfig.roles.submitterRoleId,
        },
      ]);

      const submissions = [
        {
          id: 'submission-own',
          challengeId: 'challenge-1',
          memberId: 'user-1',
          submittedDate: new Date('2025-01-02T12:00:00Z'),
          createdAt: new Date('2025-01-02T12:00:00Z'),
          updatedAt: new Date('2025-01-02T12:00:00Z'),
          type: SubmissionType.CONTEST_SUBMISSION,
          status: SubmissionStatus.COMPLETED_WITHOUT_WIN,
          review: [{ id: 'review-own' }],
          reviewSummation: [],
          legacyChallengeId: null,
          prizeId: null,
        },
        {
          id: 'submission-other',
          challengeId: 'challenge-1',
          memberId: 'user-2',
          submittedDate: new Date('2025-01-01T12:00:00Z'),
          createdAt: new Date('2025-01-01T12:00:00Z'),
          updatedAt: new Date('2025-01-01T12:00:00Z'),
          type: SubmissionType.CONTEST_SUBMISSION,
          status: SubmissionStatus.COMPLETED_WITHOUT_WIN,
          review: [{ id: 'review-other' }],
          reviewSummation: [],
          legacyChallengeId: null,
          prizeId: null,
        },
      ];

      prismaMock.submission.findMany.mockResolvedValue(
        submissions.map((entry) => ({ ...entry })),
      );
      prismaMock.submission.count.mockResolvedValue(submissions.length);
      prismaMock.submission.findFirst.mockResolvedValue({
        id: 'submission-own',
      });

      const result = await listService.listSubmission(
        {
          userId: 'user-1',
          isMachine: false,
          roles: [UserRole.User],
        } as any,
        { challengeId: 'challenge-1' } as any,
        { page: 1, perPage: 50 } as any,
      );

      const other = result.data.find(
        (entry) => entry.id === 'submission-other',
      );

      expect(other?.review).toBeDefined();
      expect(other?.memberId).toBe('user-2');
    });

    it('retains review data for marathon match submissions', async () => {
      challengeApiServiceMock.getChallengeDetail.mockResolvedValueOnce({
        id: 'challenge-1',
        status: ChallengeStatus.ACTIVE,
        type: 'Marathon Match',
        legacy: { subTrack: 'MARATHON_MATCH' },
        phases: [],
      });
      resourceApiServiceListMock.getMemberResourcesRoles.mockResolvedValue([
        {
          roleName: 'Submitter',
          roleId: CommonConfig.roles.submitterRoleId,
        },
      ]);

      const submissions = [
        {
          id: 'submission-own',
          challengeId: 'challenge-1',
          memberId: 'user-1',
          submittedDate: new Date('2025-01-02T12:00:00Z'),
          createdAt: new Date('2025-01-02T12:00:00Z'),
          updatedAt: new Date('2025-01-02T12:00:00Z'),
          type: SubmissionType.CONTEST_SUBMISSION,
          status: SubmissionStatus.ACTIVE,
          review: [{ id: 'review-own' }],
          reviewSummation: [],
          legacyChallengeId: null,
          prizeId: null,
        },
        {
          id: 'submission-other',
          challengeId: 'challenge-1',
          memberId: 'user-2',
          submittedDate: new Date('2025-01-01T12:00:00Z'),
          createdAt: new Date('2025-01-01T12:00:00Z'),
          updatedAt: new Date('2025-01-01T12:00:00Z'),
          type: SubmissionType.CONTEST_SUBMISSION,
          status: SubmissionStatus.ACTIVE,
          review: [{ id: 'review-other' }],
          reviewSummation: [],
          legacyChallengeId: null,
          prizeId: null,
        },
      ];

      prismaMock.submission.findMany.mockResolvedValue(
        submissions.map((entry) => ({ ...entry })),
      );
      prismaMock.submission.count.mockResolvedValue(submissions.length);
      prismaMock.submission.findFirst.mockResolvedValue({
        id: 'submission-own',
      });

      const result = await listService.listSubmission(
        {
          userId: 'user-1',
          isMachine: false,
          roles: [UserRole.User],
        } as any,
        { challengeId: 'challenge-1' } as any,
        { page: 1, perPage: 50 } as any,
      );

      const other = result.data.find((entry) => entry.memberId === 'user-2');

      expect(other).toBeDefined();
      expect(other?.review).toBeDefined();
      expect(other).not.toHaveProperty('id');
    });

    it('removes submitter emails from marathon match submissions for regular members', async () => {
      challengeApiServiceMock.getChallengeDetail.mockResolvedValueOnce({
        id: 'challenge-1',
        status: ChallengeStatus.ACTIVE,
        type: 'Marathon Match',
        legacy: { subTrack: 'MARATHON_MATCH' },
        phases: [],
      });
      resourceApiServiceListMock.getMemberResourcesRoles.mockResolvedValue([
        {
          roleName: 'Submitter',
          roleId: CommonConfig.roles.submitterRoleId,
        },
      ]);

      const submissions = [
        {
          id: 'submission-own',
          challengeId: 'challenge-1',
          memberId: '1001',
          submittedDate: new Date('2026-05-01T12:00:00Z'),
          createdAt: new Date('2026-05-01T12:00:00Z'),
          updatedAt: new Date('2026-05-01T12:00:00Z'),
          type: SubmissionType.CONTEST_SUBMISSION,
          status: SubmissionStatus.ACTIVE,
          review: [],
          reviewSummation: [],
          legacyChallengeId: null,
          prizeId: null,
        },
        {
          id: 'submission-other',
          challengeId: 'challenge-1',
          memberId: '1002',
          submittedDate: new Date('2026-05-01T11:00:00Z'),
          createdAt: new Date('2026-05-01T11:00:00Z'),
          updatedAt: new Date('2026-05-01T11:00:00Z'),
          type: SubmissionType.CONTEST_SUBMISSION,
          status: SubmissionStatus.ACTIVE,
          review: [],
          reviewSummation: [],
          legacyChallengeId: null,
          prizeId: null,
        },
      ];

      prismaMock.submission.findMany.mockResolvedValue(
        submissions.map((entry) => ({ ...entry })),
      );
      prismaMock.submission.count.mockResolvedValue(submissions.length);
      memberPrismaMock.member.findMany.mockResolvedValue([
        {
          userId: BigInt(1001),
          handle: 'regularMember',
          email: 'regular@example.com',
          maxRating: { rating: 1200 },
        },
        {
          userId: BigInt(1002),
          handle: 'otherMember',
          email: 'other@example.com',
          maxRating: { rating: 1400 },
        },
      ]);

      const result = await listService.listSubmission(
        {
          userId: '1001',
          isMachine: false,
          roles: [UserRole.User],
        } as any,
        { challengeId: 'challenge-1' } as any,
        { page: 1, perPage: 50 } as any,
      );

      expect(result.data).toHaveLength(2);
      expect(result.data[0]).not.toHaveProperty('submitterEmail');
      expect(result.data[1]).not.toHaveProperty('submitterEmail');
    });

    it('keeps submitter emails for challenge manager resources', async () => {
      challengeApiServiceMock.getChallengeDetail.mockResolvedValueOnce({
        id: 'challenge-1',
        status: ChallengeStatus.ACTIVE,
        type: 'Marathon Match',
        legacy: { subTrack: 'MARATHON_MATCH' },
        phases: [],
      });
      resourceApiServiceListMock.getMemberResourcesRoles.mockResolvedValue([
        {
          roleName: 'Manager',
          roleId: 'manager-role',
        },
      ]);

      const submissions = [
        {
          id: 'submission-1',
          challengeId: 'challenge-1',
          memberId: '1002',
          submittedDate: new Date('2026-05-01T11:00:00Z'),
          createdAt: new Date('2026-05-01T11:00:00Z'),
          updatedAt: new Date('2026-05-01T11:00:00Z'),
          type: SubmissionType.CONTEST_SUBMISSION,
          status: SubmissionStatus.ACTIVE,
          review: [],
          reviewSummation: [],
          legacyChallengeId: null,
          prizeId: null,
        },
      ];

      prismaMock.submission.findMany.mockResolvedValue(
        submissions.map((entry) => ({ ...entry })),
      );
      prismaMock.submission.count.mockResolvedValue(submissions.length);
      memberPrismaMock.member.findMany.mockResolvedValue([
        {
          userId: BigInt(1002),
          handle: 'otherMember',
          email: 'other@example.com',
          maxRating: { rating: 1400 },
        },
      ]);

      const result = await listService.listSubmission(
        {
          userId: 'manager-1',
          isMachine: false,
          roles: [UserRole.User],
        } as any,
        { challengeId: 'challenge-1' } as any,
        { page: 1, perPage: 50 } as any,
      );

      expect(result.data[0].submitterEmail).toBe('other@example.com');
    });

    it('masks other reviewers scores while preserving reviewer metadata on active challenges', async () => {
      const now = new Date('2025-01-05T10:00:00Z');
      resourceApiServiceListMock.getMemberResourcesRoles.mockResolvedValue([
        {
          roleName: 'Reviewer',
          id: 'resource-self',
          memberId: '101',
        },
      ]);

      const submissions = [
        {
          id: 'submission-1',
          challengeId: 'challenge-1',
          memberId: 'submitter-1',
          submittedDate: now,
          createdAt: now,
          updatedAt: now,
          type: SubmissionType.CONTEST_SUBMISSION,
          status: SubmissionStatus.ACTIVE,
          review: [
            {
              id: 'review-self',
              resourceId: 'resource-self',
              submissionId: 'submission-1',
              phaseId: 'phase-123',
              finalScore: 95,
              initialScore: 92,
              reviewItems: [
                {
                  id: 'item-self',
                  scorecardQuestionId: 'q1',
                  initialAnswer: 'YES',
                  finalAnswer: 'YES',
                  reviewItemComments: [],
                },
              ],
              createdAt: now,
              createdBy: 'reviewer',
              updatedAt: now,
              updatedBy: 'reviewer',
            },
            {
              id: 'review-other',
              resourceId: 'resource-other',
              submissionId: 'submission-1',
              phaseId: 'phase-123',
              finalScore: 80,
              initialScore: 78,
              reviewItems: [
                {
                  id: 'item-other',
                  scorecardQuestionId: 'q2',
                  initialAnswer: 'NO',
                  finalAnswer: 'NO',
                  reviewItemComments: [],
                },
              ],
              createdAt: now,
              createdBy: 'other-reviewer',
              updatedAt: now,
              updatedBy: 'other-reviewer',
            },
          ],
          reviewSummation: [],
          legacyChallengeId: null,
          prizeId: null,
        },
      ];

      prismaMock.submission.findMany.mockResolvedValue(
        submissions.map((entry) => ({ ...entry })),
      );
      prismaMock.submission.count.mockResolvedValue(submissions.length);
      prismaMock.submission.findFirst.mockResolvedValue({
        id: 'submission-1',
      });

      resourcePrismaListMock.resource.findMany.mockResolvedValue([
        { id: 'resource-self', memberId: '101' },
        { id: 'resource-other', memberId: '202' },
      ]);

      memberPrismaMock.member.findMany.mockResolvedValue([
        {
          userId: BigInt(101),
          handle: 'selfHandle',
          maxRating: { rating: 2500 },
        },
        {
          userId: BigInt(202),
          handle: 'otherHandle',
          maxRating: { rating: 1800 },
        },
      ]);

      const result = await listService.listSubmission(
        {
          userId: '101',
          isMachine: false,
          roles: [UserRole.Reviewer],
        } as any,
        { challengeId: 'challenge-1' } as any,
        { page: 1, perPage: 50 } as any,
      );

      const submissionResult = result.data.find(
        (entry) => entry.id === 'submission-1',
      );

      expect(submissionResult).toBeDefined();
      const selfReview = submissionResult?.review?.find(
        (review) => review.id === 'review-self',
      );
      const otherReview = submissionResult?.review?.find(
        (review) => review.id === 'review-other',
      );

      expect(selfReview?.initialScore).toBe(92);
      expect(selfReview?.finalScore).toBe(95);
      expect(selfReview?.reviewItems).toHaveLength(1);
      expect(selfReview?.reviewerHandle).toBe('selfHandle');
      expect(selfReview?.reviewerMaxRating).toBe(2500);

      expect(otherReview?.initialScore).toBeNull();
      expect(otherReview?.finalScore).toBeNull();
      expect(otherReview?.reviewItems).toEqual([]);
      expect(otherReview?.reviewerHandle).toBe('otherHandle');
      expect(otherReview?.reviewerMaxRating).toBe(1800);
    });

    it('preserves screening review items and scores for other reviewers', async () => {
      const now = new Date('2025-01-06T10:00:00Z');
      challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
        id: 'challenge-1',
        status: ChallengeStatus.ACTIVE,
        type: 'Challenge',
        legacy: {},
        phases: [
          {
            id: 'phase-review',
            phaseId: 'legacy-phase-review',
            name: 'Review',
          },
          {
            id: 'phase-screening',
            phaseId: 'legacy-phase-screening',
            name: 'Screening',
          },
        ],
      });
      resourceApiServiceListMock.getMemberResourcesRoles.mockResolvedValue([
        {
          roleName: 'Reviewer',
          id: 'resource-self',
          memberId: '101',
        },
      ]);

      const submissions = [
        {
          id: 'submission-2',
          challengeId: 'challenge-1',
          memberId: 'submitter-1',
          submittedDate: now,
          createdAt: now,
          updatedAt: now,
          type: SubmissionType.CONTEST_SUBMISSION,
          status: SubmissionStatus.ACTIVE,
          review: [
            {
              id: 'review-self',
              resourceId: 'resource-self',
              submissionId: 'submission-2',
              phaseId: 'phase-review',
              finalScore: 90,
              initialScore: 88,
              reviewItems: [
                {
                  id: 'item-self',
                  scorecardQuestionId: 'q1',
                  initialAnswer: 'YES',
                  finalAnswer: 'YES',
                  reviewItemComments: [],
                },
              ],
              createdAt: now,
              createdBy: 'reviewer',
              updatedAt: now,
              updatedBy: 'reviewer',
            },
            {
              id: 'review-screening',
              resourceId: 'resource-other',
              submissionId: 'submission-2',
              phaseId: 'phase-screening',
              finalScore: 75,
              initialScore: 70,
              reviewItems: [
                {
                  id: 'item-screening',
                  scorecardQuestionId: 'q2',
                  initialAnswer: 'NO',
                  finalAnswer: 'NO',
                  reviewItemComments: [],
                },
              ],
              createdAt: now,
              createdBy: 'screening-reviewer',
              updatedAt: now,
              updatedBy: 'screening-reviewer',
            },
          ],
          reviewSummation: [],
          legacyChallengeId: null,
          prizeId: null,
        },
      ];

      prismaMock.submission.findMany.mockResolvedValue(
        submissions.map((entry) => ({ ...entry })),
      );
      prismaMock.submission.count.mockResolvedValue(submissions.length);
      prismaMock.submission.findFirst.mockResolvedValue({
        id: 'submission-2',
      });

      resourcePrismaListMock.resource.findMany.mockResolvedValue([
        { id: 'resource-self', memberId: '101' },
        { id: 'resource-other', memberId: '202' },
      ]);

      memberPrismaMock.member.findMany.mockResolvedValue([
        {
          userId: BigInt(101),
          handle: 'selfHandle',
          maxRating: { rating: 2500 },
        },
        {
          userId: BigInt(202),
          handle: 'screeningHandle',
          maxRating: { rating: 2000 },
        },
      ]);

      const result = await listService.listSubmission(
        {
          userId: '101',
          isMachine: false,
          roles: [UserRole.Reviewer],
        } as any,
        { challengeId: 'challenge-1' } as any,
        { page: 1, perPage: 50 } as any,
      );

      const submissionResult = result.data.find(
        (entry) => entry.id === 'submission-2',
      );
      const screeningReview = submissionResult?.review?.find(
        (review) => review.id === 'review-screening',
      );

      expect(screeningReview).toBeDefined();
      expect(screeningReview?.initialScore).toBe(70);
      expect(screeningReview?.finalScore).toBe(75);
      expect(screeningReview?.reviewItems).toHaveLength(1);
      expect(screeningReview?.reviewerHandle).toBe('screeningHandle');
      expect(screeningReview?.reviewerMaxRating).toBe(2000);
    });

    it('exposes submitter identity but strips reviews for anonymous challenge queries', async () => {
      const now = new Date('2025-02-01T12:00:00Z');
      const submissions = [
        {
          id: 'submission-anon',
          challengeId: 'challenge-1',
          memberId: '101',
          submittedDate: now,
          createdAt: now,
          updatedAt: now,
          type: SubmissionType.CONTEST_SUBMISSION,
          status: SubmissionStatus.ACTIVE,
          review: [{ id: 'review-public', score: 100 }],
          reviewSummation: [{ id: 'summation-public' }],
          url: 'https://example.com/submission.zip',
          legacyChallengeId: null,
          prizeId: null,
        },
      ];

      prismaMock.submission.findMany.mockResolvedValue(
        submissions.map((entry) => ({ ...entry })),
      );
      prismaMock.submission.count.mockResolvedValue(submissions.length);
      prismaMock.submission.findFirst.mockResolvedValue({
        id: 'submission-anon',
      });

      memberPrismaMock.member.findMany.mockResolvedValue([
        {
          userId: BigInt(101),
          handle: 'anonUser',
          maxRating: { rating: 1500 },
        },
      ]);

      const result = await listService.listSubmission(
        { isMachine: false, roles: [] } as any,
        { challengeId: 'challenge-1' } as any,
        { page: 1, perPage: 10 } as any,
      );

      const submissionResult = result.data[0];
      expect(submissionResult.memberId).toBe('101');
      expect(submissionResult.submitterHandle).toBe('anonUser');
      expect(submissionResult.submitterMaxRating).toBe(1500);
      expect(submissionResult).not.toHaveProperty('review');
      expect(submissionResult).not.toHaveProperty('reviewSummation');
      expect(submissionResult.url).toBeNull();
    });

    it('returns safe review summation progress metadata for submissions', async () => {
      const now = new Date('2026-05-01T12:00:00Z');
      const submissions = [
        {
          id: 'submission-own',
          challengeId: 'challenge-1',
          memberId: '101',
          submittedDate: now,
          createdAt: now,
          updatedAt: now,
          type: SubmissionType.CONTEST_SUBMISSION,
          status: SubmissionStatus.ACTIVE,
          review: [],
          reviewSummation: [
            {
              id: 'summation-own',
              metadata: {
                testType: 'example',
                testProgress: 0.75,
                testStatus: 'IN PROGRESS',
                testScores: [
                  {
                    score: 42,
                    seed: 987654321,
                  },
                ],
                testProgressDetails: {
                  completedTests: 15,
                  failedTests: [{ seed: 987654321 }],
                  message: 'Completed seed 987654321',
                  progress: 0.75,
                  status: 'IN PROGRESS',
                  totalTests: 20,
                },
              },
            },
          ],
          url: 'https://example.com/submission.zip',
          legacyChallengeId: null,
          prizeId: null,
        },
      ];

      prismaMock.submission.findMany.mockResolvedValue(
        submissions.map((entry) => ({ ...entry })),
      );
      prismaMock.submission.count.mockResolvedValue(submissions.length);
      prismaMock.submission.findFirst.mockResolvedValue({
        id: 'submission-own',
      });

      const result = await listService.listSubmission(
        {
          userId: '101',
          isMachine: false,
          roles: [UserRole.User],
        } as any,
        { challengeId: 'challenge-1' } as any,
        { page: 1, perPage: 10 } as any,
      );

      const findManyArg = prismaMock.submission.findMany.mock.calls[0][0];
      expect(findManyArg.include.reviewSummation.select.metadata).toBe(true);

      const metadata = result.data[0].reviewSummation?.[0].metadata;
      expect(metadata).toEqual({
        testProgress: 0.75,
        testStatus: 'IN PROGRESS',
        testType: 'example',
        testProgressDetails: {
          completedTests: 15,
          progress: 0.75,
          status: 'IN PROGRESS',
          totalTests: 20,
        },
      });
      expect(JSON.stringify(metadata)).not.toContain('987654321');
    });
  });

  describe('createManualSubmissionUpload', () => {
    let manualUploadService: SubmissionService;
    let manualUploadResourceApiServiceMock: {
      validateSubmitterHandleRegistration: jest.Mock;
    };

    beforeEach(() => {
      manualUploadResourceApiServiceMock = {
        validateSubmitterHandleRegistration: jest.fn().mockResolvedValue({
          id: 'submitter-resource',
        }),
      };

      manualUploadService = new SubmissionService(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        manualUploadResourceApiServiceMock as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );
    });

    it('rejects manual upload for non-admin user tokens', async () => {
      await expect(
        manualUploadService.createManualSubmissionUpload(
          { isMachine: false, roles: [UserRole.User], userId: '1001' } as any,
          {
            challengeId: 'challenge-manual',
            memberId: '1001',
            type: SubmissionType.CONTEST_SUBMISSION,
          } as any,
          {
            size: 10,
            buffer: Buffer.from('1234567890'),
          } as any,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('uploads to DMZ and delegates to createSubmission with privileged bypass', async () => {
      const uploadSpy = jest
        .spyOn(manualUploadService as any, 'uploadSubmissionFileToDmz')
        .mockResolvedValue({
          url: 'https://s3.amazonaws.com/topcoder-dev-submissions-dmz/manual/challenge/member/file.zip',
          fileName: 'file.zip',
          fileSize: 512,
          fileType: 'zip',
        });
      const createSubmissionSpy = jest
        .spyOn(manualUploadService, 'createSubmission')
        .mockResolvedValue({ id: 'submission-manual' } as any);

      const body = {
        challengeId: 'challenge-manual',
        memberId: '1001',
        type: SubmissionType.CONTEST_SUBMISSION,
      } as any;
      const file = {
        originalname: 'file.zip',
        size: 512,
        buffer: Buffer.from('zip-content'),
      } as any;
      const authUser = {
        isMachine: true,
        scopes: ['create:submission'],
      } as any;

      await manualUploadService.createManualSubmissionUpload(
        authUser,
        body,
        file,
      );

      expect(uploadSpy).toHaveBeenCalledWith(authUser, body, file);
      expect(createSubmissionSpy).toHaveBeenCalledWith(
        authUser,
        expect.objectContaining({
          challengeId: 'challenge-manual',
          memberId: '1001',
          type: SubmissionType.CONTEST_SUBMISSION,
          url: 'https://s3.amazonaws.com/topcoder-dev-submissions-dmz/manual/challenge/member/file.zip',
        }),
        file,
        {
          allowPrivilegedPostSubmissionUpload: true,
          sha256Hash:
            'daf4e16539491123bf4112eb538caad1692406c99e79aed45789f25452c22108',
        },
      );
    });

    it('preserves checkpoint submission type through manual upload delegation', async () => {
      jest
        .spyOn(manualUploadService as any, 'uploadSubmissionFileToDmz')
        .mockResolvedValue({
          url: 'https://s3.amazonaws.com/topcoder-dev-submissions-dmz/manual/challenge/member/checkpoint.zip',
          fileName: 'checkpoint.zip',
          fileSize: 512,
          fileType: 'zip',
        });
      const createSubmissionSpy = jest
        .spyOn(manualUploadService, 'createSubmission')
        .mockResolvedValue({ id: 'submission-checkpoint-manual' } as any);

      const authUser = {
        isMachine: true,
        scopes: ['create:submission'],
      } as any;
      const body = {
        challengeId: 'challenge-manual',
        memberId: '1001',
        type: SubmissionType.CHECKPOINT_SUBMISSION,
      } as any;
      const file = {
        originalname: 'checkpoint.zip',
        size: 512,
        buffer: Buffer.from('zip-content'),
      } as any;

      await manualUploadService.createManualSubmissionUpload(
        authUser,
        body,
        file,
      );

      expect(createSubmissionSpy).toHaveBeenCalledWith(
        authUser,
        expect.objectContaining({
          challengeId: 'challenge-manual',
          memberId: '1001',
          type: SubmissionType.CHECKPOINT_SUBMISSION,
          url: 'https://s3.amazonaws.com/topcoder-dev-submissions-dmz/manual/challenge/member/checkpoint.zip',
        }),
        file,
        {
          allowPrivilegedPostSubmissionUpload: true,
          sha256Hash:
            'daf4e16539491123bf4112eb538caad1692406c99e79aed45789f25452c22108',
        },
      );
    });

    it('validates the provided submitter handle against challenge resources before uploading', async () => {
      const uploadSpy = jest
        .spyOn(manualUploadService as any, 'uploadSubmissionFileToDmz')
        .mockResolvedValue({
          url: 'https://s3.amazonaws.com/topcoder-dev-submissions-dmz/manual/challenge/member/file.zip',
          fileName: 'file.zip',
          fileSize: 512,
          fileType: 'zip',
        });
      jest
        .spyOn(manualUploadService, 'createSubmission')
        .mockResolvedValue({ id: 'submission-manual' } as any);

      await manualUploadService.createManualSubmissionUpload(
        { isMachine: true, scopes: ['create:submission'] } as any,
        {
          challengeId: 'challenge-manual',
          memberId: '1001',
          memberHandle: 'submitterOne',
          type: SubmissionType.CONTEST_SUBMISSION,
        } as any,
        {
          originalname: 'file.zip',
          size: 512,
          buffer: Buffer.from('zip-content'),
        } as any,
      );

      expect(
        manualUploadResourceApiServiceMock.validateSubmitterHandleRegistration,
      ).toHaveBeenCalledWith('challenge-manual', 'submitterOne', '1001');
      expect(uploadSpy).toHaveBeenCalled();
    });

    it('returns bad request when the provided submitter handle is not registered on the challenge', async () => {
      manualUploadResourceApiServiceMock.validateSubmitterHandleRegistration.mockRejectedValue(
        new Error(
          'Handle unknownSubmitter is not registered as a submitter for challenge challenge-manual.',
        ),
      );
      const uploadSpy = jest.spyOn(
        manualUploadService as any,
        'uploadSubmissionFileToDmz',
      );

      await expect(
        manualUploadService.createManualSubmissionUpload(
          { isMachine: true, scopes: ['create:submission'] } as any,
          {
            challengeId: 'challenge-manual',
            memberId: '1001',
            memberHandle: 'unknownSubmitter',
            type: SubmissionType.CONTEST_SUBMISSION,
          } as any,
          {
            originalname: 'file.zip',
            size: 512,
            buffer: Buffer.from('zip-content'),
          } as any,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'INVALID_SUBMITTER_HANDLE',
          message:
            'Handle unknownSubmitter is not registered as a submitter for challenge challenge-manual.',
        }),
      });

      expect(uploadSpy).not.toHaveBeenCalled();
    });
  });

  describe('createSubmission privileged manual upload phase validation', () => {
    let prismaMock: { submission: { create: jest.Mock } };
    let challengeApiServiceMock: {
      validateChallengeExists: jest.Mock;
      validateSubmissionCreation: jest.Mock;
      validateCheckpointSubmissionCreation: jest.Mock;
      validateFinalFixSubmissionCreation: jest.Mock;
      isPhaseOpen: jest.Mock;
    };
    let resourceApiServiceMock: { validateSubmitterRegistration: jest.Mock };
    let challengeCatalogServiceMock: {
      ensureSubmissionTypeAllowed: jest.Mock;
    };
    let challengePrismaMock: {
      $executeRaw: jest.Mock;
      $queryRaw: jest.Mock;
    };
    let createService: SubmissionService;
    let originalManualUploadAllowOpenSubmissionPhase: string | undefined;

    const buildCreatedSubmission = () => ({
      challengeId: 'challenge-manual',
      createdAt: new Date('2026-02-01T12:00:00Z'),
      createdBy: '1001',
      eventRaised: false,
      fileType: 'zip',
      id: 'submission-manual',
      isFileSubmission: true,
      legacyChallengeId: null,
      legacySubmissionId: null,
      legacyUploadId: null,
      memberId: '1001',
      prizeId: null,
      status: SubmissionStatus.ACTIVE,
      submissionPhaseId: 'phase-manual',
      submittedDate: new Date('2026-02-01T12:00:00Z'),
      systemFileName: 'manual-submission.zip',
      type: SubmissionType.CONTEST_SUBMISSION,
      updatedAt: new Date('2026-02-01T12:00:00Z'),
      updatedBy: '1001',
      url: 'https://s3.amazonaws.com/topcoder-dev-submissions-dmz/manual-submission.zip',
      virusScan: false,
      viewCount: 0,
    });

    const createBody = () => ({
      challengeId: 'challenge-manual',
      memberId: '1001',
      type: SubmissionType.CONTEST_SUBMISSION,
      url: 'https://s3.amazonaws.com/topcoder-dev-submissions-dmz/manual-submission.zip',
    });

    beforeEach(() => {
      originalManualUploadAllowOpenSubmissionPhase =
        process.env.MANUAL_UPLOAD_ALLOW_OPEN_SUBMISSION_PHASE;
      delete process.env.MANUAL_UPLOAD_ALLOW_OPEN_SUBMISSION_PHASE;

      prismaMock = {
        submission: {
          create: jest.fn(),
        },
      };
      challengeApiServiceMock = {
        validateChallengeExists: jest.fn().mockResolvedValue({
          id: 'challenge-manual',
          legacy: {},
          status: ChallengeStatus.ACTIVE,
          track: 'Development',
          type: 'Challenge',
        }),
        validateSubmissionCreation: jest.fn().mockResolvedValue(undefined),
        validateCheckpointSubmissionCreation: jest
          .fn()
          .mockResolvedValue(undefined),
        validateFinalFixSubmissionCreation: jest
          .fn()
          .mockResolvedValue(undefined),
        isPhaseOpen: jest.fn(),
      };
      resourceApiServiceMock = {
        validateSubmitterRegistration: jest.fn().mockResolvedValue(undefined),
      };
      challengeCatalogServiceMock = {
        ensureSubmissionTypeAllowed: jest.fn(),
      };
      challengePrismaMock = {
        $executeRaw: jest.fn().mockResolvedValue(1),
        $queryRaw: jest.fn().mockResolvedValue([]),
      };

      createService = new SubmissionService(
        prismaMock as any,
        { handleError: jest.fn() } as any,
        challengePrismaMock as any,
        challengeApiServiceMock as any,
        resourceApiServiceMock as any,
        {} as any,
        { publish: jest.fn() } as any,
        challengeCatalogServiceMock as any,
        {} as any,
      );

      jest
        .spyOn(createService as any, 'publishSubmissionCreateEvent')
        .mockResolvedValue(undefined);
      jest
        .spyOn(createService as any, 'publishTopgearSubmissionEventIfEligible')
        .mockResolvedValue(undefined);
      jest
        .spyOn(createService as any, 'publishSubmissionScanEvent')
        .mockResolvedValue(undefined);
      jest
        .spyOn(createService as any, 'populateLatestSubmissionFlags')
        .mockResolvedValue(undefined);
      jest
        .spyOn(createService as any, 'stripIsLatestForUnlimitedChallenges')
        .mockResolvedValue(undefined);
    });

    afterEach(() => {
      if (originalManualUploadAllowOpenSubmissionPhase === undefined) {
        delete process.env.MANUAL_UPLOAD_ALLOW_OPEN_SUBMISSION_PHASE;
      } else {
        process.env.MANUAL_UPLOAD_ALLOW_OPEN_SUBMISSION_PHASE =
          originalManualUploadAllowOpenSubmissionPhase;
      }
    });

    it('allows privileged manual upload when submission phase is closed and review phase is open', async () => {
      prismaMock.submission.create.mockResolvedValue(buildCreatedSubmission());
      challengeApiServiceMock.isPhaseOpen
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      await createService.createSubmission(
        { isMachine: true } as any,
        createBody() as any,
        undefined,
        { allowPrivilegedPostSubmissionUpload: true },
      );

      expect(
        challengeApiServiceMock.validateSubmissionCreation,
      ).not.toHaveBeenCalled();
      expect(challengeApiServiceMock.isPhaseOpen).toHaveBeenNthCalledWith(
        1,
        'challenge-manual',
        ['Submission', 'Topgear Submission'],
      );
      expect(challengeApiServiceMock.isPhaseOpen).toHaveBeenNthCalledWith(
        2,
        'challenge-manual',
        ['AI Screening', 'Screening', 'Review', 'Iterative Review', 'Approval'],
      );
      expect(prismaMock.submission.create).toHaveBeenCalled();
    });

    it('allows privileged manual upload when submission phase is closed and AI screening phase is open', async () => {
      prismaMock.submission.create.mockResolvedValue(buildCreatedSubmission());
      challengeApiServiceMock.isPhaseOpen
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      await createService.createSubmission(
        { isMachine: true } as any,
        createBody() as any,
        undefined,
        { allowPrivilegedPostSubmissionUpload: true },
      );

      expect(challengeApiServiceMock.isPhaseOpen).toHaveBeenNthCalledWith(
        1,
        'challenge-manual',
        ['Submission', 'Topgear Submission'],
      );
      expect(challengeApiServiceMock.isPhaseOpen).toHaveBeenNthCalledWith(
        2,
        'challenge-manual',
        ['AI Screening', 'Screening', 'Review', 'Iterative Review', 'Approval'],
      );
      expect(prismaMock.submission.create).toHaveBeenCalled();
    });

    it('allows privileged manual upload during checkpoint screening after checkpoint submission closes', async () => {
      prismaMock.submission.create.mockResolvedValue({
        ...buildCreatedSubmission(),
        type: SubmissionType.CHECKPOINT_SUBMISSION,
      });
      challengeApiServiceMock.isPhaseOpen
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      await createService.createSubmission(
        { isMachine: true } as any,
        {
          ...createBody(),
          type: SubmissionType.CHECKPOINT_SUBMISSION,
        } as any,
        undefined,
        { allowPrivilegedPostSubmissionUpload: true },
      );

      expect(
        challengeApiServiceMock.validateCheckpointSubmissionCreation,
      ).not.toHaveBeenCalled();
      expect(challengeApiServiceMock.isPhaseOpen).toHaveBeenNthCalledWith(
        1,
        'challenge-manual',
        ['Checkpoint Submission'],
      );
      expect(challengeApiServiceMock.isPhaseOpen).toHaveBeenNthCalledWith(
        2,
        'challenge-manual',
        ['Checkpoint Screening', 'Checkpoint Review'],
      );
      expect(prismaMock.submission.create).toHaveBeenCalled();
    });

    it('allows privileged manual upload while submission phase is open when explicitly configured', async () => {
      process.env.MANUAL_UPLOAD_ALLOW_OPEN_SUBMISSION_PHASE = 'true';
      prismaMock.submission.create.mockResolvedValue(buildCreatedSubmission());
      challengeApiServiceMock.isPhaseOpen.mockResolvedValueOnce(true);

      await createService.createSubmission(
        { isMachine: true } as any,
        createBody() as any,
        undefined,
        { allowPrivilegedPostSubmissionUpload: true },
      );

      expect(
        challengeApiServiceMock.validateSubmissionCreation,
      ).not.toHaveBeenCalled();
      expect(challengeApiServiceMock.isPhaseOpen).toHaveBeenCalledTimes(1);
      expect(challengeApiServiceMock.isPhaseOpen).toHaveBeenNthCalledWith(
        1,
        'challenge-manual',
        ['Submission', 'Topgear Submission'],
      );
      expect(prismaMock.submission.create).toHaveBeenCalled();
    });

    it('rejects privileged manual upload while submission phase is still open', async () => {
      challengeApiServiceMock.isPhaseOpen.mockResolvedValueOnce(true);

      await expect(
        createService.createSubmission(
          { isMachine: true } as any,
          createBody() as any,
          undefined,
          { allowPrivilegedPostSubmissionUpload: true },
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'MANUAL_UPLOAD_PHASE_INVALID',
        }),
      });
      expect(prismaMock.submission.create).not.toHaveBeenCalled();
    });

    it('persists the SHA-256 digest of the uploaded file buffer without reading S3', async () => {
      prismaMock.submission.create.mockResolvedValue(buildCreatedSubmission());
      challengeApiServiceMock.isPhaseOpen
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      const getS3ClientSpy = jest.spyOn(createService as any, 'getS3Client');

      await createService.createSubmission(
        { isMachine: true } as any,
        createBody() as any,
        {
          buffer: Buffer.from('zip-content'),
          originalname: 'manual-submission.zip',
          size: 11,
        } as any,
        { allowPrivilegedPostSubmissionUpload: true },
      );

      expect(prismaMock.submission.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          sha256Hash:
            'daf4e16539491123bf4112eb538caad1692406c99e79aed45789f25452c22108',
        }),
      });
      expect(getS3ClientSpy).not.toHaveBeenCalled();
    });

    it('prefers a pre-computed digest supplied by the caller', async () => {
      prismaMock.submission.create.mockResolvedValue(buildCreatedSubmission());
      challengeApiServiceMock.isPhaseOpen
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      await createService.createSubmission(
        { isMachine: true } as any,
        createBody() as any,
        {
          buffer: Buffer.from('zip-content'),
          originalname: 'manual-submission.zip',
          size: 11,
        } as any,
        {
          allowPrivilegedPostSubmissionUpload: true,
          sha256Hash: 'a'.repeat(64),
        },
      );

      expect(prismaMock.submission.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ sha256Hash: 'a'.repeat(64) }),
      });
    });

    it('hashes the S3 object when the front end uploaded the file and posted only a URL', async () => {
      prismaMock.submission.create.mockResolvedValue(buildCreatedSubmission());
      challengeApiServiceMock.isPhaseOpen
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      const s3Send = jest
        .fn()
        .mockResolvedValueOnce({ ContentLength: 15 })
        .mockResolvedValueOnce({
          Body: Readable.from([Buffer.from('s3-object-bytes')]),
        });
      jest
        .spyOn(createService as any, 'getS3Client')
        .mockReturnValue({ send: s3Send });

      await createService.createSubmission(
        { isMachine: true } as any,
        createBody() as any,
        undefined,
        { allowPrivilegedPostSubmissionUpload: true },
      );

      expect(s3Send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand);
      expect(s3Send.mock.calls[1][0]).toBeInstanceOf(GetObjectCommand);
      expect(s3Send.mock.calls[1][0].input).toMatchObject({
        Bucket: 'topcoder-dev-submissions-dmz',
        Key: 'manual-submission.zip',
      });
      expect(prismaMock.submission.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          sha256Hash:
            '5c17556ec22abf759e6da8c9731e4c0533a10c0925dc9aa17fba542b1ec4f1de',
        }),
      });
    });

    it('still creates the submission when the S3 object cannot be hashed', async () => {
      prismaMock.submission.create.mockResolvedValue(buildCreatedSubmission());
      challengeApiServiceMock.isPhaseOpen
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      jest.spyOn(createService as any, 'getS3Client').mockReturnValue({
        send: jest.fn().mockRejectedValue(new Error('AccessDenied')),
      });

      await createService.createSubmission(
        { isMachine: true } as any,
        createBody() as any,
        undefined,
        { allowPrivilegedPostSubmissionUpload: true },
      );

      expect(prismaMock.submission.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ sha256Hash: null }),
      });
    });

    it('skips hashing objects larger than the configured byte limit', async () => {
      prismaMock.submission.create.mockResolvedValue(buildCreatedSubmission());
      challengeApiServiceMock.isPhaseOpen
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      const s3Send = jest.fn().mockResolvedValue({ ContentLength: 1024 });
      jest
        .spyOn(createService as any, 'getS3Client')
        .mockReturnValue({ send: s3Send });
      process.env.SUBMISSION_SHA256_MAX_BYTES = '512';

      try {
        await createService.createSubmission(
          { isMachine: true } as any,
          createBody() as any,
          undefined,
          { allowPrivilegedPostSubmissionUpload: true },
        );
      } finally {
        delete process.env.SUBMISSION_SHA256_MAX_BYTES;
      }

      expect(s3Send).toHaveBeenCalledTimes(1);
      expect(prismaMock.submission.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ sha256Hash: null }),
      });
    });

    it('leaves the digest null when the submission is not backed by an S3 object', async () => {
      prismaMock.submission.create.mockResolvedValue(buildCreatedSubmission());
      challengeApiServiceMock.isPhaseOpen
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      const getS3ClientSpy = jest.spyOn(createService as any, 'getS3Client');
      jest
        .spyOn(
          createService as any,
          'publishFirst2FinishSubmissionEventIfEligible',
        )
        .mockResolvedValue(undefined);

      await createService.createSubmission(
        { isMachine: true } as any,
        {
          ...createBody(),
          url: 'https://wipro.sharepoint.com/sites/x/submission.docx',
        } as any,
        undefined,
        { allowPrivilegedPostSubmissionUpload: true },
      );

      expect(getS3ClientSpy).not.toHaveBeenCalled();
      expect(prismaMock.submission.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ sha256Hash: null }),
      });
    });
  });

  describe('createSubmission finite Design limits', () => {
    let transactionClient: {
      $executeRaw: jest.Mock;
      submission: {
        count: jest.Mock;
        create: jest.Mock;
      };
    };
    let prismaMock: {
      $transaction: jest.Mock;
      submission: {
        create: jest.Mock;
      };
    };
    let createService: SubmissionService;

    const limitedDesignChallenge = {
      id: 'challenge-limited-design',
      legacy: {},
      metadata: {
        submissionLimit: JSON.stringify({
          count: '2',
          limit: 'true',
          unlimited: 'false',
        }),
      },
      status: ChallengeStatus.ACTIVE,
      track: 'Design',
      type: 'Challenge',
    };
    const submissionBody = {
      challengeId: 'challenge-limited-design',
      memberId: '1001',
      type: SubmissionType.CONTEST_SUBMISSION,
      url: 'https://example.com/submission.zip',
    };
    const submissionData = {
      ...submissionBody,
      isFileSubmission: true,
      status: SubmissionStatus.ACTIVE,
      virusScan: false,
    };

    beforeEach(() => {
      transactionClient = {
        $executeRaw: jest.fn().mockResolvedValue(0),
        submission: {
          count: jest.fn().mockResolvedValue(1),
          create: jest.fn().mockResolvedValue({ id: 'created-submission' }),
        },
      };
      prismaMock = {
        $transaction: jest.fn((callback) => callback(transactionClient)),
        submission: {
          create: jest.fn().mockResolvedValue({ id: 'uncapped-submission' }),
        },
      };
      createService = new SubmissionService(
        prismaMock as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );
    });

    it('locks, counts, and creates in one transaction while below the limit', async () => {
      await expect(
        (createService as any).createSubmissionWithLimit(
          limitedDesignChallenge,
          submissionBody,
          submissionData,
        ),
      ).resolves.toEqual({ id: 'created-submission' });

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(transactionClient.$executeRaw).toHaveBeenCalledTimes(1);
      expect(transactionClient.submission.count).toHaveBeenCalledWith({
        where: {
          challengeId: submissionBody.challengeId,
          memberId: submissionBody.memberId,
          type: SubmissionType.CONTEST_SUBMISSION,
          status: { not: SubmissionStatus.DELETED },
        },
      });
      expect(transactionClient.submission.create).toHaveBeenCalledWith({
        data: submissionData,
      });
      expect(prismaMock.submission.create).not.toHaveBeenCalled();
      expect(
        transactionClient.$executeRaw.mock.invocationCallOrder[0],
      ).toBeLessThan(
        transactionClient.submission.count.mock.invocationCallOrder[0],
      );
      expect(
        transactionClient.submission.count.mock.invocationCallOrder[0],
      ).toBeLessThan(
        transactionClient.submission.create.mock.invocationCallOrder[0],
      );
    });

    it.each(['count', 'max', 'maximum', 'limitCount', 'value'])(
      'atomically enforces the legacy finite %s alias',
      async (countField) => {
        const challenge = {
          ...limitedDesignChallenge,
          metadata: {
            submissionLimit: JSON.stringify({
              [countField]: '2',
              limit: 'yes',
              unlimited: 'no',
            }),
          },
        };

        await expect(
          (createService as any).createSubmissionWithLimit(
            challenge,
            submissionBody,
            submissionData,
          ),
        ).resolves.toEqual({ id: 'created-submission' });

        expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
        expect(transactionClient.$executeRaw).toHaveBeenCalledTimes(1);
        expect(transactionClient.submission.count).toHaveBeenCalledTimes(1);
        expect(transactionClient.submission.create).toHaveBeenCalledTimes(1);
      },
    );

    it('rejects atomically when the finite limit is already reached', async () => {
      transactionClient.submission.count.mockResolvedValue(2);

      await expect(
        (createService as any).createSubmissionWithLimit(
          limitedDesignChallenge,
          submissionBody,
          submissionData,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'SUBMISSION_LIMIT_REACHED',
          details: expect.objectContaining({
            submissionLimit: 2,
            existingSubmissionCount: 2,
          }),
        }),
      });

      expect(transactionClient.submission.create).not.toHaveBeenCalled();
    });

    it('counts checkpoint and contest submissions independently', async () => {
      const checkpointBody = {
        ...submissionBody,
        type: SubmissionType.CHECKPOINT_SUBMISSION,
      };

      await (createService as any).createSubmissionWithLimit(
        limitedDesignChallenge,
        checkpointBody,
        { ...submissionData, type: SubmissionType.CHECKPOINT_SUBMISSION },
      );

      expect(transactionClient.submission.count).toHaveBeenCalledWith({
        where: expect.objectContaining({
          challengeId: submissionBody.challengeId,
          memberId: submissionBody.memberId,
          type: SubmissionType.CHECKPOINT_SUBMISSION,
        }),
      });
      const advisoryLock = transactionClient.$executeRaw.mock.calls[0][0] as {
        strings: string[];
        values: unknown[];
      };
      expect(advisoryLock.strings.join(' ')).toContain('pg_advisory_xact_lock');
      expect(advisoryLock.values).toContain(
        `design-submission-limit:${submissionBody.challengeId}:${submissionBody.memberId}:${SubmissionType.CHECKPOINT_SUBMISSION}`,
      );
    });

    it.each([
      {
        description: 'missing Design metadata',
        challenge: { ...limitedDesignChallenge, metadata: undefined },
      },
      {
        description: 'malformed Design metadata',
        challenge: {
          ...limitedDesignChallenge,
          metadata: { submissionLimit: '{invalid' },
        },
      },
      {
        description: 'contradictory Design metadata',
        challenge: {
          ...limitedDesignChallenge,
          metadata: {
            submissionLimit: JSON.stringify({
              max: '2',
              limit: 'yes',
              unlimited: 1,
            }),
          },
        },
      },
      {
        description: 'explicitly unlimited Design metadata',
        challenge: {
          ...limitedDesignChallenge,
          metadata: {
            submissionLimit: JSON.stringify({
              max: '2',
              limit: 'no',
              unlimited: 'yes',
            }),
          },
        },
      },
      {
        description: 'non-Design challenge',
        challenge: { ...limitedDesignChallenge, track: 'Development' },
      },
    ])('leaves creation uncapped for $description', async ({ challenge }) => {
      await expect(
        (createService as any).createSubmissionWithLimit(
          challenge,
          submissionBody,
          submissionData,
        ),
      ).resolves.toEqual({ id: 'uncapped-submission' });

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(prismaMock.submission.create).toHaveBeenCalledWith({
        data: submissionData,
      });
    });

    it('serializes competing requests for the final available slot', async () => {
      let storedSubmissionCount = 1;
      let lockTail = Promise.resolve();
      prismaMock.$transaction.mockImplementation(async (callback) => {
        const previousLock = lockTail;
        let releaseLock: () => void = () => undefined;
        lockTail = new Promise<void>((resolve) => {
          releaseLock = resolve;
        });
        await previousLock;

        const serializedClient = {
          $executeRaw: jest.fn().mockResolvedValue(0),
          submission: {
            count: jest.fn().mockImplementation(() => storedSubmissionCount),
            create: jest.fn().mockImplementation(() => {
              storedSubmissionCount += 1;
              return { id: `submission-${storedSubmissionCount}` };
            }),
          },
        };

        try {
          return await callback(serializedClient);
        } finally {
          releaseLock();
        }
      });

      const results = await Promise.allSettled([
        (createService as any).createSubmissionWithLimit(
          limitedDesignChallenge,
          submissionBody,
          submissionData,
        ),
        (createService as any).createSubmissionWithLimit(
          limitedDesignChallenge,
          submissionBody,
          submissionData,
        ),
      ]);

      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === 'rejected'),
      ).toHaveLength(1);
      expect(storedSubmissionCount).toBe(2);
    });
  });

  describe('ensurePendingReviewsForSubmission', () => {
    it('creates pending reviews for open phases using challenge reviewer configuration', async () => {
      const prismaMock = {
        submission: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'submission-1',
            challengeId: 'challenge-1',
            type: SubmissionType.CONTEST_SUBMISSION,
            virusScan: true,
          }),
        },
        scorecard: {
          findMany: jest
            .fn()
            .mockResolvedValue([
              { id: 'scorecard-1', type: ScorecardType.REVIEW },
            ]),
        },
        reviewType: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ id: 'review-type-1', name: 'Review' }]),
        },
        review: {
          createMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        aiReviewDecision: {
          findFirst: jest.fn(),
        },
      };
      const challengePrismaMock = {
        $queryRaw: jest.fn().mockResolvedValue([
          {
            scorecardId: 'scorecard-1',
            templatePhaseId: 'phase-template-review',
            challengePhaseId: 'challenge-phase-review',
            phaseName: 'Review',
          },
        ]),
      };
      const challengeApiServiceMock = {
        getChallengeDetail: jest.fn().mockResolvedValue({
          id: 'challenge-1',
          phases: [
            {
              id: 'challenge-phase-review',
              name: 'Review',
              isOpen: true,
            },
          ],
        }),
      };
      const resourceApiServiceMock = {
        getResources: jest.fn().mockResolvedValue([
          {
            id: 'resource-reviewer-1',
            challengeId: 'challenge-1',
            memberId: '2001',
            memberHandle: 'reviewerOne',
            roleId: 'role-reviewer',
            phaseId: 'challenge-phase-review',
            createdBy: 'system',
            created: new Date().toISOString(),
          },
        ]),
        getResourceRoles: jest.fn().mockResolvedValue({
          'role-reviewer': {
            id: 'role-reviewer',
            name: 'Reviewer',
          },
        }),
      };

      const pendingReviewService = new SubmissionService(
        prismaMock as any,
        {} as any,
        challengePrismaMock as any,
        challengeApiServiceMock as any,
        resourceApiServiceMock as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );

      const created =
        await pendingReviewService.ensurePendingReviewsForSubmission(
          'submission-1',
          { triggerSource: 'unit-test' },
        );

      expect(created).toBe(1);
      expect(prismaMock.review.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skipDuplicates: true,
          data: expect.arrayContaining([
            expect.objectContaining({
              submissionId: 'submission-1',
              resourceId: 'resource-reviewer-1',
              phaseId: 'challenge-phase-review',
              scorecardId: 'scorecard-1',
              typeId: 'review-type-1',
              status: ReviewStatus.PENDING,
            }),
          ]),
        }),
      );
    });

    it.each([
      {
        phaseName: 'Screening',
        reviewTypeName: 'Screening',
        scorecardType: ScorecardType.SCREENING,
        submissionType: SubmissionType.CONTEST_SUBMISSION,
      },
      {
        phaseName: 'Checkpoint Screening',
        reviewTypeName: 'Checkpoint Screening',
        scorecardType: ScorecardType.CHECKPOINT_SCREENING,
        submissionType: SubmissionType.CHECKPOINT_SUBMISSION,
      },
    ])(
      'creates $phaseName reviews for a Design submission within latest X',
      async ({ phaseName, reviewTypeName, scorecardType, submissionType }) => {
        const prismaMock = {
          submission: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'submission-ranked',
              challengeId: 'challenge-ranked',
              memberId: 'member-ranked',
              type: submissionType,
              virusScan: true,
            }),
          },
          scorecard: {
            findMany: jest
              .fn()
              .mockResolvedValue([
                { id: 'scorecard-ranked', type: scorecardType },
              ]),
          },
          reviewType: {
            findMany: jest
              .fn()
              .mockResolvedValue([
                { id: 'review-type-ranked', name: reviewTypeName },
              ]),
          },
          review: {
            createMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          aiReviewConfig: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
          $queryRaw: jest
            .fn()
            .mockResolvedValue([{ submissionRank: BigInt(2) }]),
        };
        const challengePrismaMock = {
          $queryRaw: jest.fn().mockResolvedValue([
            {
              scorecardId: 'scorecard-ranked',
              templatePhaseId: 'phase-template-ranked',
              challengePhaseId: 'challenge-phase-ranked',
              phaseName,
            },
          ]),
        };
        const challengeApiServiceMock = {
          getChallengeDetail: jest.fn().mockResolvedValue({
            id: 'challenge-ranked',
            track: 'Design',
            metadata: {
              submissionLimit: JSON.stringify({
                count: '2',
                limit: 'true',
                unlimited: 'false',
              }),
            },
            phases: [
              {
                id: 'challenge-phase-ranked',
                name: phaseName,
                isOpen: true,
              },
            ],
          }),
        };
        const resourceApiServiceMock = {
          getResources: jest.fn().mockResolvedValue([
            {
              id: 'resource-ranked',
              challengeId: 'challenge-ranked',
              memberId: 'reviewer-ranked',
              memberHandle: 'reviewerRanked',
              roleId: 'role-ranked',
              phaseId: 'challenge-phase-ranked',
              createdBy: 'system',
              created: new Date().toISOString(),
            },
          ]),
          getResourceRoles: jest.fn().mockResolvedValue({
            'role-ranked': { id: 'role-ranked', name: reviewTypeName },
          }),
        };
        const pendingReviewService = new SubmissionService(
          prismaMock as any,
          {} as any,
          challengePrismaMock as any,
          challengeApiServiceMock as any,
          resourceApiServiceMock as any,
          {} as any,
          {} as any,
          {} as any,
          {} as any,
        );

        await expect(
          pendingReviewService.ensurePendingReviewsForSubmission(
            'submission-ranked',
            { triggerSource: 'unit-test' },
          ),
        ).resolves.toBe(1);

        const rankQuery = prismaMock.$queryRaw.mock.calls[0][0] as {
          strings: string[];
          values: unknown[];
        };
        expect(rankQuery.strings.join(' ')).toContain(
          'PARTITION BY COALESCE(s."memberId", s."id"), s."type"',
        );
        expect(rankQuery.strings.join(' ')).toContain(
          's."status" IS NULL OR s."status" <> \'DELETED\'',
        );
        expect(rankQuery.values).toContain(submissionType);
        expect(prismaMock.review.createMany).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.arrayContaining([
              expect.objectContaining({ submissionId: 'submission-ranked' }),
            ]),
          }),
        );
      },
    );

    it('skips a Design screening submission outside latest X', async () => {
      const prismaMock = {
        submission: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'submission-too-old',
            challengeId: 'challenge-ranked',
            memberId: 'member-ranked',
            type: SubmissionType.CONTEST_SUBMISSION,
            virusScan: true,
          }),
        },
        scorecard: {
          findMany: jest
            .fn()
            .mockResolvedValue([
              { id: 'scorecard-screening', type: ScorecardType.SCREENING },
            ]),
        },
        reviewType: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ id: 'type-screening', name: 'Screening' }]),
        },
        review: { createMany: jest.fn() },
        aiReviewConfig: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
        $queryRaw: jest.fn().mockResolvedValue([{ submissionRank: BigInt(3) }]),
      };
      const pendingReviewService = new SubmissionService(
        prismaMock as any,
        {} as any,
        {
          $queryRaw: jest.fn().mockResolvedValue([
            {
              scorecardId: 'scorecard-screening',
              templatePhaseId: 'template-screening',
              challengePhaseId: 'phase-screening',
              phaseName: 'Screening',
            },
          ]),
        } as any,
        {
          getChallengeDetail: jest.fn().mockResolvedValue({
            id: 'challenge-ranked',
            track: 'Design',
            metadata: {
              submissionLimit: JSON.stringify({
                count: '2',
                limit: 'true',
                unlimited: 'false',
              }),
            },
            phases: [
              { id: 'phase-screening', name: 'Screening', isOpen: true },
            ],
          }),
        } as any,
        {
          getResources: jest.fn().mockResolvedValue([]),
          getResourceRoles: jest.fn().mockResolvedValue({}),
        } as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );

      await expect(
        pendingReviewService.ensurePendingReviewsForSubmission(
          'submission-too-old',
          { triggerSource: 'unit-test' },
        ),
      ).resolves.toBe(0);
      expect(prismaMock.review.createMany).not.toHaveBeenCalled();
    });

    it.each([
      {
        phaseName: 'Review',
        precedingPhaseName: 'Screening',
        scorecardType: ScorecardType.REVIEW,
        screeningScorecardType: ScorecardType.SCREENING,
        submissionType: SubmissionType.CONTEST_SUBMISSION,
      },
      {
        phaseName: 'Checkpoint Review',
        precedingPhaseName: 'Checkpoint Screening',
        scorecardType: ScorecardType.CHECKPOINT_REVIEW,
        screeningScorecardType: ScorecardType.CHECKPOINT_SCREENING,
        submissionType: SubmissionType.CHECKPOINT_SUBMISSION,
      },
    ])(
      'requires a passing $precedingPhaseName before $phaseName creation',
      async ({
        phaseName,
        precedingPhaseName,
        scorecardType,
        screeningScorecardType,
        submissionType,
      }) => {
        const prismaMock = {
          submission: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'submission-screened',
              challengeId: 'challenge-screened',
              memberId: null,
              type: submissionType,
              virusScan: true,
            }),
          },
          scorecard: {
            findMany: jest
              .fn()
              .mockResolvedValue([
                { id: 'scorecard-review', type: scorecardType },
              ]),
          },
          reviewType: {
            findMany: jest
              .fn()
              .mockResolvedValue([{ id: 'review-type', name: phaseName }]),
          },
          review: {
            createMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          aiReviewConfig: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
          $queryRaw: jest.fn().mockResolvedValue([{ passed: true }]),
        };
        const challengePrismaMock = {
          $queryRaw: jest.fn().mockResolvedValue([
            {
              scorecardId: 'scorecard-review',
              templatePhaseId: 'template-review',
              challengePhaseId: 'phase-review',
              phaseName,
            },
          ]),
        };
        const challengeApiServiceMock = {
          getChallengeDetail: jest.fn().mockResolvedValue({
            id: 'challenge-screened',
            track: 'Design',
            phases: [
              {
                id: 'phase-screening',
                name: precedingPhaseName,
                isOpen: false,
              },
              { id: 'phase-review', name: phaseName, isOpen: true },
            ],
          }),
        };
        const resourceApiServiceMock = {
          getResources: jest.fn().mockResolvedValue([
            {
              id: 'resource-review',
              challengeId: 'challenge-screened',
              memberId: 'reviewer',
              memberHandle: 'reviewer',
              roleId: 'role-review',
              phaseId: 'phase-review',
              createdBy: 'system',
              created: new Date().toISOString(),
            },
          ]),
          getResourceRoles: jest.fn().mockResolvedValue({
            'role-review': { id: 'role-review', name: phaseName },
          }),
        };
        const pendingReviewService = new SubmissionService(
          prismaMock as any,
          {} as any,
          challengePrismaMock as any,
          challengeApiServiceMock as any,
          resourceApiServiceMock as any,
          {} as any,
          {} as any,
          {} as any,
          {} as any,
        );

        await expect(
          pendingReviewService.ensurePendingReviewsForSubmission(
            'submission-screened',
            { triggerSource: 'unit-test' },
          ),
        ).resolves.toBe(1);

        const passingQuery = prismaMock.$queryRaw.mock.calls[0][0] as {
          strings: string[];
          values: unknown[];
        };
        expect(passingQuery.strings.join(' ')).toContain('sc."type" =');
        expect(passingQuery.values).toContain(screeningScorecardType);

        prismaMock.review.createMany.mockClear();
        prismaMock.$queryRaw.mockResolvedValue([{ passed: false }]);
        await expect(
          pendingReviewService.ensurePendingReviewsForSubmission(
            'submission-screened',
            { triggerSource: 'unit-test' },
          ),
        ).resolves.toBe(0);
        expect(prismaMock.review.createMany).not.toHaveBeenCalled();
      },
    );

    it('skips approval pending creation because autopilot owns winner selection', async () => {
      const prismaMock = {
        submission: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'submission-approval',
            challengeId: 'challenge-approval',
            type: SubmissionType.CONTEST_SUBMISSION,
            virusScan: true,
          }),
        },
        scorecard: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'scorecard-approval',
              type: ScorecardType.APPROVAL,
            },
          ]),
        },
        reviewType: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'review-type-approval',
              name: 'Approval',
            },
          ]),
        },
        review: {
          createMany: jest.fn(),
        },
        aiReviewDecision: {
          findFirst: jest.fn(),
        },
      };
      const challengePrismaMock = {
        $queryRaw: jest.fn().mockResolvedValue([
          {
            scorecardId: 'scorecard-approval',
            templatePhaseId: 'phase-template-approval',
            challengePhaseId: 'challenge-phase-approval',
            phaseName: 'Approval',
          },
        ]),
      };
      const challengeApiServiceMock = {
        getChallengeDetail: jest.fn().mockResolvedValue({
          id: 'challenge-approval',
          phases: [
            {
              id: 'challenge-phase-approval',
              name: 'Approval',
              isOpen: true,
            },
          ],
        }),
      };
      const resourceApiServiceMock = {
        getResources: jest.fn().mockResolvedValue([
          {
            id: 'resource-approver',
            challengeId: 'challenge-approval',
            memberId: '2002',
            memberHandle: 'approverOne',
            roleId: 'role-approver',
            phaseId: 'challenge-phase-approval',
            createdBy: 'system',
            created: new Date().toISOString(),
          },
        ]),
        getResourceRoles: jest.fn().mockResolvedValue({
          'role-approver': {
            id: 'role-approver',
            name: 'Approver',
          },
        }),
      };

      const pendingReviewService = new SubmissionService(
        prismaMock as any,
        {} as any,
        challengePrismaMock as any,
        challengeApiServiceMock as any,
        resourceApiServiceMock as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );

      const created =
        await pendingReviewService.ensurePendingReviewsForSubmission(
          'submission-approval',
          { triggerSource: 'scan-complete' },
        );

      expect(created).toBe(0);
      expect(prismaMock.review.createMany).not.toHaveBeenCalled();
    });

    it('skips pending review creation when AI pass is required but decision is failed', async () => {
      const prismaMock = {
        submission: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'submission-2',
            challengeId: 'challenge-2',
            type: SubmissionType.CONTEST_SUBMISSION,
            virusScan: true,
          }),
        },
        aiReviewDecision: {
          findFirst: jest.fn().mockResolvedValue({
            status: 'FAILED',
          }),
        },
        review: {
          createMany: jest.fn(),
        },
        $queryRaw: jest.fn().mockResolvedValue([{ status: 'FAILED' }]),
      };

      const pendingReviewService = new SubmissionService(
        prismaMock as any,
        {} as any,
        { $queryRaw: jest.fn() } as any,
        { getChallengeDetail: jest.fn() } as any,
        { getResources: jest.fn(), getResourceRoles: jest.fn() } as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );

      const created =
        await pendingReviewService.ensurePendingReviewsForSubmission(
          'submission-2',
          { requireAiDecisionPass: true, triggerSource: 'unit-test' },
        );

      expect(created).toBe(0);
      expect(prismaMock.review.createMany).not.toHaveBeenCalled();
    });

    it('skips pending review creation until an AI-configured challenge has a passing decision', async () => {
      const prismaMock = {
        submission: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'submission-2b',
            challengeId: 'challenge-2b',
            type: SubmissionType.CONTEST_SUBMISSION,
            virusScan: true,
          }),
        },
        aiReviewConfig: {
          findFirst: jest.fn().mockResolvedValue({
            workflows: [{ workflowId: 'workflow-1' }],
          }),
        },
        review: {
          createMany: jest.fn(),
        },
        $queryRaw: jest.fn().mockResolvedValue([]),
      };

      const pendingReviewService = new SubmissionService(
        prismaMock as any,
        {} as any,
        { $queryRaw: jest.fn() } as any,
        { getChallengeDetail: jest.fn() } as any,
        { getResources: jest.fn(), getResourceRoles: jest.fn() } as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );

      const created =
        await pendingReviewService.ensurePendingReviewsForSubmission(
          'submission-2b',
          { triggerSource: 'unit-test' },
        );

      expect(created).toBe(0);
      expect(prismaMock.$queryRaw).toHaveBeenCalled();
      expect(prismaMock.review.createMany).not.toHaveBeenCalled();
    });

    it('skips iterative review pending creation for first2finish challenges because autopilot owns sequencing', async () => {
      const prismaMock = {
        submission: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'submission-3',
            challengeId: 'challenge-3',
            type: SubmissionType.CONTEST_SUBMISSION,
            virusScan: true,
          }),
        },
        scorecard: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'scorecard-iter-1',
              type: ScorecardType.ITERATIVE_REVIEW,
            },
          ]),
        },
        reviewType: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'review-type-iter-1',
              name: 'Iterative Review',
            },
          ]),
        },
        review: {
          createMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        aiReviewDecision: {
          findFirst: jest.fn(),
        },
      };
      const challengePrismaMock = {
        $queryRaw: jest.fn().mockResolvedValue([
          {
            scorecardId: 'scorecard-iter-1',
            templatePhaseId: 'phase-template-iterative',
            challengePhaseId: 'challenge-phase-iterative',
            phaseName: 'Iterative Review',
          },
        ]),
      };
      const challengeApiServiceMock = {
        getChallengeDetail: jest.fn().mockResolvedValue({
          id: 'challenge-3',
          type: 'first2finish',
          phases: [
            {
              id: 'challenge-phase-iterative',
              name: 'Iterative Review',
              isOpen: true,
            },
          ],
        }),
      };
      const resourceApiServiceMock = {
        getResources: jest.fn().mockResolvedValue([
          {
            id: 'resource-iterative-reviewer-1',
            challengeId: 'challenge-3',
            memberId: '2002',
            memberHandle: 'iterativeReviewer',
            roleId: 'role-iterative-reviewer',
            phaseId: 'challenge-phase-iterative',
            createdBy: 'system',
            created: new Date().toISOString(),
          },
        ]),
        getResourceRoles: jest.fn().mockResolvedValue({
          'role-iterative-reviewer': {
            id: 'role-iterative-reviewer',
            name: 'Iterative Reviewer',
          },
        }),
      };

      const pendingReviewService = new SubmissionService(
        prismaMock as any,
        {} as any,
        challengePrismaMock as any,
        challengeApiServiceMock as any,
        resourceApiServiceMock as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );

      const created =
        await pendingReviewService.ensurePendingReviewsForSubmission(
          'submission-3',
          { triggerSource: 'unit-test' },
        );

      expect(created).toBe(0);
      expect(prismaMock.review.createMany).not.toHaveBeenCalled();
    });
  });
  describe('deleteSubmission phase window', () => {
    const buildExistingSubmission = (type: SubmissionType) => ({
      challengeId: 'challenge-delete',
      id: 'submission-delete',
      memberId: '1001',
      type,
    });

    const buildDeleteService = (
      type: SubmissionType,
      isPhaseOpen: jest.Mock,
    ) => {
      const prismaMock = {
        submission: {
          findUnique: jest.fn().mockResolvedValue(buildExistingSubmission(type)),
          delete: jest.fn().mockResolvedValue(buildExistingSubmission(type)),
        },
        aiWorkflowRun: {
          findMany: jest.fn().mockResolvedValue([]),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      };
      const challengePrismaMock = {
        $executeRaw: jest.fn().mockResolvedValue(1),
      };
      const deleteService = new SubmissionService(
        prismaMock as any,
        { handleError: jest.fn() } as any,
        challengePrismaMock as any,
        { isPhaseOpen } as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );

      return { deleteService, prismaMock };
    };

    it('rejects a submitter deleting a checkpoint submission once the Checkpoint Submission phase closed', async () => {
      const isPhaseOpen = jest.fn().mockResolvedValue(false);
      const { deleteService, prismaMock } = buildDeleteService(
        SubmissionType.CHECKPOINT_SUBMISSION,
        isPhaseOpen,
      );

      await expect(
        deleteService.deleteSubmission(
          { userId: '1001', roles: ['Topcoder User'] } as any,
          'submission-delete',
        ),
      ).rejects.toMatchObject({
        response: {
          code: 'SUBMISSION_PHASE_CLOSED',
          details: {
            challengeId: 'challenge-delete',
            requiredOpenPhases: ['Checkpoint Submission'],
            submissionType: SubmissionType.CHECKPOINT_SUBMISSION,
          },
        },
      });

      expect(isPhaseOpen).toHaveBeenCalledWith('challenge-delete', [
        'Checkpoint Submission',
      ]);
      expect(prismaMock.submission.delete).not.toHaveBeenCalled();
    });

    it('rejects a submitter deleting a contest submission once the Submission phase closed', async () => {
      const isPhaseOpen = jest.fn().mockResolvedValue(false);
      const { deleteService, prismaMock } = buildDeleteService(
        SubmissionType.CONTEST_SUBMISSION,
        isPhaseOpen,
      );

      await expect(
        deleteService.deleteSubmission(
          { userId: '1001', roles: ['Topcoder User'] } as any,
          'submission-delete',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(isPhaseOpen).toHaveBeenCalledWith('challenge-delete', [
        'Submission',
        'Topgear Submission',
      ]);
      expect(prismaMock.submission.delete).not.toHaveBeenCalled();
    });

    it('allows a submitter to delete while the matching submission phase is open', async () => {
      const isPhaseOpen = jest.fn().mockResolvedValue(true);
      const { deleteService, prismaMock } = buildDeleteService(
        SubmissionType.CHECKPOINT_SUBMISSION,
        isPhaseOpen,
      );

      await deleteService.deleteSubmission(
        { userId: '1001', roles: ['Topcoder User'] } as any,
        'submission-delete',
      );

      expect(prismaMock.submission.delete).toHaveBeenCalledWith({
        where: { id: 'submission-delete' },
      });
    });

    it('does not apply the phase window to admins', async () => {
      const isPhaseOpen = jest.fn().mockResolvedValue(false);
      const { deleteService, prismaMock } = buildDeleteService(
        SubmissionType.CHECKPOINT_SUBMISSION,
        isPhaseOpen,
      );

      await deleteService.deleteSubmission(
        { userId: '2002', roles: ['administrator'] } as any,
        'submission-delete',
      );

      expect(isPhaseOpen).not.toHaveBeenCalled();
      expect(prismaMock.submission.delete).toHaveBeenCalled();
    });
  });
});
