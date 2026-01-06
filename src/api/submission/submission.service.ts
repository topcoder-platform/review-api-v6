import {
  Injectable,
  Logger,
  NotFoundException,
  InternalServerErrorException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import {
  SubmissionStatus,
  SubmissionType,
  ScorecardType,
} from '@prisma/client';
import { PaginationDto } from 'src/dto/pagination.dto';
import { ReviewResponseDto } from 'src/dto/review.dto';
import { SortDto } from 'src/dto/sort.dto';
import {
  SubmissionQueryDto,
  SubmissionRequestDto,
  SubmissionResponseDto,
  SubmissionUpdateRequestDto,
} from 'src/dto/submission.dto';
import { JwtUser, isAdmin } from 'src/shared/modules/global/jwt.service';
import { UserRole } from 'src/shared/enums/userRole.enum';
import { ChallengeStatus } from 'src/shared/enums/challengeStatus.enum';
import { CommonConfig } from 'src/shared/config/common.config';
import { PrismaService } from 'src/shared/modules/global/prisma.service';
import { ChallengePrismaService } from 'src/shared/modules/global/challenge-prisma.service';
import { MemberPrismaService } from 'src/shared/modules/global/member-prisma.service';
import { Utils } from 'src/shared/modules/global/utils.service';
import { PrismaErrorService } from 'src/shared/modules/global/prisma-error.service';
import {
  ChallengeApiService,
  ChallengeData,
} from 'src/shared/modules/global/challenge.service';
import { ChallengeCatalogService } from 'src/shared/modules/global/challenge-catalog.service';
import { ResourceApiService } from 'src/shared/modules/global/resource.service';
import { ResourcePrismaService } from 'src/shared/modules/global/resource-prisma.service';
import { ArtifactsCreateResponseDto } from 'src/dto/artifacts.dto';
import { randomUUID } from 'crypto';
import { basename } from 'path';
import { ResourceInfo } from 'src/shared/models/ResourceInfo.model';
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable, PassThrough } from 'stream';
import { EventBusService } from 'src/shared/modules/global/eventBus.service';
import { SubmissionAccessAuditResponseDto } from 'src/dto/submission-access-audit.dto';
import { Prisma } from '@prisma/client';
import type { Express } from 'express';

type SubmissionMinimal = {
  id: string;
  systemFileName: string | null;
  url: string | null;
};

interface TopgearSubmissionEventPayload {
  submissionId: string;
  challengeId: string;
  submissionUrl: string;
  memberHandle: string;
  memberId: string;
  submittedDate: string;
}

type TopgearSubmissionRecord = {
  id: string;
  challengeId: string | null;
  memberId: string | null;
  url: string | null;
  createdAt: Date;
};

type SubmissionBusPayloadSource = Prisma.submissionGetPayload<{
  select: {
    id: true;
    type: true;
    status: true;
    memberId: true;
    challengeId: true;
    legacyChallengeId: true;
    legacySubmissionId: true;
    legacyUploadId: true;
    submissionPhaseId: true;
    fileType: true;
    systemFileName: true;
    submittedDate: true;
    url: true;
    isFileSubmission: true;
    createdAt: true;
    updatedAt: true;
    createdBy: true;
    updatedBy: true;
    prizeId: true;
    fileSize: true;
    viewCount: true;
  };
}>;

type ChallengeRoleSummary = {
  hasCopilot: boolean;
  hasReviewer: boolean;
  hasSubmitter: boolean;
  reviewerResourceIds: string[];
};

type ReviewVisibilityContext = {
  roleSummaryByChallenge: Map<string, ChallengeRoleSummary>;
  challengeDetailsById: Map<string, ChallengeData | null>;
  requesterUserId: string;
};

const EMPTY_ROLE_SUMMARY: ChallengeRoleSummary = {
  hasCopilot: false,
  hasReviewer: false,
  hasSubmitter: false,
  reviewerResourceIds: [],
};

const REVIEW_ACCESS_ROLE_KEYWORDS = [
  'reviewer',
  'screener',
  'approver',
  'approval',
];

const REVIEW_ITEM_COMMENTS_INCLUDE = {
  reviewItemComments: {
    include: {
      appeal: {
        include: {
          appealResponse: true,
        },
      },
    },
  },
} as const;

@Injectable()
export class SubmissionService {
  private readonly logger = new Logger(SubmissionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaErrorService: PrismaErrorService,
    private readonly challengePrisma: ChallengePrismaService,
    private readonly challengeApiService: ChallengeApiService,
    private readonly resourceApiService: ResourceApiService,
    private readonly resourcePrisma: ResourcePrismaService,
    private readonly eventBusService: EventBusService,
    private readonly challengeCatalogService: ChallengeCatalogService,
    private readonly memberPrisma: MemberPrismaService,
  ) {}

