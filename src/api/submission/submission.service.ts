import {
  Injectable,
  Logger,
  NotFoundException,
  InternalServerErrorException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { SubmissionStatus, SubmissionType } from '@prisma/client';
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
import { PrismaService } from 'src/shared/modules/global/prisma.service';
import { ChallengePrismaService } from 'src/shared/modules/global/challenge-prisma.service';
import { Utils } from 'src/shared/modules/global/utils.service';
import { PrismaErrorService } from 'src/shared/modules/global/prisma-error.service';
import { ChallengeApiService } from 'src/shared/modules/global/challenge.service';
import { ResourceApiService } from 'src/shared/modules/global/resource.service';
import { ArtifactsCreateResponseDto } from 'src/dto/artifacts.dto';
import { randomUUID } from 'crypto';
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';

@Injectable()
export class SubmissionService {
  private readonly logger = new Logger(SubmissionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaErrorService: PrismaErrorService,
    private readonly challengePrisma: ChallengePrismaService,
    private readonly challengeApiService: ChallengeApiService,
    private readonly resourceApiService: ResourceApiService,
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
          details: { submissionId, memberId: submission.memberId, requester: uid },
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

    const artifactId = randomUUID();
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
          const { createReadStream } = await import('fs');
          const { join } = await import('path');
          body = createReadStream(join(diskDest, diskFile));
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

  async listArtifacts(submissionId: string): Promise<{ artifacts: string[] }> {
    await this.checkSubmission(submissionId);

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
        continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
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

    return { artifacts: Array.from(artifactIds) };
  }

  async getArtifactStream(
    authUser: JwtUser,
    submissionId: string,
    artifactId: string,
  ): Promise<{ stream: Readable; contentType?: string; fileName: string }> {
    const submission = await this.checkSubmission(submissionId);

    // For member tokens (non-admin), validate they are either the owner
    // of the submission or a reviewer on the challenge
    if (!isAdmin(authUser)) {
      const uid = String(authUser.userId ?? '');
      const isOwner = !!uid && submission.memberId === uid;
      let isReviewer = false;
      if (!isOwner && submission.challengeId) {
        try {
          const resources = await this.resourceApiService.getMemberResourcesRoles(
            submission.challengeId,
            uid,
          );
          isReviewer = resources.some((r) =>
            (r.roleName || '').toLowerCase().includes('reviewer'),
          );
        } catch (e) {
          // If we cannot confirm reviewer status, deny access
          isReviewer = false;
        }
      }

      if (!isOwner && !isReviewer) {
        throw new ForbiddenException({
          message:
            'Only the submission owner or a challenge reviewer can download artifacts',
          code: 'FORBIDDEN_ARTIFACT_DOWNLOAD',
          details: {
            submissionId,
            requester: uid,
            challengeId: submission.challengeId,
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

    // Locate the object by listing under the artifact prefix
    const artifactPrefix = `${submissionId}/${artifactId}.`;
    let key: string | undefined;
    try {
      const list = await s3.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: artifactPrefix, MaxKeys: 1 }),
      );
      if (!list.Contents || list.Contents.length === 0 || !list.Contents[0].Key) {
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
      const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      contentType = head.ContentType || undefined;
      // Metadata keys are lowercase in S3 SDK v3
      const meta = head.Metadata || {};
      fileName = (meta['originalfilename'] as string) || fileName;
    } catch (err) {
      // proceed without metadata
    }

    try {
      const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key! }));
      const body = resp.Body as any;
      let stream: Readable;
      if (body && typeof body.pipe === 'function') {
        // Node.js Readable
        stream = body as Readable;
      } else if (body && typeof body.getReader === 'function' && (Readable as any).fromWeb) {
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
          details: { submissionId, memberId: submission.memberId, requester: uid },
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
        (resp.Contents || []).forEach((o) => o.Key && keys.push(o.Key));
        continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
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

  async createSubmission(authUser: JwtUser, body: SubmissionRequestDto) {
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

    // Validate challenge exists and is active
    try {
      await this.challengeApiService.validateChallengeExists(body.challengeId);
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
          // populate commonly expected fields on create
          submittedDate: body.submittedDate
            ? new Date(body.submittedDate)
            : new Date(),
          systemFileName,
          fileType,
          viewCount: 0,
          status: SubmissionStatus.ACTIVE,
          type: body.type as SubmissionType,
          createdBy: String(authUser.userId) || '',
          createdAt: new Date(),
        },
      });
      this.logger.log(`Submission created with ID: ${data.id}`);
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
    queryDto: SubmissionQueryDto,
    paginationDto?: PaginationDto,
    sortDto?: SortDto,
  ) {
    try {
      const { page = 1, perPage = 10 } = paginationDto || {};
      const skip = (page - 1) * perPage;
      let orderBy;

      if (sortDto && sortDto.orderBy && sortDto.sortBy) {
        orderBy = {
          [sortDto.sortBy]: sortDto.orderBy.toLowerCase(),
        };
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
      if (queryDto.legacySubmissionId) {
        submissionWhereClause.legacySubmissionId = queryDto.legacySubmissionId;
      }
      if (queryDto.legacyUploadId) {
        submissionWhereClause.legacyUploadId = queryDto.legacyUploadId;
      }
      if (queryDto.submissionPhaseId) {
        submissionWhereClause.submissionPhaseId = queryDto.submissionPhaseId;
      }

      // find entities by filters
      const submissions = await this.prisma.submission.findMany({
        where: {
          ...submissionWhereClause,
        },
        include: {
          review: {},
          reviewSummation: {},
        },
        skip,
        take: perPage,
        orderBy,
      });

      // Count total entities matching the filter for pagination metadata
      const totalCount = await this.prisma.submission.count({
        where: {
          ...submissionWhereClause,
        },
      });

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
          updatedBy: String(authUser.userId) || '',
          updatedAt: new Date(),
        },
      });
      this.logger.log(`Submission updated successfully: ${submissionId}`);
      return this.buildResponse(data);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      const errorResponse = this.prismaErrorService.handleError(
        error,
        `updating submission with ID: ${submissionId}`,
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
        details: errorResponse.details,
      });
    }
  }

  async deleteSubmission(id: string) {
    try {
      const existing = await this.checkSubmission(id);
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
    return data;
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
    return dto;
  }
}
