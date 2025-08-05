import { Injectable, Logger, NotFoundException } from '@nestjs/common';
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
import { Utils } from 'src/shared/modules/global/utils.service';

@Injectable()
export class SubmissionService {
  private readonly logger = new Logger(SubmissionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createSubmission(authUser: JwtUser, body: SubmissionRequestDto) {
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
    return this.buildResponse(data);
  }

  async listSubmission(
    queryDto: SubmissionQueryDto,
    paginationDto?: PaginationDto,
    sortDto?: SortDto,
  ) {
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
  }

  async deleteSubmission(id: string) {
    await this.checkSubmission(id);
    await this.prisma.submission.delete({
      where: { id },
    });
  }

  private async checkSubmission(id: string) {
    const data = await this.prisma.submission.findUnique({
      where: { id },
      include: { review: true, reviewSummation: true },
    });
    if (!data || !data.id) {
      throw new NotFoundException(`Submission with id ${id} not found`);
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