  /**
   * Upload an artifact file to S3 under a submission-specific path and
   * return a generated artifact identifier (UUID), matching legacy behavior
   * where artifacts are stored in S3 and referenced by ID.
   */
  async createArtifact(
    authUser: JwtUser,
    submissionId: string,
    file: Express.Multer.File,
    requestedFilename?: string,
  ): Promise<ArtifactsCreateResponseDto> {
    // Ensure the submission exists (keeps behavior predictable)
    const submission = await this.checkSubmission(submissionId);

    // If token is a member (non-admin), they must own the submission
    if (!isAdmin(authUser)) {
      const uid = String(authUser.userId ?? '');
      if (!uid || submission.memberId !== uid) {
        throw new ForbiddenException({
          message: 'Only the submission owner can upload artifacts',
          code: 'FORBIDDEN_ARTIFACT_UPLOAD',
          details: {
            submissionId,
            memberId: submission.memberId,
            requester: uid,
          },
        });
      }
    }

    const bucket = process.env.ARTIFACTS_S3_BUCKET;
    if (!bucket) {
      this.logger.error('ARTIFACTS_S3_BUCKET is not configured');
      throw new InternalServerErrorException({
        message: 'S3 bucket not configured',
        code: 'S3_BUCKET_MISSING',
      });
    }

    const s3 = this.getS3Client();

    const overrideName = this.sanitizeArtifactFileName(requestedFilename);
    if (requestedFilename) {
      this.logger.log(
        `Artifact upload override request: submission=${submissionId} raw="${requestedFilename}" sanitized="${overrideName ?? '<rejected>'}"`,
      );
    }
    const artifactId = overrideName ?? randomUUID();
    this.logger.log(
      `Artifact upload resolved ID: submission=${submissionId} artifactId=${artifactId} overrideApplied=${overrideName ? 'true' : 'false'}`,
    );
    const originalName = file.originalname || file.filename || 'artifact';

    // Derive file extension from mime-type or filename (fallback to 'bin')
    let uFileType: string | undefined = this.guessExtFromMime(file.mimetype);
    if (!uFileType) {
      const dot = originalName.lastIndexOf('.');
      if (dot > 0 && dot < originalName.length - 1) {
        uFileType = originalName.substring(dot + 1);
      }
    }
    if (!uFileType) uFileType = 'bin';

    // Legacy-compatible S3 key format: `${submissionId}/${artifactId}.${uFileType}`
    const key = `${submissionId}/${artifactId}.${uFileType}`;
    this.logger.log(
      `Artifact upload S3 key computed: submission=${submissionId} key=${key} originalFile=${originalName} mimeType=${file.mimetype}`,
    );

    try {
      // Prefer in-memory buffer (memoryStorage). Fallbacks for other cases.
      let body: any = (file as any)?.buffer;
      if (!body && (file as any)?.stream) {
        body = (file as any).stream;
      }
      if (!body) {
        // As a last resort, try disk-based path if Multer was configured for disk
        const diskDest = (file as any)?.destination;
        const diskFile = (file as any)?.filename;
        if (diskDest && diskFile) {
          const fs = await import('fs');
          const path = await import('path');
          body = fs.createReadStream(path.join(diskDest, diskFile));
        }
      }
      if (!body) {
        throw new BadRequestException({
          message: 'File data missing in request',
          code: 'FILE_DATA_MISSING',
        });
      }

      const upload = new Upload({
        client: s3,
        params: {
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: file.mimetype,
          Metadata: {
            artifactId,
            submissionId,
            originalFileName: originalName,
          },
        },
        queueSize: 4,
        partSize: 5 * 1024 * 1024, // 5 MB
        leavePartsOnError: false,
      });
      await upload.done();
      this.logger.log(
        `Uploaded artifact to S3. bucket=${bucket} key=${key} artifactId=${artifactId}`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to upload artifact to S3 for submission ${submissionId}: ${err?.message}`,
      );
      throw new InternalServerErrorException({
        message: 'Failed to upload artifact to storage',
        code: 'S3_UPLOAD_FAILED',
        details: { submissionId },
      });
    }

    return { artifacts: artifactId };
  }

  async listArtifacts(
    authUser: JwtUser,
    submissionId: string,
  ): Promise<{ artifacts: string[] }> {
    const submission = await this.checkSubmission(submissionId);

    const isMachineToken = !!authUser.isMachine;
    const isAdminUser = isAdmin(authUser);
    const uid = authUser.userId ? String(authUser.userId) : '';
    let isOwner = false;
    let isCopilot = false;

    if (!isMachineToken && !isAdminUser) {
      isOwner = !!uid && submission.memberId === uid;

      if (!isOwner && submission.challengeId && uid) {
        try {
          const resources =
            await this.resourceApiService.getMemberResourcesRoles(
              submission.challengeId,
              uid,
            );
          isCopilot = resources.some((resource) =>
            (resource.roleName || '').toLowerCase().includes('copilot'),
          );
        } catch {
          isCopilot = false;
        }
      }

      if (!isOwner && !isCopilot) {
        throw new ForbiddenException({
          message:
            'Only the submission owner, a challenge copilot, or an admin can list submission artifacts',
          code: 'FORBIDDEN_ARTIFACT_LIST',
          details: {
            submissionId,
            requester: uid,
            challengeId: submission.challengeId,
          },
        });
      }
    }
    const allowInternalArtifacts = isMachineToken || isAdminUser || isCopilot;

    const bucket = process.env.ARTIFACTS_S3_BUCKET;
    if (!bucket) {
      throw new InternalServerErrorException({
        message: 'S3 bucket not configured',
        code: 'S3_BUCKET_MISSING',
      });
    }

    const s3 = this.getS3Client();
    const prefix = `${submissionId}/`;

    const artifactIds = new Set<string>();
    let continuationToken: string | undefined = undefined;
    try {
      do {
        const resp = await s3.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          }),
        );
        (resp.Contents || []).forEach((obj) => {
          const key = obj.Key || '';
          // Expect keys like {submissionId}/{artifactId}.{ext}
          const parts = key.split('/');
          if (parts.length >= 2) {
            const file = parts[parts.length - 1];
            const dot = file.lastIndexOf('.');
            const id = dot > 0 ? file.substring(0, dot) : file;
            if (id) artifactIds.add(id);
          }
        });
        continuationToken = resp.IsTruncated
          ? resp.NextContinuationToken
          : undefined;
      } while (continuationToken);
    } catch (err) {
      this.logger.error(
        `Failed to list artifacts from S3 for submission ${submissionId}: ${err?.message}`,
      );
      throw new InternalServerErrorException({
        message: 'Failed to list artifacts from storage',
        code: 'S3_LIST_FAILED',
        details: { submissionId },
      });
    }

    const allArtifacts = Array.from(artifactIds);
    const artifacts = allowInternalArtifacts
      ? allArtifacts
      : allArtifacts.filter(
          (artifactId) => !artifactId.toLowerCase().includes('internal'),
        );

    return { artifacts };
  }

  async getArtifactStream(
    authUser: JwtUser,
    submissionId: string,
    artifactId: string,
  ): Promise<{ stream: Readable; contentType?: string; fileName: string }> {
    const submission = await this.checkSubmission(submissionId);

    const isMachineToken = !!authUser.isMachine;
    const isAdminUser = isAdmin(authUser);
    const uid = authUser.userId ? String(authUser.userId) : '';
    let isOwner = false;
    let isCopilot = false;

    if (!isMachineToken && !isAdminUser) {
      isOwner = !!uid && submission.memberId === uid;

      if (!isOwner && submission.challengeId && uid) {
        try {
          const resources =
            await this.resourceApiService.getMemberResourcesRoles(
              submission.challengeId,
              uid,
            );
          isCopilot = resources.some((resource) =>
            (resource.roleName || '').toLowerCase().includes('copilot'),
          );
        } catch {
          isCopilot = false;
        }
      }

      if (!isOwner && !isCopilot) {
        throw new ForbiddenException({
          message:
            'Only the submission owner, a challenge copilot, or an admin can download artifacts',
          code: 'FORBIDDEN_ARTIFACT_DOWNLOAD',
          details: {
            submissionId,
            requester: uid,
            challengeId: submission.challengeId,
          },
        });
      }
    }

    const allowInternalArtifacts = isMachineToken || isAdminUser || isCopilot;
    if (
      !allowInternalArtifacts &&
      artifactId.toLowerCase().includes('internal')
    ) {
      throw new ForbiddenException({
        message: 'Submission owners cannot download internal artifacts',
        code: 'FORBIDDEN_INTERNAL_ARTIFACT_DOWNLOAD',
        details: {
          submissionId,
          artifactId,
          requester: uid,
        },
      });
    }

    const bucket = process.env.ARTIFACTS_S3_BUCKET;
    if (!bucket) {
      throw new InternalServerErrorException({
        message: 'S3 bucket not configured',
        code: 'S3_BUCKET_MISSING',
      });
    }
    const s3 = this.getS3Client();

    // Locate the object by listing under the artifact prefix
    const artifactPrefix = `${submissionId}/${artifactId}.`;
    let key: string | undefined;
    try {
      const list = await s3.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: artifactPrefix,
          MaxKeys: 1,
        }),
      );
      if (
        !list.Contents ||
        list.Contents.length === 0 ||
        !list.Contents[0].Key
      ) {
        throw new NotFoundException({
          message: `Artifact ${artifactId} not found for submission ${submissionId}`,
          code: 'ARTIFACT_NOT_FOUND',
        });
      }
      key = list.Contents[0].Key;
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw err;
      }
      this.logger.error(
        `Failed to locate artifact in S3 for submission ${submissionId}, artifact ${artifactId}: ${err?.message}`,
      );
      throw new InternalServerErrorException({
        message: 'Failed to locate artifact in storage',
        code: 'S3_LOCATE_FAILED',
        details: { submissionId, artifactId },
      });
    }

    // Get metadata for original filename and content-type
    let fileName = `${artifactId}`;
    let contentType: string | undefined = undefined;
    try {
      const head = await s3.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
      );
      contentType = head.ContentType || undefined;
      // Metadata keys are lowercase in S3 SDK v3
      const meta = head.Metadata || {};
      fileName = meta['originalfilename'] || fileName;
    } catch {
      // proceed without metadata
    }

    try {
      const resp = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      const body = resp.Body as any;
      let stream: Readable;
      if (body && typeof body.pipe === 'function') {
        // Node.js Readable
        stream = body as Readable;
      } else if (
        body &&
        typeof body.getReader === 'function' &&
        (Readable as any).fromWeb
      ) {
        // Web ReadableStream -> Node Readable (Node 18+)
        stream = (Readable as any).fromWeb(body);
      } else if (Buffer.isBuffer(body)) {
        stream = Readable.from(body);
      } else {
        throw new Error('Unsupported S3 Body stream type');
      }
      return { stream, contentType, fileName };
    } catch (err) {
      this.logger.error(
        `Failed to download artifact from S3 for submission ${submissionId}, artifact ${artifactId}: ${err?.message}`,
      );
      throw new InternalServerErrorException({
        message: 'Failed to download artifact from storage',
        code: 'S3_DOWNLOAD_FAILED',
        details: { submissionId, artifactId },
      });
    }
  }

  /**
   * Streams the original submission file from the clean S3 bucket.
   *
   * Authorization rules:
   * - M2M tokens: require scope read:submission or all:submission
   * - Member tokens: allow if admin OR submission owner OR reviewer/copilot on the challenge
   *
   * The file is always fetched from the configured clean bucket, never from DMZ.
   * The S3 key is derived from the submission.url.
   */
  async getSubmissionFileStream(
    authUser: JwtUser,
    submissionId: string,
  ): Promise<{ stream: Readable; contentType?: string; fileName: string }> {
    const submission = await this.checkSubmission(submissionId);

    // Authorization
    if (authUser.isMachine) {
      const scopes = authUser.scopes || [];
      const hasScope =
        scopes.includes('read:submission') || scopes.includes('all:submission');
      if (!hasScope) {
        throw new ForbiddenException({
          message: 'M2M token missing required scope to download submission',
          code: 'FORBIDDEN_M2M_SCOPE',
        });
      }
    } else if (!isAdmin(authUser)) {
      const uid = String(authUser.userId ?? '');
      const isOwner = !!uid && submission.memberId === uid;
      let isReviewer = false;
      let isCopilot = false;
      let isSubmitter = false;
      let isManager = false;
      if (!isOwner && submission.challengeId && uid) {
        try {
          const resources =
            await this.resourceApiService.getMemberResourcesRoles(
              submission.challengeId,
              uid,
            );
          for (const r of resources) {
            const roleName = r.roleName || '';
            const rn = roleName.toLowerCase();
            const roleType = this.identifyReviewerRoleType(roleName);

            switch (roleType) {
              case 'screener':
              case 'reviewer':
              case 'iterative-reviewer':
              case 'approver':
                if (submission.type === SubmissionType.CONTEST_SUBMISSION) {
                  isReviewer = true;
                }
                break;
              case 'checkpoint-screener':
              case 'checkpoint-reviewer':
                if (submission.type === SubmissionType.CHECKPOINT_SUBMISSION) {
                  isReviewer = true;
                }
                break;
              default:
                break;
            }
            if (rn.includes('copilot')) {
              isCopilot = true;
            }
            if (rn.includes('submitter')) {
              isSubmitter = true;
            }
            if (rn.includes('manager')) {
              isManager = true;
            }
            if (isReviewer && isCopilot && isSubmitter && isManager) {
              break;
            }
          }
        } catch (err) {
          // If we cannot confirm roles, deny access unless other checks succeed
          this.logger.warn(
            `Failed to load member roles for challenge ${submission.challengeId} and member ${uid}: ${(err as Error)?.message}`,
          );
        }
      }

      let canDownload = isOwner || isReviewer || isCopilot || isManager;

      if (!canDownload && isSubmitter && submission.challengeId && uid) {
        try {
          const challenge = await this.challengeApiService.getChallengeDetail(
            submission.challengeId,
          );
          if (challenge.status === ChallengeStatus.COMPLETED) {
            if (this.isFirst2FinishChallenge(challenge)) {
              const memberSubmission = await this.prisma.submission.findFirst({
                where: {
                  challengeId: submission.challengeId,
                  memberId: uid,
                },
                select: { id: true },
              });
              canDownload = !!memberSubmission;
            } else {
              const passingSubmission = await this.prisma.submission.findFirst({
                where: {
                  challengeId: submission.challengeId,
                  memberId: uid,
                  reviewSummation: {
                    some: {
                      isPassing: true,
                    },
                  },
                },
                select: { id: true },
              });
              canDownload = !!passingSubmission;
            }
          }
        } catch (err) {
          this.logger.warn(
            `Failed to validate submitter download eligibility for challenge ${submission.challengeId} and member ${uid}: ${(err as Error)?.message}`,
          );
        }
      }

      if (!canDownload) {
        throw new ForbiddenException({
          message:
            'Only the submission owner, a challenge reviewer/copilot/manager, or an admin can download the submission',
          code: 'FORBIDDEN_SUBMISSION_DOWNLOAD',
          details: {
            submissionId,
            requester: uid,
            challengeId: submission.challengeId,
          },
        });
      }
    }

    // Determine S3 bucket and key from submission URL
    const cleanBucket = process.env.SUBMISSION_CLEAN_S3_BUCKET;
    if (!cleanBucket) {
      this.logger.error('SUBMISSION_CLEAN_S3_BUCKET is not configured');
      throw new InternalServerErrorException({
        message: 'S3 bucket not configured',
        code: 'CLEAN_BUCKET_MISSING',
      });
    }
    if (!submission.url) {
      throw new NotFoundException({
        message: `Submission ${submissionId} has no URL to download`,
        code: 'SUBMISSION_URL_MISSING',
        details: { submissionId },
      });
    }

    const parsed = this.parseS3Url(submission.url);
    if (!parsed || !parsed.key) {
      this.logger.error(
        `Unable to parse S3 key from submission URL for submission ${submissionId}: ${submission.url}`,
      );
      throw new InternalServerErrorException({
        message: 'Failed to resolve submission location',
        code: 'SUBMISSION_URL_PARSE_FAILED',
        details: { submissionId },
      });
    }

    const key = parsed.key;
    const bucket = cleanBucket; // Always use clean bucket (never DMZ)

    const s3 = this.getS3Client();
    let contentType: string | undefined = 'application/zip';
    try {
      const head = await s3.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
      );
      contentType = head.ContentType || contentType;
    } catch (err) {
      // If the object isn't in the clean bucket, do NOT fallback to DMZ
      this.logger.error(
        `Submission object not found in clean bucket. submissionId=${submissionId} bucket=${bucket} key=${key} err=${(err as Error)?.message}`,
      );
      throw new NotFoundException({
        message: 'Submission not available in clean storage',
        code: 'SUBMISSION_NOT_CLEAN',
        details: { submissionId },
      });
    }

    try {
      const resp = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      const body = (resp as any).Body;
      let stream: Readable;
      if (body && typeof body.pipe === 'function') {
        stream = body as Readable;
      } else if (
        body &&
        typeof body.getReader === 'function' &&
        (Readable as any).fromWeb
      ) {
        stream = (Readable as any).fromWeb(body);
      } else if (Buffer.isBuffer(body)) {
        stream = Readable.from(body);
      } else {
        throw new Error('Unsupported S3 Body stream type');
      }
      // Record access audit (best-effort; do not block download on failure)
      try {
        await this.recordSubmissionDownload(submission.id, authUser);
      } catch (e) {
        this.logger.warn(
          `Failed to record submission access audit for ${submission.id}: ${(e as Error)?.message}`,
        );
      }
      const fileName = `submission-${submission.id}.zip`;
      return { stream, contentType, fileName };
    } catch (err) {
      this.logger.error(
        `Failed to download submission from clean S3. submissionId=${submissionId} bucket=${bucket} key=${key} err=${(err as Error)?.message}`,
      );
      throw new InternalServerErrorException({
        message: 'Failed to download submission from storage',
        code: 'S3_DOWNLOAD_FAILED',
        details: { submissionId },
      });
    }
  }

  private isFirst2FinishChallenge(challenge?: ChallengeData | null): boolean {
    if (!challenge) {
      return false;
    }

    const typeName = (challenge.type ?? '').trim().toLowerCase();
    if (
      typeName === 'first2finish' ||
      typeName === 'first 2 finish' ||
      typeName === 'topgear task'
    ) {
      return true;
    }

    const legacySubTrack = (challenge.legacy?.subTrack ?? '')
      .trim()
      .toLowerCase();

    if (legacySubTrack === 'first_2_finish') {
      return true;
    }

    return false;
  }

  /**
   * Streams a ZIP file containing all submissions for a challenge.
   * Inside the big zip are the individual submission .zip files from the clean bucket.
   *
   * Member tokens: only Admin, Copilot, or Reviewer can access.
   * M2M tokens: require read:submission or all:submission scope.
   *
   * Naming inside the big zip:
   * - Admin or Copilot: "{memberHandle}-{submissionId}.zip"
   * - Reviewer: "submission-{submissionId}.zip"
   * - M2M: uses reviewer naming.
   */
  async getChallengeSubmissionsZipStream(
    authUser: JwtUser,
    challengeId: string,
    opts?: { status?: string },
  ): Promise<{ stream: Readable; contentType?: string; fileName: string }> {
    // Authorization
    let isAdminOrCopilot = false;
    let isReviewer = false;

    if (authUser.isMachine) {
      const scopes = authUser.scopes || [];
      const hasScope =
        scopes.includes('read:submission') || scopes.includes('all:submission');
      if (!hasScope) {
        throw new ForbiddenException({
          message: 'M2M token missing required scope to download submissions',
          code: 'FORBIDDEN_M2M_SCOPE',
        });
      }
    } else if (!isAdmin(authUser)) {
      const uid = String(authUser.userId ?? '');
      try {
        const resources = await this.resourceApiService.getMemberResourcesRoles(
          challengeId,
          uid,
        );
        for (const r of resources) {
          const rn = (r.roleName || '').toLowerCase();
          if (rn.includes('copilot')) isAdminOrCopilot = true;
          if (rn.includes('reviewer') || rn.includes('screener')) {
            isReviewer = true;
          }
        }
      } catch {
        // Fall through; if we can't confirm roles, deny
      }
      if (!isReviewer && !isAdminOrCopilot) {
        throw new ForbiddenException({
          message:
            'Only a challenge reviewer/copilot or an admin can download all submissions',
          code: 'FORBIDDEN_SUBMISSION_BULK_DOWNLOAD',
          details: { challengeId, requester: uid },
        });
      }
    } else {
      // Admin
      isAdminOrCopilot = true;
    }

    const cleanBucket = process.env.SUBMISSION_CLEAN_S3_BUCKET;
    if (!cleanBucket) {
      this.logger.error('SUBMISSION_CLEAN_S3_BUCKET is not configured');
      throw new InternalServerErrorException({
        message: 'S3 bucket not configured',
        code: 'CLEAN_BUCKET_MISSING',
      });
    }

    // Fetch all submissions for the challenge (with optional status filter)
    const where: any = { challengeId };
    if (opts?.status) {
      const statusKey = String(opts.status).toUpperCase();
      if (
        Object.values(SubmissionStatus).includes(statusKey as SubmissionStatus)
      ) {
        where.status = statusKey as SubmissionStatus;
      }
    }
    const submissions = await this.prisma.submission.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });

    if (!submissions.length) {
      throw new NotFoundException({
        message: `No submissions found for challenge ${challengeId}`,
        code: 'SUBMISSIONS_NOT_FOUND',
        details: { challengeId },
      });
    }

    // Build memberId -> handle map for naming (admin/copilot case)
    let handleMap = new Map<string, string>();
    try {
      const allResources = await this.resourceApiService.getResources({
        challengeId,
      });
      handleMap = new Map(
        (allResources || [])
          .filter((r) => r.memberId && r.memberHandle)
          .map((r) => [String(r.memberId), String(r.memberHandle)]),
      );
    } catch (e) {
      // If member handles cannot be loaded, we will fallback to memberId in filenames
      this.logger.warn(
        `Could not load resource handles for challenge ${challengeId}: ${(e as Error)?.message}`,
      );
    }

    const s3 = this.getS3Client();

    // Pre-validate that all submission objects exist in the clean bucket.
    // Fail the entire request if any are missing.
    for (const sub of submissions) {
      if (!sub.url) {
        throw new NotFoundException({
          message: `Submission ${sub.id} has no URL to download`,
          code: 'SUBMISSION_URL_MISSING',
          details: { submissionId: sub.id },
        });
      }
      const parsed = this.parseS3Url(sub.url);
      if (!parsed || !parsed.key) {
        throw new InternalServerErrorException({
          message: `Failed to resolve submission location for ${sub.id}`,
          code: 'SUBMISSION_URL_PARSE_FAILED',
          details: { submissionId: sub.id },
        });
      }
      try {
        await s3.send(
          new HeadObjectCommand({ Bucket: cleanBucket, Key: parsed.key }),
        );
      } catch {
        throw new NotFoundException({
          message: `Submission ${sub.id} not available in clean storage`,
          code: 'SUBMISSION_NOT_CLEAN',
          details: { submissionId: sub.id },
        });
      }
    }

    const zipPass = new PassThrough();

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const archiver = require('archiver');
    const archive = archiver('zip', { zlib: { level: 0 } });
    archive.on('error', (err: Error) => {
      zipPass.destroy(err);
    });
    archive.pipe(zipPass);

    // Async assembly of the ZIP, without blocking return
    void (async () => {
      for (const sub of submissions) {
        try {
          if (!sub.url) continue;
          const parsed = this.parseS3Url(sub.url);
          if (!parsed || !parsed.key) continue;

          // Ensure object exists in clean bucket by attempting GetObject
          let bodyStream: any;
          const resp = await s3.send(
            new GetObjectCommand({ Bucket: cleanBucket, Key: parsed.key }),
          );
          const body = (resp as any).Body;
          if (body && typeof body.pipe === 'function') {
            bodyStream = body as Readable;
          } else if (
            body &&
            typeof body.getReader === 'function' &&
            (Readable as any).fromWeb
          ) {
            bodyStream = (Readable as any).fromWeb(body);
          } else if (Buffer.isBuffer(body)) {
            bodyStream = Readable.from(body);
          } else {
            throw new Error('Unsupported S3 Body stream type');
          }

          // Determine entry name
          let entryName: string;
          const memberId = sub.memberId ? String(sub.memberId) : '';
          const memberHandle = handleMap.get(memberId);

          const useAdminNaming = authUser.isMachine ? false : isAdminOrCopilot; // M2M uses reviewer naming by spec

          if (useAdminNaming) {
            const safeHandle =
              memberHandle ||
              (memberId ? `member-${memberId}` : 'member-unknown');
            entryName = `${safeHandle}-${sub.id}.zip`;
          } else {
            entryName = `submission-${sub.id}.zip`;
          }

          archive.append(bodyStream, { name: entryName, store: true });

          // Record access audit for each submission included (best-effort)
          try {
            await this.recordSubmissionDownload(sub.id, authUser);
          } catch (e) {
            this.logger.warn(
              `Failed to record submission access audit for ${sub.id}: ${(e as Error)?.message}`,
            );
          }
        } catch (err) {
          this.logger.warn(
            `Failed to append submission ${sub.id} to archive: ${(err as Error)?.message}`,
          );
        }
      }
      try {
        await archive.finalize();
      } catch (e) {
        zipPass.destroy(e as Error);
      }
    })();

    return {
      stream: zipPass,
      contentType: 'application/zip',
      fileName: `challenge-${challengeId}-submissions.zip`,
    };
  }

  /**
   * Create an audit record for a submission download
   */
  private async recordSubmissionDownload(
    submissionId: string,
    authUser: JwtUser,
  ): Promise<void> {
    const handle = this.deriveAuditHandle(authUser);
    await this.prisma.submissionAccessAudit.create({
      data: {
        submissionId,
        handle,
      },
    });
  }

  private deriveAuditHandle(authUser: JwtUser): string {
    if (authUser?.isMachine) {
      const clientId = authUser.userId || 'unknown-client';
      return `M2M - ${clientId}`;
    }
    return authUser?.handle || `user-${authUser?.userId || 'unknown'}`;
  }

  /**
   * Return access audit entries for the given submission
   */
  async listSubmissionAccessAudit(
    authUser: JwtUser,
    submissionId: string,
  ): Promise<SubmissionAccessAuditResponseDto[]> {
    // Only admins (user tokens) or M2M tokens with read submission scope
    if (!authUser.isMachine && !isAdmin(authUser)) {
      throw new ForbiddenException({
        message: 'Only admins can view submission access audit',
        code: 'FORBIDDEN_SUBMISSION_AUDIT_READ',
      });
    }
    if (authUser.isMachine) {
      const scopes = authUser.scopes || [];
      const hasScope =
        scopes.includes('read:submission') || scopes.includes('all:submission');
      if (!hasScope) {
        throw new ForbiddenException({
          message: 'M2M token missing required scope to read submission audit',
          code: 'FORBIDDEN_M2M_SCOPE',
        });
      }
    }

    const rows = await this.prisma.submissionAccessAudit.findMany({
      where: { submissionId },
      orderBy: { downloadedAt: 'desc' },
      select: {
        submissionId: true,
        downloadedAt: true,
        handle: true,
      },
    });

    return rows;
  }

  /**
   * Parse an S3 URL and return { bucket?, key? }
   * Supports formats:
   * - s3://bucket/key
   * - https://bucket.s3.amazonaws.com/key
   * - https://bucket.s3.<region>.amazonaws.com/key
   * - https://s3.amazonaws.com/bucket/key
   * - https://s3.<region>.amazonaws.com/bucket/key
   */
  private parseS3Url(
    url: string,
  ): { bucket?: string; key?: string } | undefined {
    try {
      if (!url) return undefined;
      if (url.startsWith('s3://')) {
        const noScheme = url.substring('s3://'.length);
        const slash = noScheme.indexOf('/');
        if (slash <= 0) return { bucket: noScheme, key: '' };
        return {
          bucket: noScheme.substring(0, slash),
          key: noScheme.substring(slash + 1),
        };
      }

      const u = new URL(url);
      const host = u.hostname || '';
      const path = u.pathname || '';

      // Virtual-hosted-style: bucket.s3.amazonaws.com or bucket.s3.<region>.amazonaws.com
      const vhMatch =
        host.match(/^(?<bucket>[^.]+)\.s3[.-][^.]+\.amazonaws\.com$/) ||
        host.match(/^(?<bucket>[^.]+)\.s3\.amazonaws\.com$/);
      if (vhMatch && (vhMatch.groups as any)?.bucket) {
        const bucket = (vhMatch.groups as any).bucket as string;
        const key = path.startsWith('/') ? path.substring(1) : path;
        return { bucket, key };
      }

      // Path-style: s3.amazonaws.com/bucket/key or s3.<region>.amazonaws.com/bucket/key
      if (host === 's3.amazonaws.com' || host.startsWith('s3.')) {
        const parts = path.split('/').filter(Boolean);
        if (parts.length >= 2) {
          const bucket = parts[0];
          const key = parts.slice(1).join('/');
          return { bucket, key };
        }
      }

      // As a fallback, try to extract after the last domain segment
      const key = path.startsWith('/') ? path.substring(1) : path;
      return { key };
    } catch {
      return undefined;
    }
  }

  async deleteArtifact(
    authUser: JwtUser,
    submissionId: string,
    artifactId: string,
  ): Promise<void> {
    const submission = await this.checkSubmission(submissionId);

    // If token is a member (non-admin), they must own the submission
    if (!isAdmin(authUser)) {
      const uid = String(authUser.userId ?? '');
      if (!uid || submission.memberId !== uid) {
        throw new ForbiddenException({
          message: 'Only the submission owner can delete artifacts',
          code: 'FORBIDDEN_ARTIFACT_DELETE',
          details: {
            submissionId,
            memberId: submission.memberId,
            requester: uid,
          },
        });
      }
    }
    const bucket = process.env.ARTIFACTS_S3_BUCKET;
    if (!bucket) {
      throw new InternalServerErrorException({
        message: 'S3 bucket not configured',
        code: 'S3_BUCKET_MISSING',
      });
    }
    const s3 = this.getS3Client();
    const prefix = `${submissionId}/${artifactId}.`;

    // List all objects under the artifact prefix, then delete in batch
    const keys: string[] = [];
    let continuationToken: string | undefined = undefined;
    try {
      do {
        const resp = await s3.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          }),
        );
        (resp.Contents || []).forEach((o) => {
          const key = o.Key;
          if (key) keys.push(key);
        });
        continuationToken = resp.IsTruncated
          ? resp.NextContinuationToken
          : undefined;
      } while (continuationToken);
    } catch (err) {
      this.logger.error(
        `Failed to list objects for deletion in S3 for submission ${submissionId}, artifact ${artifactId}: ${err?.message}`,
      );
      throw new InternalServerErrorException({
        message: 'Failed to delete artifact from storage',
        code: 'S3_DELETE_LIST_FAILED',
        details: { submissionId, artifactId },
      });
    }

    if (keys.length === 0) {
      throw new NotFoundException({
        message: `Artifact ${artifactId} not found for submission ${submissionId}`,
        code: 'ARTIFACT_NOT_FOUND',
      });
    }

    try {
      // Delete in batches of up to 1000 keys per request
      const batchSize = 1000;
      for (let i = 0; i < keys.length; i += batchSize) {
        const batch = keys.slice(i, i + batchSize).map((Key) => ({ Key }));
        await s3.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: batch, Quiet: true },
          }),
        );
      }
      this.logger.log(
        `Deleted artifact ${artifactId} for submission ${submissionId} from S3 (${keys.length} object(s))`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to delete artifact objects from S3 for submission ${submissionId}, artifact ${artifactId}: ${err?.message}`,
      );
      throw new InternalServerErrorException({
        message: 'Failed to delete artifact from storage',
        code: 'S3_DELETE_FAILED',
        details: { submissionId, artifactId },
      });
    }
  }

