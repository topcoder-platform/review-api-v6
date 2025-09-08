import {
  Injectable,
  Logger,
  NotFoundException,
  InternalServerErrorException,
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
import { JwtUser } from 'src/shared/modules/global/jwt.service';
import { PrismaService } from 'src/shared/modules/global/prisma.service';
import { ChallengePrismaService } from 'src/shared/modules/global/challenge-prisma.service';
import { Utils } from 'src/shared/modules/global/utils.service';
import { PrismaErrorService } from 'src/shared/modules/global/prisma-error.service';

@Injectable()
export class SubmissionService {
  private readonly logger = new Logger(SubmissionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaErrorService: PrismaErrorService,
    private readonly challengePrisma: ChallengePrismaService,
  ) {}

  async createSubmission(authUser: JwtUser, body: SubmissionRequestDto) {
    console.log(`BODY: ${JSON.stringify(body)}`);
    try {
      const data = await this.prisma.submission.create({
        data: {
          ...body,
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
              UPDATE "challenge"
              SET "numOfCheckpointSubmissions" = "numOfCheckpointSubmissions" + 1
              WHERE "id" = ${body.challengeId}
            `;
          } else {
            await this.challengePrisma.$executeRaw`
              UPDATE "challenge"
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
      // Decrement challenge submission counters if challengeId present
      if (existing.challengeId) {
        try {
          const isCheckpoint =
            existing.type === SubmissionType.CHECKPOINT_SUBMISSION;
          if (isCheckpoint) {
            await this.challengePrisma.$executeRaw`
              UPDATE "challenge"
              SET "numOfCheckpointSubmissions" = GREATEST("numOfCheckpointSubmissions" - 1, 0)
              WHERE "id" = ${existing.challengeId}
            `;
          } else {
            await this.challengePrisma.$executeRaw`
              UPDATE "challenge"
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
