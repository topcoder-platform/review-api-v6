import { ForbiddenException } from '@nestjs/common';
import { SubmissionStatus, SubmissionType } from '@prisma/client';
import { Readable } from 'stream';
import { SubmissionService } from './submission.service';
import { UserRole } from 'src/shared/enums/userRole.enum';
import { ChallengeStatus } from 'src/shared/enums/challengeStatus.enum';

jest.mock('nanoid', () => ({
  __esModule: true,
  nanoid: () => 'mock-nanoid',
}));

describe('SubmissionService', () => {
  let service: SubmissionService;
  let resourceApiService: { getMemberResourcesRoles: jest.Mock };
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

  beforeAll(() => {
    originalBucket = process.env.ARTIFACTS_S3_BUCKET;
    originalCleanBucket = process.env.SUBMISSION_CLEAN_S3_BUCKET;
  });

  beforeEach(() => {
    resourceApiService = {
      getMemberResourcesRoles: jest.fn().mockResolvedValue([]),
    };
    service = new SubmissionService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      resourceApiService as any,
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

  describe('getSubmissionFileStream', () => {
    let prismaMock: { submission: { findFirst: jest.Mock } };
    let challengeApiServiceMock: { getChallengeDetail: jest.Mock };
    let checkSubmissionSpy: jest.SpyInstance;

    beforeEach(() => {
      prismaMock = {
        submission: {
          findFirst: jest.fn(),
        },
      };
      challengeApiServiceMock = {
        getChallengeDetail: jest.fn(),
      };
      resourceApiService = {
        getMemberResourcesRoles: jest.fn(),
      };
      service = new SubmissionService(
        prismaMock as any,
        {} as any,
        {} as any,
        challengeApiServiceMock as any,
        resourceApiService as any,
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
          url: 'https://s3.amazonaws.com/dummy/submission.zip',
        });
      jest
        .spyOn(service as any, 'parseS3Url')
        .mockReturnValue({ key: 'dummy/submission.zip' });
      jest
        .spyOn(service as any, 'recordSubmissionDownload')
        .mockResolvedValue(undefined);
      s3Send = jest
        .fn()
        .mockResolvedValueOnce({ ContentType: 'application/zip' })
        .mockResolvedValueOnce({ Body: Readable.from(['payload']) });
      jest.spyOn(service as any, 'getS3Client').mockReturnValue({
        send: s3Send,
      });
    });

    it('allows screeners to download submissions', async () => {
      resourceApiService.getMemberResourcesRoles.mockResolvedValue([
        { roleName: 'Screener' },
      ]);

      const result = await service.getSubmissionFileStream(
        {
          userId: 'screener-user',
          isMachine: false,
          roles: [],
        } as any,
        'sub-123',
      );

      expect(result.fileName).toBe('submission-sub-123.zip');
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

      const result = await service.getSubmissionFileStream(
        {
          userId: 'checkpoint-screener-user',
          isMachine: false,
          roles: [],
        } as any,
        'checkpoint-sub-123',
      );

      expect(result.fileName).toBe('submission-checkpoint-sub-123.zip');
      expect(resourceApiService.getMemberResourcesRoles).toHaveBeenCalledWith(
        'challenge-xyz',
        'checkpoint-screener-user',
      );
    });

    it('allows submitters with passing reviews to download when challenge is completed', async () => {
      resourceApiService.getMemberResourcesRoles.mockResolvedValue([
        { roleName: 'Submitter' },
      ]);
      challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
        status: ChallengeStatus.COMPLETED,
      });
      prismaMock.submission.findFirst.mockResolvedValue({
        id: 'passing-sub',
      });

      const result = await service.getSubmissionFileStream(
        {
          userId: 'submitter-user',
          isMachine: false,
          roles: [],
        } as any,
        'sub-123',
      );

      expect(result.fileName).toBe('submission-sub-123.zip');
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
      expect(s3Send).toHaveBeenCalledTimes(2);
    });

    it('denies submitters when the challenge is not completed', async () => {
      resourceApiService.getMemberResourcesRoles.mockResolvedValue([
        { roleName: 'Submitter' },
      ]);
      challengeApiServiceMock.getChallengeDetail.mockResolvedValue({
        status: ChallengeStatus.ACTIVE,
      });

      await expect(
        service.getSubmissionFileStream(
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
  });

  describe('listSubmission', () => {
    let prismaMock: {
      submission: {
        findMany: jest.Mock;
        count: jest.Mock;
        findFirst: jest.Mock;
      };
    };
    let prismaErrorServiceMock: { handleError: jest.Mock };
    let challengePrismaMock: {
      $queryRaw: jest.Mock;
    };
    let listService: SubmissionService;

    beforeEach(() => {
      prismaMock = {
        submission: {
          findMany: jest.fn(),
          count: jest.fn(),
          findFirst: jest.fn(),
        },
      };
      prismaErrorServiceMock = {
        handleError: jest.fn(),
      };
      challengePrismaMock = {
        $queryRaw: jest.fn().mockResolvedValue([]),
      };
      listService = new SubmissionService(
        prismaMock as any,
        prismaErrorServiceMock as any,
        challengePrismaMock as any,
        {} as any,
        {
          validateSubmitterRegistration: jest.fn(),
          getMemberResourcesRoles: jest.fn(),
        } as any,
        {} as any,
        {} as any,
        { member: { findMany: jest.fn() } } as any,
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
  });
});