  private getS3Client(): S3Client {
    // Rely on ECS task role / instance role and default provider chain
    // for credentials and region resolution.
    return new S3Client({});
  }

  private sanitizeArtifactFileName(name?: string): string | undefined {
    if (!name) return undefined;
    const trimmed = name.trim();
    if (!trimmed) return undefined;
    const base = basename(trimmed);
    let sanitized = base.replace(/[^A-Za-z0-9_.-]/g, '_');
    let end = sanitized.length;
    while (end > 0 && sanitized.charCodeAt(end - 1) === 46) {
      end -= 1;
    }
    sanitized = end === sanitized.length ? sanitized : sanitized.slice(0, end);
    if (!sanitized || sanitized === '.' || sanitized === '..') {
      return undefined;
    }
    return sanitized;
  }

  private guessExtFromMime(mime?: string): string | undefined {
    if (!mime) return undefined;
    switch (mime) {
      case 'application/zip':
      case 'application/x-zip-compressed':
        return 'zip';
      case 'application/pdf':
        return 'pdf';
      case 'image/png':
        return 'png';
      case 'image/jpeg':
      case 'image/jpg':
        return 'jpg';
      case 'text/plain':
        return 'txt';
      default:
        return undefined;
    }
  }

  private getSubmissionFileName(
    submission: SubmissionMinimal,
  ): string | undefined {
    if (submission.systemFileName) {
      return submission.systemFileName;
    }

    if (!submission.url) {
      return undefined;
    }

    try {
      const baseUrl = submission.url.split('?')[0];
      const lastSlash = baseUrl.lastIndexOf('/');
      if (lastSlash >= 0 && lastSlash < baseUrl.length - 1) {
        return baseUrl.substring(lastSlash + 1);
      }
      return baseUrl;
    } catch (error) {
      this.logger.warn(
        `Unable to derive submission file name from URL for submission ${submission.id}: ${(error as Error).message}`,
      );
      return undefined;
    }
  }

  private async publishSubmissionCreateEvent(
    submission: SubmissionBusPayloadSource,
  ): Promise<void> {
    const submittedDateValue =
      submission.submittedDate instanceof Date
        ? submission.submittedDate.toISOString()
        : submission.submittedDate
          ? new Date(submission.submittedDate).toISOString()
          : null;
    const updatedAtDate =
      submission.updatedAt instanceof Date
        ? submission.updatedAt
        : submission.updatedAt
          ? new Date(submission.updatedAt)
          : submission.createdAt;

    const payload = {
      resource: 'submission',
      id: submission.id,
      type: submission.type,
      status: submission.status,
      memberId: submission.memberId ?? null,
      challengeId: submission.challengeId ?? null,
      legacyChallengeId: Utils.bigIntToNumber(submission.legacyChallengeId),
      legacySubmissionId: submission.legacySubmissionId ?? null,
      legacyUploadId: submission.legacyUploadId ?? null,
      submissionPhaseId: submission.submissionPhaseId ?? null,
      systemFileName: submission.systemFileName ?? null,
      fileType: submission.fileType ?? null,
      fileSize: submission.fileSize ?? null,
      viewCount: submission.viewCount ?? null,
      url: submission.url ?? null,
      isFileSubmission: Boolean(submission.isFileSubmission),
      submittedDate: submittedDateValue,
      created: submission.createdAt.toISOString(),
      updated: updatedAtDate.toISOString(),
      createdBy: submission.createdBy ?? null,
      updatedBy: submission.updatedBy ?? null,
      prizeId: Utils.bigIntToNumber(submission.prizeId),
    };

    await this.eventBusService.publish(
      'submission.notification.create',
      payload,
    );
    this.logger.log(
      `Published submission.notification.create event for submission ${submission.id}`,
    );
  }

