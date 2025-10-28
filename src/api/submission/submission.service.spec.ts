import { ForbiddenException } from '@nestjs/common';
import { SubmissionStatus, SubmissionType } from '@prisma/client';
import { Readable } from 'stream';
import { SubmissionService } from './submission.service';
import { UserRole } from 'src/shared/enums/userRole.enum';
import { ChallengeStatus } from 'src/shared/enums/challengeStatus.enum';
import { CommonConfig } from 'src/shared/config/common.config';

jest.mock('nanoid', () => ({
  __esModule: true,
  nanoid: () => 'mock-nanoid',
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

  beforeAll(() => {
    originalBucket = process.env.ARTIFACTS_S3_BUCKET;
    originalCleanBucket = process.env.SUBMISSION_CLEAN_S3_BUCKET;
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
        type: 'Something Else',
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

    it('allows First2Finish submitters to download any submission when challenge is completed', async () => {
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
      expect(prismaMock.submission.findFirst).toHaveBeenCalledTimes(1);
      expect(prismaMock.submission.findFirst).toHaveBeenCalledWith({
        where: {
          challengeId: 'challenge-xyz',
          memberId: 'submitter-user',
        },
        select: { id: true },
      });
      expect(s3Send).toHaveBeenCalledTimes(2);
    });
  });

  describe('listSubmission', () => {
    let prismaMock: {
      submission: {
        findMany: jest.Mock;
        count: jest.Mock;
        findFirst: jest.Mock;
      };
      reviewType: {
        findMany: jest.Mock;
      };
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
        },
        reviewType: {
          findMany: jest.fn().mockResolvedValue([]),
        },
      };
      prismaErrorServiceMock = {
        handleError: jest.fn(),
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

    it('omits review data for non-owned submissions before completion', async () => {
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

      const own = result.data.find((entry) => entry.id === 'submission-own');
      const other = result.data.find(
        (entry) => entry.id === 'submission-other',
      );

      expect(own?.review).toBeDefined();
      expect(other).not.toHaveProperty('review');
      expect(
        resourceApiServiceListMock.getMemberResourcesRoles,
      ).toHaveBeenCalledWith('challenge-1', 'user-1');
      expect(challengeApiServiceMock.getChallengeDetail).toHaveBeenCalledWith(
        'challenge-1',
      );
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

      const other = result.data.find(
        (entry) => entry.id === 'submission-other',
      );

      expect(other?.review).toBeDefined();
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
  });
});
