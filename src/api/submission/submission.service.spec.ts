import { ForbiddenException } from '@nestjs/common';
import { Readable } from 'stream';
import { SubmissionService } from './submission.service';
import { UserRole } from 'src/shared/enums/userRole.enum';

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

  beforeAll(() => {
    originalBucket = process.env.ARTIFACTS_S3_BUCKET;
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
});