  private async publishSubmissionScanEvent(
    submission: SubmissionMinimal,
  ): Promise<void> {
    const cleanBucket = process.env.SUBMISSION_CLEAN_S3_BUCKET;
    if (!cleanBucket) {
      this.logger.error('SUBMISSION_CLEAN_S3_BUCKET is not configured');
      throw new InternalServerErrorException({
        message: 'S3 bucket not configured',
        code: 'CLEAN_BUCKET_MISSING',
      });
    }

    const quarantineBucket = process.env.SUBMISSION_QUARANTINE_S3_BUCKET;
    if (!quarantineBucket) {
      this.logger.error('SUBMISSION_QUARANTINE_S3_BUCKET is not configured');
      throw new InternalServerErrorException({
        message: 'S3 bucket not configured',
        code: 'QUARANTINE_BUCKET_MISSING',
      });
    }

    if (!submission.url) {
      this.logger.error(
        `Submission ${submission.id} has no URL available for AV scan event dispatch`,
      );
      throw new InternalServerErrorException({
        message: 'Submission URL missing',
        code: 'SUBMISSION_URL_MISSING',
        details: { submissionId: submission.id },
      });
    }

    const fileName = this.getSubmissionFileName(submission);
    if (!fileName) {
      this.logger.error(
        `Unable to determine file name for submission ${submission.id} while preparing AV scan event`,
      );
      throw new InternalServerErrorException({
        message: 'Submission file name missing',
        code: 'SUBMISSION_FILE_NAME_MISSING',
        details: { submissionId: submission.id },
      });
    }

    const payload = {
      submissionId: submission.id,
      url: submission.url,
      fileName,
      moveFile: true,
      cleanDestinationBucket: cleanBucket,
      quarantineDestinationBucket: quarantineBucket,
      callbackOption: 'kafka',
      callbackKafkaTopic: 'submission.scan.complete',
    };

    await this.eventBusService.publish('avscan.action.scan', payload);
    this.logger.log(
      `Published AV scan request for submission ${submission.id} to avscan.action.scan`,
    );
  }

  private async publishTopgearSubmissionEventIfEligible(
    submission: TopgearSubmissionRecord,
  ): Promise<void> {
    if (!submission.challengeId) {
      this.logger.log(
        `Submission ${submission.id} missing challengeId. Skipping Topgear event publish.`,
      );
      return;
    }

    const challenge = await this.challengeApiService.getChallengeDetail(
      submission.challengeId,
    );

    if (!this.isTopgearTaskChallenge(challenge?.type)) {
      this.logger.log(
        `Challenge ${submission.challengeId} is not Topgear Task. Skipping immediate Topgear event for submission ${submission.id}.`,
      );
      return;
    }

    if (!submission.url) {
      throw new InternalServerErrorException({
        message:
          'Updated submission does not contain a URL required for Topgear event payload.',
        code: 'TOPGEAR_SUBMISSION_URL_MISSING',
        details: { submissionId: submission.id },
      });
    }

    if (!submission.memberId) {
      throw new InternalServerErrorException({
        message:
          'Submission is missing memberId. Cannot publish Topgear event.',
        code: 'TOPGEAR_SUBMISSION_MEMBER_MISSING',
        details: { submissionId: submission.id },
      });
    }

    const memberHandle = await this.lookupMemberHandle(
      submission.challengeId,
      submission.memberId,
    );

    if (!memberHandle) {
      throw new InternalServerErrorException({
        message: 'Unable to locate member handle for Topgear event payload.',
        code: 'TOPGEAR_MEMBER_HANDLE_MISSING',
        details: {
          submissionId: submission.id,
          challengeId: submission.challengeId,
          memberId: submission.memberId,
        },
      });
    }

    const payload: TopgearSubmissionEventPayload = {
      submissionId: submission.id,
      challengeId: submission.challengeId,
      submissionUrl: submission.url,
      memberHandle,
      memberId: submission.memberId,
      submittedDate: submission.createdAt.toISOString(),
    };

    await this.eventBusService.publish('topgear.submission.received', payload);
    this.logger.log(
      `Published topgear.submission.received event for submission ${submission.id} immediately after creation.`,
    );
  }

  private isTopgearTaskChallenge(typeName?: string): boolean {
    return (typeName ?? '').trim().toLowerCase() === 'topgear task';
  }

  private async lookupMemberHandle(
    challengeId: string,
    memberId: string,
  ): Promise<string | null> {
    const resource = await this.resourcePrisma.resource.findFirst({
      where: {
        challengeId,
        memberId,
      },
    });

    return resource?.memberHandle ?? null;
  }

  async createSubmission(
    authUser: JwtUser,
    body: SubmissionRequestDto,
    file?: Express.Multer.File,
  ) {
    console.log(`BODY: ${JSON.stringify(body)}`);

    // Enforce: non-admin, non-M2M users can only submit for themselves
    if (!isAdmin(authUser)) {
      if (!authUser.userId) {
        throw new BadRequestException({
          message: 'Authenticated user ID missing in token',
          code: 'INVALID_TOKEN',
        });
      }
      if (String(body.memberId) !== String(authUser.userId)) {
        throw new ForbiddenException({
          message:
            'memberId in request must match the authenticated user for non-admin tokens',
          code: 'MEMBER_MISMATCH',
          details: {
            tokenUserId: String(authUser.userId),
            requestMemberId: String(body.memberId),
          },
        });
      }
    }

    // Validate challenge exists and is active; capture challenge details for type/track validation
    let challengeDetails;
    try {
      challengeDetails = await this.challengeApiService.validateChallengeExists(
        body.challengeId,
      );
      this.logger.log(`Challenge ${body.challengeId} exists and is valid`);
    } catch (error) {
      throw new BadRequestException({
        message: error.message,
        code: 'INVALID_CHALLENGE',
        details: {
          challengeId: body.challengeId,
        },
      });
    }

    // Validate member is registered as submitter for the challenge
    try {
      await this.resourceApiService.validateSubmitterRegistration(
        body.challengeId,
        body.memberId,
      );
      this.logger.log(
        `Member ${body.memberId} is a valid submitter for challenge ${body.challengeId}`,
      );
    } catch (error) {
      throw new BadRequestException({
        message: error.message,
        code: 'INVALID_SUBMITTER_REGISTRATION',
        details: {
          challengeId: body.challengeId,
          memberId: body.memberId,
        },
      });
    }

    // Validate submission type against challenge type/track
    try {
      this.challengeCatalogService.ensureSubmissionTypeAllowed(
        body.type as SubmissionType,
        challengeDetails,
      );
      this.logger.log(
        `Submission type ${body.type} is valid for challenge ${body.challengeId}`,
      );
    } catch (error) {
      throw new BadRequestException({
        message: (error as Error).message,
        code: 'INVALID_SUBMISSION_TYPE_FOR_CHALLENGE',
        details: {
          challengeId: body.challengeId,
          memberId: body.memberId,
          submissionType: body.type,
        },
      });
    }

    // Validate that submission phase is open before allowing submission creation
    if (body.challengeId) {
      try {
        // Check if it's a checkpoint submission
        const isCheckpointSubmission =
          body.type === SubmissionType.CHECKPOINT_SUBMISSION;

        if (isCheckpointSubmission) {
          // For checkpoint submissions, validate checkpoint submission phase
          await this.challengeApiService.validateCheckpointSubmissionCreation(
            body.challengeId,
          );
          this.logger.log(
            `Checkpoint Submission phase is open for challenge ${body.challengeId}`,
          );
        } else {
          // For regular submissions, validate submission phase
          await this.challengeApiService.validateSubmissionCreation(
            body.challengeId,
          );
          this.logger.log(
            `Submission phase is open for challenge ${body.challengeId}`,
          );
        }
      } catch (error) {
        // Convert the error from ChallengeApiService to BadRequestException
        if (
          error.message &&
          (error.message.includes('Submission phase is not currently open') ||
            error.message.includes(
              'Checkpoint Submission phase is not currently open',
            ))
        ) {
          throw new BadRequestException({
            message: error.message,
            code: 'SUBMISSION_PHASE_CLOSED',
            details: {
              challengeId: body.challengeId,
              submissionType: body.type,
              requiredPhase:
                body.type === SubmissionType.CHECKPOINT_SUBMISSION
                  ? 'Checkpoint Submission'
                  : 'Submission',
            },
          });
        }
        // Log the error but allow submission to proceed if challenge API is unavailable
        this.logger.warn(
          `Could not validate submission phase for challenge ${body.challengeId}: ${error.message}. Proceeding with submission creation.`,
        );
      }
    }

    try {
      const hasUploadedFile =
        !!file &&
        ((typeof file.size === 'number' && file.size > 0) ||
          (file.buffer && file.buffer.length > 0));
      let hasS3Url = false;
      if (typeof body.url === 'string') {
        try {
          const urlObj = new URL(body.url);
          // Accept s3.amazonaws.com and any subdomain of s3.amazonaws.com
          const s3Hosts = ['s3.amazonaws.com'];
          // Accept region pattern: *.s3.amazonaws.com or *.s3.<region>.amazonaws.com
          const host = urlObj.host;
          hasS3Url =
            s3Hosts.includes(host) ||
            host.endsWith('.s3.amazonaws.com') ||
            /^s3\.[a-z0-9-]+\.amazonaws\.com$/.test(host) ||
            /^[^.]+\.s3\.[a-z0-9-]+\.amazonaws\.com$/.test(host);
        } catch {
          hasS3Url = false;
        }
      }
      const isFileSubmission = hasUploadedFile || hasS3Url;

      // Derive common metadata if available
      let systemFileName: string | undefined;
      let fileType: string | undefined;
      if (body.url) {
        try {
          const baseUrl = body.url.split('?')[0];
          const lastSlash = baseUrl.lastIndexOf('/');
          const fileName =
            lastSlash >= 0 ? baseUrl.substring(lastSlash + 1) : baseUrl;
          systemFileName = fileName || undefined;
          const dotIdx = fileName.lastIndexOf('.');
          if (dotIdx > 0 && dotIdx < fileName.length - 1) {
            fileType = fileName.substring(dotIdx + 1).toLowerCase();
          }
        } catch (e) {
          console.log(`Error parsing submission URL ${body.url}: ${e.message}`);
          // ignore parsing issues and leave fields undefined
        }
      }

      const data = await this.prisma.submission.create({
        data: {
          ...body,
          isFileSubmission,
          // populate commonly expected fields on create
          submittedDate: body.submittedDate
            ? new Date(body.submittedDate)
            : new Date(),
          systemFileName,
          fileType,
          viewCount: 0,
          status: SubmissionStatus.ACTIVE,
          type: body.type as SubmissionType,
          virusScan: false,
          eventRaised: false,
        },
      });
      this.logger.log(`Submission created with ID: ${data.id}`);
      if (isFileSubmission) {
        await this.publishSubmissionScanEvent(data);
      } else {
        this.logger.log(
          `Skipping AV scan event for submission ${data.id} because it is not a file-based submission.`,
        );
        await this.publishTopgearSubmissionEventIfEligible({
          id: data.id,
          challengeId: data.challengeId,
          memberId: data.memberId,
          url: data.url,
          createdAt: data.createdAt,
        });
      }
      // Increment challenge submission counters if challengeId present
      if (body.challengeId) {
        try {
          const isCheckpoint =
            body.type === SubmissionType.CHECKPOINT_SUBMISSION ||
            (data.type as unknown as string) ===
              SubmissionType.CHECKPOINT_SUBMISSION;
          if (isCheckpoint) {
            await this.challengePrisma.$executeRaw`
              UPDATE "Challenge"
              SET "numOfCheckpointSubmissions" = "numOfCheckpointSubmissions" + 1
              WHERE "id" = ${body.challengeId}
            `;
          } else {
            await this.challengePrisma.$executeRaw`
              UPDATE "Challenge"
              SET "numOfSubmissions" = "numOfSubmissions" + 1
              WHERE "id" = ${body.challengeId}
            `;
          }
        } catch (e) {
          this.logger.warn(
            `Failed to increment submission counters for challenge ${body.challengeId}: ${e.message}`,
          );
        }
      }
      await this.publishSubmissionCreateEvent(
        data as SubmissionBusPayloadSource,
      );
      await this.populateLatestSubmissionFlags([data]);
      await this.stripIsLatestForUnlimitedChallenges([data]);
      return this.buildResponse(data);
    } catch (error) {
      const errorResponse = this.prismaErrorService.handleError(
        error,
        `creating submission for challengeId: ${body.challengeId}, memberId: ${body.memberId}`,
        body,
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  async listSubmission(
    authUser: JwtUser,
    queryDto: SubmissionQueryDto,
    paginationDto?: PaginationDto,
    sortDto?: SortDto,
  ) {
    try {
      const { page = 1, perPage = 10 } = paginationDto || {};
      const skip = (page - 1) * perPage;
      type OrderByClause = Record<string, 'asc' | 'desc'>;

      const defaultOrderBy: OrderByClause[] = [
        { submittedDate: 'desc' as const },
        { createdAt: 'desc' as const },
        { updatedAt: 'desc' as const },
        { id: 'desc' as const },
      ];

      let orderBy: OrderByClause[] = [...defaultOrderBy];

      if (sortDto && sortDto.orderBy && sortDto.sortBy) {
        const direction =
          sortDto.orderBy.toLowerCase() === 'asc' ? 'asc' : 'desc';
        const primaryOrder: OrderByClause = {
          [sortDto.sortBy]: direction,
        };

        const fallbackOrder = defaultOrderBy.filter((entry) => {
          const [key] = Object.keys(entry);
          return key !== sortDto.sortBy;
        });

        orderBy = [primaryOrder, ...fallbackOrder];
      }

      const requestedMemberId = queryDto.memberId
        ? String(queryDto.memberId)
        : undefined;

      if (requestedMemberId) {
        const userId = authUser?.userId ? String(authUser.userId) : undefined;
        const isRequestingMember = userId === requestedMemberId;
        const hasCopilotRole = (authUser?.roles ?? []).includes(
          UserRole.Copilot,
        );
        const hasElevatedAccess = isAdmin(authUser) || hasCopilotRole;

        if (!hasElevatedAccess && !isRequestingMember) {
          throw new ForbiddenException({
            message:
              'You are not allowed to view submissions for the requested member',
            code: 'FORBIDDEN_SUBMISSION_ACCESS',
            details: {
              requestedMemberId,
            },
          });
        }
      }

      // Build the where clause for submissions based on available filter parameters
      const submissionWhereClause: any = {};
      if (queryDto.type) {
        submissionWhereClause.type = queryDto.type;
      }
      if (queryDto.url) {
        submissionWhereClause.url = queryDto.url;
      }
      if (queryDto.challengeId) {
        submissionWhereClause.challengeId = queryDto.challengeId;
      }
      if (requestedMemberId) {
        submissionWhereClause.memberId = requestedMemberId;
      }
      if (queryDto.legacySubmissionId) {
        submissionWhereClause.legacySubmissionId = queryDto.legacySubmissionId;
      }
      if (queryDto.legacyUploadId) {
        submissionWhereClause.legacyUploadId = queryDto.legacyUploadId;
      }
      if (queryDto.submissionPhaseId) {
        submissionWhereClause.submissionPhaseId = queryDto.submissionPhaseId;
      }

      const isPrivilegedRequester = authUser?.isMachine || isAdmin(authUser);
      const requesterUserId =
        authUser?.userId !== undefined && authUser?.userId !== null
          ? String(authUser.userId)
          : '';

      let restrictedChallengeIds = new Set<string>();
      if (!isPrivilegedRequester && requesterUserId && !queryDto.challengeId) {
        try {
          restrictedChallengeIds =
            await this.getActiveSubmitterRestrictedChallengeIds(
              requesterUserId,
              queryDto.challengeId,
            );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.debug(
            `[listSubmission] Unable to resolve submitter visibility restrictions for member ${requesterUserId}: ${message}`,
          );
        }
      }

      const whereClause: Prisma.submissionWhereInput = {
        ...submissionWhereClause,
      };

      if (
        !isPrivilegedRequester &&
        requesterUserId &&
        restrictedChallengeIds.size &&
        !queryDto.challengeId
      ) {
        const restrictedList = Array.from(restrictedChallengeIds);
        const restrictionCriteria: Prisma.submissionWhereInput = {
          OR: [
            {
              AND: [
                { challengeId: { in: restrictedList } },
                { memberId: requesterUserId },
              ],
            },
            { challengeId: { notIn: restrictedList } },
            { challengeId: null },
          ],
        };

        if (Array.isArray(whereClause.AND)) {
          whereClause.AND = [...whereClause.AND, restrictionCriteria];
        } else if (whereClause.AND) {
          whereClause.AND = [whereClause.AND, restrictionCriteria];
        } else {
          whereClause.AND = [restrictionCriteria];
        }
      }

      // find entities by filters
      let submissions = await this.prisma.submission.findMany({
        where: whereClause,
        include: {
          review: {
            include: {
              reviewItems: {
                include: REVIEW_ITEM_COMMENTS_INCLUDE,
              },
            },
          },
          reviewSummation: {},
        },
        skip,
        take: perPage,
        orderBy,
      });

      // Enrich with submitter handle and max rating (always for challenge listings)
      const shouldEnrichSubmitter =
        submissions.length > 0 &&
        (queryDto.challengeId
          ? true
          : await this.canViewSubmitterIdentity(
              authUser,
              queryDto.challengeId,
            ));
      if (shouldEnrichSubmitter) {
        try {
          const memberIds = Array.from(
            new Set(
              submissions
                .map((s) => (s.memberId ? String(s.memberId) : undefined))
                .filter((v): v is string => !!v),
            ),
          );
          if (memberIds.length) {
            const idsAsBigInt: bigint[] = [];
            for (const id of memberIds) {
              try {
                idsAsBigInt.push(BigInt(id));
              } catch (error) {
                this.logger.debug(
                  `[listSubmission] Skipping submitter ${id}: unable to convert to BigInt. ${error}`,
                );
              }
            }

            const members =
              idsAsBigInt.length > 0
                ? await this.memberPrisma.member.findMany({
                    where: { userId: { in: idsAsBigInt } },
                    include: { maxRating: true },
                  })
                : [];
            const map = new Map<
              string,
              { handle: string; maxRating: number | null }
            >();
            for (const m of members) {
              const idStr = String(m.userId);
              const rating = m.maxRating ? m.maxRating.rating : null;
              map.set(idStr, { handle: m.handle, maxRating: rating });
            }
            for (const s of submissions) {
              const key = s.memberId ? String(s.memberId) : undefined;
              if (key && map.has(key)) {
                const info = map.get(key)!;
                (s as any).submitterHandle = info.handle;
                (s as any).submitterMaxRating = info.maxRating;
              }
            }
          }
        } catch (e) {
          this.logger.warn(
            `Failed to enrich submissions with submitter info: ${(e as Error)?.message}`,
          );
        }
      }

      const reviewVisibilityContext = await this.applyReviewVisibilityFilters(
        authUser,
        submissions,
      );
      const filtered = this.filterSubmissionsForActiveSubmitters(
        authUser,
        submissions,
        reviewVisibilityContext,
      );
      submissions = filtered.submissions;
      await this.populateReviewPhaseNames(submissions);
      await this.populateReviewTypeNames(submissions);
      await this.enrichReviewerMetadata(submissions);

      // Count total entities matching the filter for pagination metadata
      let totalCount = await this.prisma.submission.count({
        where: whereClause,
      });
      if (filtered.filteredOut) {
        totalCount = submissions.length;
      }

      await this.populateLatestSubmissionFlags(submissions);
      this.stripSubmitterSubmissionDetails(
        authUser,
        submissions,
        reviewVisibilityContext,
      );
      await this.stripIsLatestForUnlimitedChallenges(submissions);

      this.logger.log(
        `Found ${submissions.length} submissions (page ${page} of ${Math.ceil(totalCount / perPage)})`,
      );

      return {
        data: submissions.map((submission) => this.buildResponse(submission)),
        meta: {
          page,
          perPage,
          totalCount,
          totalPages: Math.ceil(totalCount / perPage),
        },
      };
    } catch (error) {
      const errorResponse = this.prismaErrorService.handleError(
        error,
        `listing submissions with filters: ${JSON.stringify(queryDto)}`,
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  private async canViewSubmitterIdentity(
    authUser: JwtUser,
    challengeId?: string,
  ): Promise<boolean> {
    // M2M tokens: require read:submission or all:submission scope
    if (authUser.isMachine) {
      const scopes = authUser.scopes || [];
      return (
        scopes.includes('read:submission') || scopes.includes('all:submission')
      );
    }
    // Admins always allowed
    if (isAdmin(authUser)) {
      return true;
    }
    // Copilots on the challenge are allowed
    if (challengeId && authUser.userId) {
      try {
        const resources = await this.resourceApiService.getMemberResourcesRoles(
          challengeId,
          String(authUser.userId),
        );
        return resources.some((r) =>
          (r.roleName || '').toLowerCase().includes('copilot'),
        );
      } catch {
        return false;
      }
    }
    return false;
  }

  async countSubmissionsForChallenge(challengeId: string): Promise<number> {
    try {
      const count = await this.prisma.submission.count({
        where: {
          challengeId,
        },
      });
      this.logger.log(
        `Found ${count} submissions for challenge ${challengeId}`,
      );
      return count;
    } catch (error) {
      const errorResponse = this.prismaErrorService.handleError(
        error,
        `counting submissions for challengeId: ${challengeId}`,
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  async getSubmission(submissionId: string): Promise<SubmissionResponseDto> {
    const data = await this.checkSubmission(submissionId);
    await this.populateLatestSubmissionFlags([data]);
    await this.stripIsLatestForUnlimitedChallenges([data]);
    return this.buildResponse(data);
  }

  async updateSubmission(
    authUser: JwtUser,
    submissionId: string,
    body: SubmissionUpdateRequestDto,
  ) {
    try {
      const existing = await this.checkSubmission(submissionId);

      // Validate submittedDate is not in the future (if provided)
      if (body.submittedDate) {
        const submitted = new Date(body.submittedDate);
        const now = new Date();
        if (isNaN(submitted.getTime())) {
          throw new BadRequestException({
            message: 'submittedDate must be a valid ISO date string',
            code: 'INVALID_SUBMITTED_DATE',
            details: { submittedDate: body.submittedDate },
          });
        }
        if (submitted.getTime() > now.getTime()) {
          throw new BadRequestException({
            message: 'submittedDate cannot be in the future',
            code: 'INVALID_SUBMITTED_DATE',
            details: { submittedDate: body.submittedDate },
          });
        }
      }

      // If challengeId is provided, ensure it matches the submission's existing challengeId
      if (
        body.challengeId !== undefined &&
        String(body.challengeId) !== String(existing.challengeId ?? '')
      ) {
        throw new BadRequestException({
          message:
            'The submission being updated must be associated with the provided challengeId',
          code: 'SUBMISSION_CHALLENGE_MISMATCH',
          details: {
            submissionId,
            existingChallengeId: existing.challengeId,
            providedChallengeId: body.challengeId,
          },
        });
      }

      // For non-admin tokens, memberId (if provided) must match the token userId
      if (!isAdmin(authUser) && body.memberId !== undefined) {
        if (!authUser.userId) {
          throw new BadRequestException({
            message: 'Authenticated user ID missing in token',
            code: 'INVALID_TOKEN',
          });
        }
        if (String(body.memberId) !== String(authUser.userId)) {
          throw new ForbiddenException({
            message:
              'memberId in request must match the authenticated user for non-admin tokens',
            code: 'MEMBER_MISMATCH',
            details: {
              tokenUserId: String(authUser.userId),
              requestMemberId: String(body.memberId),
            },
          });
        }
      }

      // If caller attempts to change memberId or challengeId, validate registration
      const effectiveChallengeId =
        body.challengeId !== undefined
          ? body.challengeId
          : existing.challengeId;
      const effectiveMemberId =
        body.memberId !== undefined ? body.memberId : existing.memberId;

      if (body.memberId !== undefined || body.challengeId !== undefined) {
        // If challengeId is provided, ensure it exists
        if (body.challengeId) {
          try {
            await this.challengeApiService.validateChallengeExists(
              body.challengeId,
            );
          } catch (error) {
            throw new BadRequestException({
              message: error.message,
              code: 'INVALID_CHALLENGE',
              details: { challengeId: body.challengeId },
            });
          }
        }

        if (effectiveChallengeId && effectiveMemberId) {
          try {
            await this.resourceApiService.validateSubmitterRegistration(
              effectiveChallengeId,
              effectiveMemberId,
            );
          } catch (error) {
            throw new BadRequestException({
              message: error.message,
              code: 'INVALID_SUBMITTER_REGISTRATION',
              details: {
                challengeId: effectiveChallengeId,
                memberId: effectiveMemberId,
              },
            });
          }
        }
      }

      const data = await this.prisma.submission.update({
        where: { id: submissionId },
        data: {
          ...body,
          type: (body.type as SubmissionType) || existing.type,
        },
      });
      this.logger.log(`Submission updated successfully: ${submissionId}`);
      return this.buildResponse(data);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }

      const errorResponse = this.prismaErrorService.handleError(
        error,
        `updating submission with ID: ${submissionId}`,
      );

      if (errorResponse.code === 'RECORD_NOT_FOUND') {
        throw new NotFoundException({
          message: `Submission with ID ${submissionId} not found. Cannot update non-existent submission.`,
          details: { submissionId },
        });
      }

      const badRequestCodes = [
        'FOREIGN_KEY_CONSTRAINT_FAILED',
        'INVALID_DATA',
        'VALIDATION_ERROR',
        'REQUIRED_FIELD_MISSING',
        'MISSING_REQUIRED_VALUE',
        'DATA_VALIDATION_ERROR',
      ];

      if (badRequestCodes.includes(errorResponse.code)) {
        throw new BadRequestException({
          message: errorResponse.message,
          code: errorResponse.code,
          details: errorResponse.details,
        });
      }

      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  async deleteSubmission(authUser: JwtUser, id: string) {
    try {
      const existing = await this.checkSubmission(id);
      // Authorization checks
      if (authUser.isMachine) {
        const scopes = authUser.scopes || [];
        const hasScope =
          scopes.includes('delete:submission') ||
          scopes.includes('all:submission');
        if (!hasScope) {
          throw new ForbiddenException({
            message: 'M2M token missing required scope to delete submission',
            code: 'FORBIDDEN_M2M_SCOPE',
          });
        }
      } else if (!isAdmin(authUser)) {
        const uid = String(authUser.userId ?? '');
        if (!uid || String(existing.memberId) !== uid) {
          throw new ForbiddenException({
            message:
              'Only the submission owner or an admin can delete this submission',
            code: 'FORBIDDEN_SUBMISSION_DELETE',
            details: {
              submissionId: id,
              memberId: existing.memberId,
              requester: uid,
            },
          });
        }
      }
      const TERMINAL_STATUSES = [
        'COMPLETED',
        'FAILURE',
        'CANCELLED',
        'SUCCESS',
      ];

      const runs = await this.prisma.aiWorkflowRun.findMany({
        where: { submissionId: id },
        select: { id: true, status: true },
      });

      if (runs.length > 0) {
        const nonTerminal = runs.filter(
          (r) => !TERMINAL_STATUSES.includes(r.status),
        );

        if (nonTerminal.length > 0) {
          throw new Error(
            `Cannot delete submission: ${nonTerminal.length} workflow run(s) still active.`,
          );
        }

        await this.prisma.aiWorkflowRun.deleteMany({
          where: { submissionId: id },
        });
      }

      await this.prisma.submission.delete({
        where: { id },
      });
      console.log(`Challenge ID: ${existing.challengeId}`);
      // Decrement challenge submission counters if challengeId present
      if (existing.challengeId) {
        try {
          const isCheckpoint =
            existing.type === SubmissionType.CHECKPOINT_SUBMISSION;
          if (isCheckpoint) {
            await this.challengePrisma.$executeRaw`
              UPDATE "Challenge"
              SET "numOfCheckpointSubmissions" = GREATEST("numOfCheckpointSubmissions" - 1, 0)
              WHERE "id" = ${existing.challengeId}
            `;
          } else {
            await this.challengePrisma.$executeRaw`
              UPDATE "Challenge"
              SET "numOfSubmissions" = GREATEST("numOfSubmissions" - 1, 0)
              WHERE "id" = ${existing.challengeId}
            `;
          }
        } catch (e) {
          this.logger.warn(
            `Failed to decrement submission counters for challenge ${existing.challengeId}: ${e.message}`,
          );
        }
      }
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      if (error instanceof ForbiddenException) {
        throw error;
      }
      const errorResponse = this.prismaErrorService.handleError(
        error,
        `deleting submission with ID: ${id}`,
      );

      if (errorResponse.code === 'RECORD_NOT_FOUND') {
        throw new NotFoundException({
          message: `Submission with ID ${id} not found. Cannot delete non-existent submission.`,
          details: { submissionId: id },
        });
      }

      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  private async checkSubmission(id: string) {
    const data = await this.prisma.submission.findUnique({
      where: { id },
      include: { review: true, reviewSummation: true },
    });
    if (!data || !data.id) {
      throw new NotFoundException({
        message: `Submission with ID ${id} not found. Please check the ID and try again.`,
        details: { submissionId: id },
      });
    }
    await this.populateReviewPhaseNames([data]);
    await this.populateReviewTypeNames([data]);
    return data;
  }

  private async applyReviewVisibilityFilters(
    authUser: JwtUser,
    submissions: Array<{
      challengeId?: string | null;
      memberId?: string | null;
      review?: unknown;
    }>,
  ): Promise<ReviewVisibilityContext> {
    const emptyContext: ReviewVisibilityContext = {
      roleSummaryByChallenge: new Map(),
      challengeDetailsById: new Map(),
      requesterUserId: '',
    };

    if (!submissions.length) {
      return emptyContext;
    }

    const requesterUserId =
      authUser?.userId !== undefined && authUser?.userId !== null
        ? String(authUser.userId).trim()
        : '';

    const isPrivilegedRequester = authUser?.isMachine || isAdmin(authUser);
    if (!isPrivilegedRequester && !requesterUserId) {
      for (const submission of submissions) {
        if (Object.prototype.hasOwnProperty.call(submission, 'review')) {
          delete (submission as any).review;
        }
        if (
          Object.prototype.hasOwnProperty.call(submission, 'reviewSummation')
        ) {
          delete (submission as any).reviewSummation;
        }
      }
      return {
        ...emptyContext,
        requesterUserId,
      };
    }

    if (isPrivilegedRequester) {
      return {
        ...emptyContext,
        requesterUserId,
      };
    }

    const uid = requesterUserId;

    if (!uid) {
      return {
        ...emptyContext,
        requesterUserId,
      };
    }

    const challengeIds = Array.from(
      new Set(
        submissions
          .map((submission) => {
            if (submission.challengeId == null) {
              return null;
            }
            const id = String(submission.challengeId).trim();
            return id.length ? id : null;
          })
          .filter((value): value is string => !!value),
      ),
    );

    if (!challengeIds.length) {
      return {
        ...emptyContext,
        requesterUserId: uid,
      };
    }

    const challengeDetails = new Map<string, ChallengeData | null>();
    const passingSubmissionCache = new Map<string, boolean>();

    await Promise.all(
      challengeIds.map(async (challengeId) => {
        try {
          const detail =
            await this.challengeApiService.getChallengeDetail(challengeId);
          challengeDetails.set(challengeId, detail);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.debug(
            `[applyReviewVisibilityFilters] Failed to load challenge ${challengeId}: ${message}`,
          );
          challengeDetails.set(challengeId, null);
        }
      }),
    );

    const roleSummaryByChallenge = new Map<string, ChallengeRoleSummary>();

    await Promise.all(
      challengeIds.map(async (challengeId) => {
        let resources: ResourceInfo[] = [];
        try {
          resources = await this.resourceApiService.getMemberResourcesRoles(
            challengeId,
            uid,
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.debug(
            `[applyReviewVisibilityFilters] Failed to load resource roles for challenge ${challengeId}, member ${uid}: ${message}`,
          );
        }

        let hasCopilot = false;
        let hasReviewer = false;
        let hasSubmitter = false;
        const reviewerResourceIds: string[] = [];

        for (const resource of resources ?? []) {
          const roleName = (resource.roleName || '').toLowerCase();
          if (roleName.includes('copilot')) {
            hasCopilot = true;
          }
          if (
            REVIEW_ACCESS_ROLE_KEYWORDS.some((keyword) =>
              roleName.includes(keyword),
            )
          ) {
            hasReviewer = true;
            const resourceId = String(resource.id ?? '').trim();
            if (resourceId && !reviewerResourceIds.includes(resourceId)) {
              reviewerResourceIds.push(resourceId);
            }
          }
          if (
            resource.roleId === CommonConfig.roles.submitterRoleId ||
            roleName.includes('submitter')
          ) {
            hasSubmitter = true;
          }
        }

        roleSummaryByChallenge.set(challengeId, {
          hasCopilot,
          hasReviewer,
          hasSubmitter,
          reviewerResourceIds,
        });
      }),
    );

    for (const submission of submissions) {
      if (!Object.prototype.hasOwnProperty.call(submission, 'review')) {
        continue;
      }

      const challengeId =
        submission.challengeId != null
          ? String(submission.challengeId).trim()
          : '';
      if (!challengeId) {
        continue;
      }

      const isOwnSubmission =
        submission.memberId != null &&
        String(submission.memberId).trim() === uid;

      const roleSummary = roleSummaryByChallenge.get(challengeId) ?? {
        hasCopilot: false,
        hasReviewer: false,
        hasSubmitter: false,
        reviewerResourceIds: [],
      };

      const challenge = challengeDetails.get(challengeId);

      if (roleSummary.hasCopilot) {
        continue;
      }

      if (isOwnSubmission) {
        const reviews = Array.isArray((submission as any).review)
          ? ((submission as any).review as Array<Record<string, any>>)
          : [];

        if (!reviews.length) {
          continue;
        }

        const allowedPhaseNames = [
          'checkpoint screening',
          'checkpoint review',
          'screening',
          'review',
          'iterative review',
          'approval',
        ];
        const normalizedAllowedPhases = new Set(
          allowedPhaseNames.map((name) => this.normalizePhaseName(name)),
        );
        const phaseCompletionCache = new Map<string, boolean>();
        const getPhaseCompletion = (
          phaseName: string | null | undefined,
        ): boolean => {
          const normalized = this.normalizePhaseName(phaseName);
          if (!normalized.length) {
            return false;
          }
          if (phaseCompletionCache.has(normalized)) {
            return phaseCompletionCache.get(normalized) ?? false;
          }
          if (!challenge) {
            phaseCompletionCache.set(normalized, false);
            return false;
          }
          const candidates: string[] = [];
          if (phaseName && String(phaseName).trim().length > 0) {
            candidates.push(String(phaseName));
          }
          if (!candidates.includes(normalized)) {
            candidates.push(normalized);
          }
          const completed = this.hasChallengePhaseCompleted(
            challenge,
            candidates,
          );
          phaseCompletionCache.set(normalized, completed);
          return completed;
        };

        const challengeForPhaseResolution = challenge ?? null;
        const filteredReviews: Array<Record<string, any>> = [];

        for (const review of reviews) {
          if (!review || typeof review !== 'object') {
            continue;
          }

          const phaseId =
            review.phaseId !== undefined && review.phaseId !== null
              ? String(review.phaseId).trim()
              : '';
          const resolvedPhaseName = this.getPhaseNameFromId(
            challengeForPhaseResolution,
            phaseId,
          );
          const normalizedPhaseName =
            this.normalizePhaseName(resolvedPhaseName);

          const phaseAllowed = normalizedAllowedPhases.has(normalizedPhaseName);
          const phaseCompleted =
            phaseAllowed && getPhaseCompletion(resolvedPhaseName);

          if (phaseAllowed && phaseCompleted) {
            filteredReviews.push(review);
            continue;
          }

          review.initialScore = null;
          review.finalScore = null;
          if (Array.isArray(review.reviewItems)) {
            review.reviewItems = [];
          } else {
            review.reviewItems = [];
          }
        }

        if (!filteredReviews.length) {
          (submission as any).review = reviews;
        } else if (filteredReviews.length !== reviews.length) {
          (submission as any).review = filteredReviews;
        }

        continue;
      }

      if (roleSummary.hasReviewer) {
        const reviews = Array.isArray((submission as any).review)
          ? ((submission as any).review as Array<Record<string, any>>)
          : [];

        if (reviews.length) {
          const challengeCompletedOrCancelled =
            this.isCompletedOrCancelledStatus(challenge?.status ?? null);

          if (!challengeCompletedOrCancelled) {
            for (const review of reviews) {
              if (!review || typeof review !== 'object') {
                continue;
              }

              const resourceId = String(review.resourceId ?? '').trim();
              const ownsReview =
                resourceId.length > 0 &&
                roleSummary.reviewerResourceIds.includes(resourceId);
              const resolvedPhaseName = this.getPhaseNameFromId(
                challenge,
                (review as any).phaseId ?? null,
              );
              const normalizedPhaseName =
                this.normalizePhaseName(resolvedPhaseName);
              const isScreeningPhase =
                normalizedPhaseName === 'screening' ||
                normalizedPhaseName === 'checkpoint screening';

              if (!ownsReview) {
                if (!isScreeningPhase) {
                  review.initialScore = null;
                  review.finalScore = null;
                  review.reviewItems = Array.isArray(review.reviewItems)
                    ? []
                    : [];
                } else {
                  review.initialScore =
                    typeof review.initialScore === 'number'
                      ? review.initialScore
                      : (review.initialScore ?? null);
                  review.finalScore =
                    typeof review.finalScore === 'number'
                      ? review.finalScore
                      : (review.finalScore ?? null);
                }
              }
            }
          }
        }

        continue;
      }

      if (this.isCompletedOrCancelledStatus(challenge?.status ?? null)) {
        if (challenge?.status === ChallengeStatus.COMPLETED) {
          continue;
        }
        let hasPassingSubmission = passingSubmissionCache.get(challengeId);
        if (hasPassingSubmission === undefined) {
          hasPassingSubmission =
            await this.hasPassingSubmissionForReviewScorecard(challengeId, uid);
          passingSubmissionCache.set(challengeId, hasPassingSubmission);
        }

        if (hasPassingSubmission) {
          continue;
        }

        delete (submission as any).review;
        continue;
      }

      if (!roleSummary.hasSubmitter) {
        delete (submission as any).review;
        continue;
      }

      if (this.isMarathonMatchChallenge(challenge ?? null)) {
        continue;
      }

      const reviews = Array.isArray((submission as any).review)
        ? ((submission as any).review as Array<Record<string, any>>)
        : [];

      if (!reviews.length) {
        delete (submission as any).review;
        continue;
      }

      const challengeStatus = challenge?.status ?? null;
      if (!challenge || challengeStatus === ChallengeStatus.ACTIVE) {
        delete (submission as any).review;
        continue;
      }
    }
    return {
      roleSummaryByChallenge,
      challengeDetailsById: challengeDetails,
      requesterUserId: uid,
    };
  }

  private async enrichReviewerMetadata(
    submissions: Array<{ review?: unknown }>,
  ): Promise<void> {
    const reviews: Array<Record<string, any>> = [];

    for (const submission of submissions) {
      const reviewList = Array.isArray((submission as any).review)
        ? ((submission as any).review as Array<Record<string, any>>)
        : [];

      for (const review of reviewList) {
        if (review && typeof review === 'object') {
          reviews.push(review);
        }
      }
    }

    if (!reviews.length) {
      return;
    }

    const resourceIds = Array.from(
      new Set(
        reviews
          .map((review) => String(review.resourceId ?? '').trim())
          .filter((id) => id.length > 0),
      ),
    );

    if (!resourceIds.length) {
      for (const review of reviews) {
        if (!Object.prototype.hasOwnProperty.call(review, 'reviewerHandle')) {
          review.reviewerHandle = null;
        }
        if (
          !Object.prototype.hasOwnProperty.call(review, 'reviewerMaxRating')
        ) {
          review.reviewerMaxRating = null;
        }
      }
      return;
    }

    try {
      const resources = await this.resourcePrisma.resource.findMany({
        where: { id: { in: resourceIds } },
        select: { id: true, memberId: true },
      });

      const memberIds = Array.from(
        new Set(
          resources
            .map((resource) => String(resource.memberId ?? '').trim())
            .filter((id) => id.length > 0),
        ),
      );

      const memberIdsAsBigInt: bigint[] = [];
      for (const id of memberIds) {
        try {
          memberIdsAsBigInt.push(BigInt(id));
        } catch (error) {
          this.logger.debug(
            `[enrichReviewerMetadata] Skipping reviewer memberId ${id}: unable to convert to BigInt. ${error}`,
          );
        }
      }

      const memberInfoById = new Map<
        string,
        { handle: string | null; maxRating: number | null }
      >();

      if (memberIdsAsBigInt.length) {
        const members = await this.memberPrisma.member.findMany({
          where: { userId: { in: memberIdsAsBigInt } },
          select: {
            userId: true,
            handle: true,
            maxRating: { select: { rating: true } },
          },
        });

        members.forEach((member) => {
          memberInfoById.set(member.userId.toString(), {
            handle: member.handle ?? null,
            maxRating: member.maxRating?.rating ?? null,
          });
        });
      }

      const profileByResourceId = new Map<
        string,
        { handle: string | null; maxRating: number | null }
      >();

      resources.forEach((resource) => {
        const resourceId = String(resource.id ?? '').trim();
        if (!resourceId) {
          return;
        }
        const memberId = String(resource.memberId ?? '').trim();
        const profile = memberInfoById.get(memberId) ?? {
          handle: null,
          maxRating: null,
        };
        profileByResourceId.set(resourceId, profile);
      });

      for (const review of reviews) {
        const resourceId = String(review.resourceId ?? '').trim();
        const profile = resourceId ? profileByResourceId.get(resourceId) : null;
        review.reviewerHandle = profile?.handle ?? null;
        review.reviewerMaxRating = profile?.maxRating ?? null;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[enrichReviewerMetadata] Failed to enrich reviewer metadata: ${message}`,
      );
    } finally {
      for (const review of reviews) {
        if (!Object.prototype.hasOwnProperty.call(review, 'reviewerHandle')) {
          review.reviewerHandle = null;
        }
        if (
          !Object.prototype.hasOwnProperty.call(review, 'reviewerMaxRating')
        ) {
          review.reviewerMaxRating = null;
        }
      }
    }
  }

  private async populateReviewPhaseNames(
    submissions: Array<{ challengeId?: string | null; review?: unknown }>,
  ): Promise<void> {
    const reviewEntries: Array<{
      review: Record<string, any>;
      challengeId: string;
    }> = [];

    for (const submission of submissions) {
      const challengeId =
        submission.challengeId !== undefined && submission.challengeId !== null
          ? String(submission.challengeId).trim()
          : '';
      if (!challengeId) {
        continue;
      }

      const reviewList = Array.isArray((submission as any).review)
        ? ((submission as any).review as Array<Record<string, any>>)
        : [];

      for (const review of reviewList) {
        if (review && typeof review === 'object') {
          reviewEntries.push({ review, challengeId });
        }
      }
    }

    if (!reviewEntries.length) {
      return;
    }

    const phaseMapByChallenge = new Map<string, Map<string, string | null>>();
    const uniqueChallengeIds = Array.from(
      new Set(reviewEntries.map((entry) => entry.challengeId)),
    );

    await Promise.all(
      uniqueChallengeIds.map(async (challengeId) => {
        try {
          const challenge =
            await this.challengeApiService.getChallengeDetail(challengeId);
          const phases = Array.isArray(challenge?.phases)
            ? (challenge?.phases as Array<Record<string, any>>)
            : [];
          const phaseMap = new Map<string, string | null>();

          for (const phase of phases) {
            if (!phase || typeof phase !== 'object') {
              continue;
            }

            const rawName =
              typeof (phase as any).name === 'string'
                ? ((phase as any).name as string)
                : null;
            const normalizedName =
              rawName && rawName.trim().length ? rawName.trim() : rawName;
            const identifiers = [
              String((phase as any)?.id ?? '').trim(),
              String((phase as any)?.phaseId ?? '').trim(),
            ].filter(
              (value, index, arr) =>
                value.length > 0 && arr.indexOf(value) === index,
            );

            for (const identifier of identifiers) {
              phaseMap.set(identifier, normalizedName ?? rawName ?? null);
            }
          }

          phaseMapByChallenge.set(challengeId, phaseMap);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `[populateReviewPhaseNames] Failed to load phases for challenge ${challengeId}: ${message}`,
          );
          phaseMapByChallenge.set(challengeId, new Map());
        }
      }),
    );

    for (const { review } of reviewEntries) {
      if (!Object.prototype.hasOwnProperty.call(review, 'phaseName')) {
        review.phaseName = null;
      }
    }

    for (const { review, challengeId } of reviewEntries) {
      const phaseId = String(review.phaseId ?? '').trim();
      if (!phaseId) {
        review.phaseName = null;
        continue;
      }

      const phaseMap = phaseMapByChallenge.get(challengeId);
      if (!phaseMap?.size) {
        review.phaseName = null;
        continue;
      }

      review.phaseName = phaseMap.get(phaseId) ?? null;
    }
  }

  private async populateReviewTypeNames(
    submissions: Array<{ review?: unknown }>,
  ): Promise<void> {
    const reviews: Array<Record<string, any>> = [];

    for (const submission of submissions) {
      const reviewList = Array.isArray((submission as any).review)
        ? ((submission as any).review as Array<Record<string, any>>)
        : [];

      for (const review of reviewList) {
        if (review && typeof review === 'object') {
          reviews.push(review);
        }
      }
    }

    if (!reviews.length) {
      return;
    }

    const typeIds = Array.from(
      new Set(
        reviews
          .map((review) => String(review.typeId ?? '').trim())
          .filter((id) => id.length > 0),
      ),
    );

    if (!typeIds.length) {
      for (const review of reviews) {
        if (!Object.prototype.hasOwnProperty.call(review, 'reviewType')) {
          review.reviewType = null;
        }
      }
      return;
    }

    try {
      const reviewTypes = await this.prisma.reviewType.findMany({
        where: { id: { in: typeIds } },
        select: { id: true, name: true },
      });

      const typeNameById = new Map<string, string | null>();
      for (const entry of reviewTypes) {
        const identifier = String(entry.id ?? '').trim();
        if (!identifier) {
          continue;
        }
        let label: string | null = null;
        if (typeof entry.name === 'string') {
          const trimmed = entry.name.trim();
          label = trimmed.length ? trimmed : entry.name;
        }
        typeNameById.set(identifier, label);
      }

      for (const review of reviews) {
        const typeId = String(review.typeId ?? '').trim();
        if (!typeId) {
          review.reviewType = null;
          continue;
        }
        review.reviewType = typeNameById.get(typeId) ?? null;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[populateReviewTypeNames] Failed to enrich review types: ${message}`,
      );
    } finally {
      for (const review of reviews) {
        if (!Object.prototype.hasOwnProperty.call(review, 'reviewType')) {
          review.reviewType = null;
        }
      }
    }
  }

  private async populateLatestSubmissionFlags(
    submissions: Array<{
      id: string;
      challengeId?: string | null;
      memberId?: string | null;
    }>,
  ): Promise<void> {
    if (!submissions.length) {
      return;
    }

    const uniquePairs = new Map<
      string,
      { challengeId: string; memberId: string }
    >();

    for (const submission of submissions) {
      (submission as any).isLatest = false;
      const challengeId =
        submission.challengeId !== undefined && submission.challengeId !== null
          ? String(submission.challengeId)
          : null;
      const memberId =
        submission.memberId !== undefined && submission.memberId !== null
          ? String(submission.memberId)
          : null;

      if (!challengeId || !memberId) {
        continue;
      }

      const key = `${challengeId}::${memberId}`;
      if (!uniquePairs.has(key)) {
        uniquePairs.set(key, { challengeId, memberId });
      }
    }

    if (!uniquePairs.size) {
      return;
    }

    const challengeIds = Array.from(
      new Set(
        Array.from(uniquePairs.values()).map((entry) => entry.challengeId),
      ),
    );
    const memberIds = Array.from(
      new Set(Array.from(uniquePairs.values()).map((entry) => entry.memberId)),
    );

    if (!challengeIds.length || !memberIds.length) {
      return;
    }

    try {
      // Use a single windowed query to locate the latest submission per (challengeId, memberId)
      const latestEntries = await this.prisma.$queryRaw<
        Array<{ id: string }>
      >(Prisma.sql`
        SELECT "id"
        FROM (
          SELECT
            "id",
            ROW_NUMBER() OVER (
              PARTITION BY "challengeId", "memberId"
              ORDER BY "submittedDate" DESC NULLS LAST,
                       "createdAt" DESC,
                       "updatedAt" DESC NULLS LAST
            ) AS row_num
          FROM "submission"
          WHERE "challengeId" IN (${Prisma.join(challengeIds)})
            AND "memberId" IN (${Prisma.join(memberIds)})
        ) ranked
        WHERE row_num = 1
      `);

      const latestIds = new Set(
        latestEntries
          .map((entry) => String(entry.id ?? '').trim())
          .filter((id) => id.length > 0),
      );

      for (const submission of submissions) {
        if (latestIds.has(submission.id)) {
          (submission as any).isLatest = true;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[populateLatestSubmissionFlags] Failed to resolve latest submissions via bulk query: ${message}`,
      );
      throw error;
    }
  }

  private async getActiveSubmitterRestrictedChallengeIds(
    userId: string,
    challengeId?: string,
  ): Promise<Set<string>> {
    const restricted = new Set<string>();
    if (!userId) {
      return restricted;
    }

    const summaryByChallenge = new Map<
      string,
      { hasSubmitter: boolean; hasCopilot: boolean; hasReviewer: boolean }
    >();

    const accumulateRole = (
      challengeKey: string,
      roleId?: string | null,
      roleName?: string | null,
    ) => {
      if (!challengeKey) {
        return;
      }
      const normalizedRoleName = (roleName ?? '').toLowerCase();
      const summary = summaryByChallenge.get(challengeKey) ?? {
        hasSubmitter: false,
        hasCopilot: false,
        hasReviewer: false,
      };
      if (
        (roleId && roleId === CommonConfig.roles.submitterRoleId) ||
        normalizedRoleName.includes('submitter')
      ) {
        summary.hasSubmitter = true;
      }
      if (normalizedRoleName.includes('copilot')) {
        summary.hasCopilot = true;
      }
      if (
        REVIEW_ACCESS_ROLE_KEYWORDS.some((keyword) =>
          normalizedRoleName.includes(keyword),
        )
      ) {
        summary.hasReviewer = true;
      }
      summaryByChallenge.set(challengeKey, summary);
    };

    let resourcesLoaded = false;
    try {
      const resources = await this.resourceApiService.getMemberResourcesRoles(
        challengeId,
        userId,
      );
      for (const resource of resources ?? []) {
        const challengeKey = String(resource.challengeId ?? '').trim();
        accumulateRole(challengeKey, resource.roleId, resource.roleName ?? '');
      }
      resourcesLoaded = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.debug(
        `[getActiveSubmitterRestrictedChallengeIds] Failed to load resource roles via API for member ${userId}: ${message}`,
      );
    }

    if (!resourcesLoaded) {
      if (challengeId) {
        accumulateRole(challengeId, CommonConfig.roles.submitterRoleId, null);
      } else {
        try {
          const fallbackResources = await this.resourcePrisma.resource.findMany(
            {
              where: { memberId: userId },
              select: { challengeId: true, roleId: true },
            },
          );
          for (const resource of fallbackResources) {
            const challengeKey = String(resource.challengeId ?? '').trim();
            accumulateRole(challengeKey, resource.roleId, null);
          }
        } catch (fallbackError) {
          const fallbackMessage =
            fallbackError instanceof Error
              ? fallbackError.message
              : String(fallbackError);
          this.logger.debug(
            `[getActiveSubmitterRestrictedChallengeIds] Fallback resource lookup failed for member ${userId}: ${fallbackMessage}`,
          );
        }
      }
    }

    const candidateIds = Array.from(summaryByChallenge.entries())
      .filter(([, summary]) => summary.hasSubmitter)
      .filter(([, summary]) => !summary.hasCopilot && !summary.hasReviewer)
      .map(([challengeKey]) => challengeKey)
      .filter((id) => id);

    if (!candidateIds.length) {
      return restricted;
    }

    try {
      let details: ChallengeData[] = [];
      if (candidateIds.length === 1) {
        const detail = await this.challengeApiService.getChallengeDetail(
          candidateIds[0],
        );
        details = detail ? [detail] : [];
      } else {
        details = await this.challengeApiService.getChallenges(candidateIds);
      }
      const detailById = new Map<string, ChallengeData>();
      for (const detail of details ?? []) {
        if (detail?.id) {
          detailById.set(detail.id, detail);
        }
      }
      for (const id of candidateIds) {
        const detail = detailById.get(id);
        if (!detail) {
          restricted.add(id);
          continue;
        }
        if (!this.isCompletedOrCancelledStatus(detail.status)) {
          restricted.add(id);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.debug(
        `[getActiveSubmitterRestrictedChallengeIds] Unable to resolve challenge statuses for submitter visibility: ${message}`,
      );
      candidateIds.forEach((id) => restricted.add(id));
    }

    return restricted;
  }

  private filterSubmissionsForActiveSubmitters<
    T extends {
      challengeId?: string | null;
      memberId?: string | null;
    } & Record<string, unknown>,
  >(
    authUser: JwtUser,
    submissions: T[],
    visibilityContext: ReviewVisibilityContext,
  ): {
    submissions: T[];
    filteredOut: boolean;
  } {
    if (!submissions.length) {
      return { submissions, filteredOut: false };
    }
    if (authUser?.isMachine || isAdmin(authUser)) {
      return { submissions, filteredOut: false };
    }

    const uid = visibilityContext.requesterUserId;
    if (!uid) {
      return { submissions, filteredOut: false };
    }

    const filtered = submissions.filter((submission) => {
      const challengeId =
        submission.challengeId !== undefined && submission.challengeId !== null
          ? String(submission.challengeId).trim()
          : '';
      if (!challengeId) {
        return true;
      }

      const memberIdValue =
        submission.memberId !== undefined && submission.memberId !== null
          ? String(submission.memberId).trim()
          : null;
      if (memberIdValue && memberIdValue === uid) {
        return true;
      }

      const roleSummary =
        visibilityContext.roleSummaryByChallenge.get(challengeId);
      if (!roleSummary) {
        return false;
      }
      if (roleSummary.hasCopilot || roleSummary.hasReviewer) {
        return true;
      }
      if (!roleSummary.hasSubmitter) {
        return true;
      }

      const challengeDetail =
        visibilityContext.challengeDetailsById.get(challengeId);
      if (challengeDetail == null) {
        return false;
      }
      return true;
    });

    return {
      submissions: filtered,
      filteredOut: filtered.length !== submissions.length,
    };
  }

  private stripSubmitterMemberIds(
    authUser: JwtUser,
    submissions: Array<
      { challengeId?: string | null; memberId?: string | null } & Record<
        string,
        unknown
      >
    >,
    visibilityContext: ReviewVisibilityContext,
  ): void {
    if (!submissions.length) {
      return;
    }
    if (authUser?.isMachine || isAdmin(authUser)) {
      return;
    }

    const uid = visibilityContext.requesterUserId;
    this.logger.debug(
      `[stripSubmitterSubmissionDetails] requesterUserId=${uid ?? '<undefined>'}`,
    );
    if (!uid) {
      this.logger.debug(
        '[stripSubmitterSubmissionDetails] Anonymized requester; removing review metadata and URLs.',
      );
      for (const submission of submissions) {
        if (Object.prototype.hasOwnProperty.call(submission, 'review')) {
          delete (submission as any).review;
        }
        if (
          Object.prototype.hasOwnProperty.call(submission, 'reviewSummation')
        ) {
          delete (submission as any).reviewSummation;
        }
        if (Object.prototype.hasOwnProperty.call(submission, 'url')) {
          (submission as any).url = null;
        }
      }
      return;
    }

    for (const submission of submissions) {
      const challengeId =
        submission.challengeId !== undefined && submission.challengeId !== null
          ? String(submission.challengeId).trim()
          : '';
      if (!challengeId) {
        continue;
      }

      const memberIdValue =
        submission.memberId !== undefined && submission.memberId !== null
          ? String(submission.memberId).trim()
          : null;
      if (!memberIdValue || memberIdValue === uid) {
        continue;
      }

      const roleSummary =
        visibilityContext.roleSummaryByChallenge.get(challengeId) ??
        EMPTY_ROLE_SUMMARY;
      const challengeDetail =
        visibilityContext.challengeDetailsById.get(challengeId) ?? null;
      const isCompletedChallenge = this.isCompletedOrCancelledStatus(
        challengeDetail?.status ?? null,
      );
      if (isCompletedChallenge) {
        continue;
      }

      const shouldStrip =
        roleSummary.hasSubmitter &&
        !roleSummary.hasCopilot &&
        !roleSummary.hasReviewer;
      if (!shouldStrip) {
        continue;
      }

      (submission as any).memberId = null;
      if (Object.prototype.hasOwnProperty.call(submission, 'submitterHandle')) {
        delete (submission as any).submitterHandle;
      }
      if (
        Object.prototype.hasOwnProperty.call(submission, 'submitterMaxRating')
      ) {
        delete (submission as any).submitterMaxRating;
      }
    }
  }

  private stripSubmitterSubmissionDetails(
    authUser: JwtUser,
    submissions: Array<
      {
        challengeId?: string | null;
        memberId?: string | null;
        review?: unknown;
        reviewSummation?: unknown;
        url?: string | null;
      } & Record<string, unknown>
    >,
    visibilityContext: ReviewVisibilityContext,
  ): void {
    if (!submissions.length) {
      return;
    }
    if (authUser?.isMachine || isAdmin(authUser)) {
      return;
    }

    const uid = visibilityContext.requesterUserId;
    if (!uid) {
      for (const submission of submissions) {
        if (Object.prototype.hasOwnProperty.call(submission, 'review')) {
          delete (submission as any).review;
        }
        if (
          Object.prototype.hasOwnProperty.call(submission, 'reviewSummation')
        ) {
          delete (submission as any).reviewSummation;
        }
        if (Object.prototype.hasOwnProperty.call(submission, 'url')) {
          (submission as any).url = null;
        }
      }
      return;
    }

    for (const submission of submissions) {
      const challengeId =
        submission.challengeId !== undefined && submission.challengeId !== null
          ? String(submission.challengeId).trim()
          : '';
      if (!challengeId) {
        continue;
      }

      const memberIdValue =
        submission.memberId !== undefined && submission.memberId !== null
          ? String(submission.memberId).trim()
          : null;
      if (!memberIdValue || memberIdValue === uid) {
        continue;
      }

      const roleSummary =
        visibilityContext.roleSummaryByChallenge.get(challengeId) ??
        EMPTY_ROLE_SUMMARY;
      if (
        !roleSummary.hasSubmitter ||
        roleSummary.hasCopilot ||
        roleSummary.hasReviewer
      ) {
        continue;
      }

      const challenge = visibilityContext.challengeDetailsById.get(challengeId);
      const isActiveChallenge =
        !challenge || challenge.status === ChallengeStatus.ACTIVE;
      if (!isActiveChallenge) {
        continue;
      }

      if (Array.isArray((submission as any).review)) {
        for (const review of (submission as any).review as Array<
          Record<string, any>
        >) {
          if (!review || typeof review !== 'object') {
            continue;
          }
          if (Object.prototype.hasOwnProperty.call(review, 'reviewItems')) {
            delete review.reviewItems;
          }
          if (Object.prototype.hasOwnProperty.call(review, 'initialScore')) {
            review.initialScore = null;
          }
          if (Object.prototype.hasOwnProperty.call(review, 'finalScore')) {
            review.finalScore = null;
          }
        }
      }

      if (Object.prototype.hasOwnProperty.call(submission, 'reviewSummation')) {
        delete (submission as any).reviewSummation;
      }

      if (Object.prototype.hasOwnProperty.call(submission, 'url')) {
        (submission as any).url = null;
      }
    }
  }

  private async stripIsLatestForUnlimitedChallenges(
    submissions: Array<
      { challengeId?: string | null } & Record<string, unknown>
    >,
  ): Promise<void> {
    if (!submissions.length) {
      return;
    }

    const challengeId = Array.from(
      new Set(
        submissions
          .map((submission) =>
            submission.challengeId !== undefined &&
            submission.challengeId !== null
              ? String(submission.challengeId)
              : null,
          )
          .filter((id): id is string => !!id),
      ),
    )[0];

    let metadataEntries: Array<{ value: string }> = [];
    try {
      metadataEntries = await this.challengePrisma.$queryRaw(Prisma.sql`
        SELECT \"value\" from \"ChallengeMetadata\" WHERE \"challengeId\"= ${challengeId} AND name = 'submissionLimit'
      `);
    } catch (error) {
      this.logger.warn(
        `Failed to load submissionLimit metadata for challenge ${challengeId}: ${(error as Error)?.message}`,
      );
      return;
    }

    if (!metadataEntries.length) {
      return;
    }

    let challengeSubmissionsAreUnlimited = false;
    for (const entry of metadataEntries) {
      const unlimited = this.extractSubmissionLimitUnlimited(entry.value);
      if (unlimited === true) {
        challengeSubmissionsAreUnlimited = true;
      }
    }

    for (const submission of submissions) {
      if (challengeSubmissionsAreUnlimited) {
        delete (submission as any).isLatest;
      }
    }
  }

  private extractSubmissionLimitUnlimited(value: unknown): boolean | null {
    if (value == null) {
      return null;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }

      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return this.coerceLooseBoolean(
            (parsed as Record<string, unknown>).unlimited,
          );
        }
        return this.coerceLooseBoolean(parsed);
      } catch {
        return this.coerceLooseBoolean(trimmed);
      }
    }

    if (typeof value === 'object' && !Array.isArray(value)) {
      return this.coerceLooseBoolean(
        (value as Record<string, unknown>).unlimited,
      );
    }

    return this.coerceLooseBoolean(value);
  }

  private coerceLooseBoolean(value: unknown): boolean | null {
    if (value == null) {
      return null;
    }

    if (value === true || value === false) {
      return value;
    }

    if (value instanceof Boolean) {
      return value.valueOf();
    }

    if (value instanceof Number) {
      return this.coerceLooseBoolean(value.valueOf());
    }

    let candidate: string;

    if (typeof value === 'string') {
      candidate = value;
    } else if (value instanceof String) {
      candidate = value.valueOf();
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        return null;
      }
      candidate = value.toString();
    } else if (typeof value === 'bigint') {
      candidate = value.toString();
    } else {
      return null;
    }

    const normalized = candidate.trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
    return null;
  }

  private isMarathonMatchChallenge(
    challenge: ChallengeData | null | undefined,
  ): boolean {
    if (!challenge) {
      return false;
    }

    const typeName = (challenge.type ?? '').trim().toLowerCase();
    if (typeName === 'marathon match') {
      return true;
    }

    const legacySubTrack = (challenge.legacy?.subTrack ?? '')
      .trim()
      .toLowerCase();
    if (legacySubTrack.includes('marathon')) {
      return true;
    }

    const legacyTrack = (challenge.legacy?.track ?? '').trim().toLowerCase();
    return legacyTrack.includes('marathon');
  }

  private isCompletedOrCancelledStatus(
    status: ChallengeStatus | null | undefined,
  ): boolean {
    if (!status) {
      return false;
    }
    if (status === ChallengeStatus.COMPLETED) {
      return true;
    }
    if (status === ChallengeStatus.CANCELLED) {
      return true;
    }
    return String(status).startsWith('CANCELLED_');
  }

  private normalizePhaseName(phaseName: string | null | undefined): string {
    return String(phaseName ?? '')
      .trim()
      .toLowerCase();
  }

  private hasTimestampValue(value: unknown): boolean {
    if (value == null) {
      return false;
    }
    if (value instanceof Date) {
      return true;
    }
    switch (typeof value) {
      case 'string':
        return value.trim().length > 0;
      case 'number':
        return Number.isFinite(value);
      case 'bigint':
      case 'boolean':
        return true;
      case 'symbol':
      case 'function':
        return false;
      case 'object': {
        const valueWithToISOString = value as {
          toISOString?: (() => string) | undefined;
          valueOf?: (() => unknown) | undefined;
        };
        if (typeof valueWithToISOString.toISOString === 'function') {
          try {
            return valueWithToISOString.toISOString().trim().length > 0;
          } catch {
            return false;
          }
        }
        if (typeof valueWithToISOString.valueOf === 'function') {
          const primitiveValue = valueWithToISOString.valueOf();
          if (primitiveValue !== value) {
            return this.hasTimestampValue(primitiveValue);
          }
        }
        return false;
      }
      default:
        return false;
    }
  }

  private hasChallengePhaseCompleted(
    challenge: ChallengeData | null | undefined,
    phaseNames: string[],
  ): boolean {
    if (!challenge?.phases?.length) {
      return false;
    }

    const normalizedTargets = new Set(
      (phaseNames ?? [])
        .map((name) => this.normalizePhaseName(name))
        .filter((name) => name.length > 0),
    );

    if (!normalizedTargets.size) {
      return false;
    }

    return (challenge.phases ?? []).some((phase) => {
      if (!phase) {
        return false;
      }

      const normalizedName = this.normalizePhaseName((phase as any).name);
      if (!normalizedTargets.has(normalizedName)) {
        return false;
      }

      if ((phase as any).isOpen === true) {
        return false;
      }

      const actualEnd =
        (phase as any).actualEndTime ??
        (phase as any).actualEndDate ??
        (phase as any).actualEnd ??
        null;

      return this.hasTimestampValue(actualEnd);
    });
  }

  private getPhaseNameFromId(
    challenge: ChallengeData | null | undefined,
    phaseId: string | null | undefined,
  ): string | null {
    if (!challenge?.phases?.length || phaseId == null) {
      return null;
    }

    const normalizedPhaseId = String(phaseId).trim();
    if (!normalizedPhaseId.length) {
      return null;
    }

    const match = (challenge.phases ?? []).find((phase) => {
      if (!phase) {
        return false;
      }

      const candidateIds = [
        String((phase as any).id ?? '').trim(),
        String((phase as any).phaseId ?? '').trim(),
      ].filter((candidate) => candidate.length > 0);

      return candidateIds.includes(normalizedPhaseId);
    });

    const matchName =
      match != null ? (match as { name?: unknown }).name : undefined;
    return typeof matchName === 'string' ? matchName : null;
  }

  private identifyReviewerRoleType(
    roleName: string,
  ):
    | 'screener'
    | 'checkpoint-screener'
    | 'checkpoint-reviewer'
    | 'reviewer'
    | 'approver'
    | 'iterative-reviewer'
    | 'unknown' {
    const normalized = String(roleName ?? '')
      .trim()
      .toLowerCase();
    if (!normalized) {
      return 'unknown';
    }

    if (normalized.includes('checkpoint') && normalized.includes('screener')) {
      return 'checkpoint-screener';
    }

    if (normalized.includes('checkpoint') && normalized.includes('reviewer')) {
      return 'checkpoint-reviewer';
    }

    if (normalized.includes('screener')) {
      return 'screener';
    }

    if (normalized.includes('approver') || normalized.includes('approval')) {
      return 'approver';
    }

    if (normalized.includes('iterative') && normalized.includes('reviewer')) {
      return 'iterative-reviewer';
    }

    if (normalized.includes('reviewer')) {
      return 'reviewer';
    }

    return 'unknown';
  }

  private async hasPassingSubmissionForReviewScorecard(
    challengeId: string,
    memberId: string,
  ): Promise<boolean> {
    const normalizedChallengeId = String(challengeId ?? '').trim();
    const normalizedMemberId = String(memberId ?? '').trim();

    if (!normalizedChallengeId || !normalizedMemberId) {
      return false;
    }

    try {
      const passingSummation = await this.prisma.reviewSummation.findFirst({
        where: {
          isPassing: true,
          scorecard: {
            type: {
              in: [ScorecardType.REVIEW, ScorecardType.ITERATIVE_REVIEW],
            },
          },
          submission: {
            challengeId: normalizedChallengeId,
            memberId: normalizedMemberId,
          },
        },
        select: { id: true },
      });

      return Boolean(passingSummation);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[hasPassingSubmissionForReviewScorecard] Failed to check passing submission for challenge ${normalizedChallengeId}, member ${normalizedMemberId}: ${message}`,
      );
      return false;
    }
  }

  private buildResponse(data: any): SubmissionResponseDto {
    const dto: SubmissionResponseDto = {
      ...data,
      legacyChallengeId: Utils.bigIntToNumber(data.legacyChallengeId),
      prizeId: Utils.bigIntToNumber(data.prizeId),
    };
    if (data.review) {
      dto.review = data.review as ReviewResponseDto[];
    }
    if (data.reviewSummation) {
      dto.reviewSummation = data.reviewSummation;
    }
    if (Object.prototype.hasOwnProperty.call(data, 'isLatest')) {
      dto.isLatest = Boolean(data.isLatest);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'isFileSubmission')) {
      dto.isFileSubmission = Boolean(data.isFileSubmission);
    }
    return dto;
  }
}
