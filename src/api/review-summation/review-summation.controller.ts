import {
  Controller,
  Post,
  Patch,
  Put,
  Get,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Req,
  Res,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';

import { Roles } from 'src/shared/guards/tokenRoles.guard';
import { UserRole } from 'src/shared/enums/userRole.enum';
import { Scopes } from 'src/shared/decorators/scopes.decorator';
import { Scope } from 'src/shared/enums/scopes.enum';
import {
  ReviewSummationBatchResponseDto,
  ReviewSummationQueryDto,
  ReviewSummationResponseDto,
  ReviewSummationRequestDto,
  ReviewSummationPutRequestDto,
  ReviewSummationUpdateRequestDto,
} from 'src/dto/reviewSummation.dto';
import { LoggerService } from '../../shared/modules/global/logger.service';
import { PaginatedResponse, PaginationDto } from '../../dto/pagination.dto';
import { SortDto } from '../../dto/sort.dto';
import { ReviewSummationService } from './review-summation.service';
import { JwtUser } from 'src/shared/modules/global/jwt.service';
import { Request, Response } from 'express';

@ApiTags('ReviewSummations')
@ApiBearerAuth()
@Controller('/reviewSummations')
export class ReviewSummationController {
  private readonly logger: LoggerService;
  private static readonly TSV_CONTENT_TYPE = 'text/tab-separated-values';
  private static readonly TSV_FILENAME_PREFIX = 'review-summations';

  constructor(private readonly service: ReviewSummationService) {
    this.logger = LoggerService.forRoot(ReviewSummationController.name);
  }

  @Post()
  @Roles(UserRole.Admin, UserRole.Copilot)
  @Scopes(Scope.CreateReviewSummation)
  @ApiOperation({
    summary: 'Create a new review summation',
    description: 'Roles: Admin, Copilot | Scopes: create:review_summation',
  })
  @ApiBody({
    description: 'Review summation data',
    type: ReviewSummationRequestDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Review summation created successfully.',
    type: ReviewSummationResponseDto,
  })
  async createReviewSummation(
    @Req() req: Request,
    @Body() body: ReviewSummationRequestDto,
  ): Promise<ReviewSummationResponseDto> {
    this.logger.log(
      `Creating review summation with request boy: ${JSON.stringify(body)}`,
    );
    const authUser: JwtUser = req['user'] as JwtUser;
    return this.service.createSummation(authUser, body);
  }

  @Patch('/:reviewSummationId')
  @Roles(UserRole.Admin)
  @Scopes(Scope.UpdateReviewSummation)
  @ApiOperation({
    summary: 'Update a review summation partially',
    description: 'Roles: Admin | Scopes: update:review_summation',
  })
  @ApiParam({
    name: 'reviewSummationId',
    description: 'The ID of the review summation',
  })
  @ApiBody({
    description: 'Review type data',
    type: ReviewSummationUpdateRequestDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Review type updated successfully.',
    type: ReviewSummationResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Review type not found.' })
  async patchReviewSummation(
    @Req() req: Request,
    @Param('reviewSummationId') reviewSummationId: string,
    @Body() body: ReviewSummationUpdateRequestDto,
  ): Promise<ReviewSummationResponseDto> {
    const authUser: JwtUser = req['user'] as JwtUser;
    return this.service.updateSummation(authUser, reviewSummationId, body);
  }

  @Put('/:reviewSummationId')
  @Roles(UserRole.Admin)
  @Scopes(Scope.UpdateReviewSummation)
  @ApiOperation({
    summary: 'Update a review summation',
    description: 'Roles: Admin | Scopes: update:review_summation',
  })
  @ApiParam({
    name: 'reviewSummationId',
    description: 'The ID of the review summation',
  })
  @ApiBody({
    description: 'Review type data',
    type: ReviewSummationPutRequestDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Review type updated successfully.',
    type: ReviewSummationResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Review type not found.' })
  async updateReviewSummation(
    @Req() req: Request,
    @Param('reviewSummationId') reviewSummationId: string,
    @Body() body: ReviewSummationPutRequestDto,
  ): Promise<ReviewSummationResponseDto> {
    const authUser: JwtUser = req['user'] as JwtUser;
    return this.service.updateSummation(authUser, reviewSummationId, body);
  }

  @Get()
  @Roles(UserRole.Copilot, UserRole.Admin, UserRole.Submitter, UserRole.User)
  @Scopes(Scope.ReadReviewSummation)
  @ApiOperation({
    summary: 'Search for review summations',
    description:
      'Roles: Copilot, Admin, Submitter. | Scopes: read:review_summation',
  })
  @ApiResponse({
    status: 200,
    description: 'List of review summations.',
    type: [ReviewSummationResponseDto],
  })
  @ApiResponse({
    status: 200,
    description:
      'Tab-delimited representation when Accept includes text/tab-separated-values.',
    content: {
      'text/tab-separated-values': {
        schema: {
          type: 'string',
          example:
            'submissionId\tsubmitterId\tsubmitterHandle\taggregateScore\tisFinal\tisProvisional\tisExample\treviewedDate\tcreatedAt\tupdatedAt\tscore\ttestcase\nsid123\t123456\tmember\t99.5\ttrue\tfalse\tfalse\t2024-02-01T10:00:00.000Z\t2024-02-02T12:00:00.000Z\t2024-02-02T13:00:00.000Z\t99.5\tSample test case',
        },
      },
    },
  })
  async listReviewSummations(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query() queryDto: ReviewSummationQueryDto,
    @Query() paginationDto?: PaginationDto,
    @Query() sortDto?: SortDto,
  ): Promise<PaginatedResponse<ReviewSummationResponseDto> | string> {
    this.logger.log(
      `Getting review summations with filters - ${JSON.stringify(queryDto)}`,
    );
    const authUser: JwtUser = req['user'] as JwtUser;
    const results = await this.service.searchSummation(
      authUser,
      queryDto,
      paginationDto,
      sortDto,
    );

    if (!this.requestWantsTabSeparated(req)) {
      return results;
    }

    const challengeId = (queryDto.challengeId ?? '').trim();
    if (!challengeId) {
      throw new BadRequestException({
        message:
          'challengeId is required when requesting tab-delimited review summations.',
        code: 'TSV_CHALLENGE_ID_REQUIRED',
      });
    }

    const payload = this.buildReviewSummationTsv(results);
    const safeChallengeSlug = this.buildFilenameSlug(challengeId);
    const filename = `${ReviewSummationController.TSV_FILENAME_PREFIX}-${safeChallengeSlug}.tsv`;
    res.setHeader(
      'Content-Type',
      `${ReviewSummationController.TSV_CONTENT_TYPE}; charset=utf-8`,
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return payload;
  }

  @Get('/:reviewSummationId')
  @Roles(UserRole.Copilot, UserRole.Admin)
  @Scopes(Scope.ReadReviewSummation)
  @ApiOperation({
    summary: 'View a specific review summation',
    description: 'Roles: Copilot, Admin | Scopes: read:review_summation',
  })
  @ApiParam({
    name: 'reviewSummationId',
    description: 'The ID of the review summation',
  })
  @ApiResponse({
    status: 200,
    description: 'Review type retrieved successfully.',
    type: ReviewSummationResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Review type not found.' })
  async getReviewSummation(
    @Param('reviewSummationId') reviewSummationId: string,
  ): Promise<ReviewSummationResponseDto> {
    this.logger.log(`Getting review summation with ID: ${reviewSummationId}`);
    return this.service.getSummation(reviewSummationId);
  }

  @Post('/challenges/:challengeId/initial')
  @Roles(UserRole.Admin)
  @Scopes(Scope.UpdateReviewSummation)
  @ApiOperation({
    summary: 'Generate initial review summations for a challenge',
    description:
      'Roles: Admin | Scopes: update:review_summation. Creates or refreshes review summations using initial scores once the review phase is closed.',
  })
  @ApiParam({
    name: 'challengeId',
    description: 'The ID of the challenge to aggregate',
  })
  @ApiResponse({
    status: 200,
    description: 'Summations generated successfully.',
    type: ReviewSummationBatchResponseDto,
  })
  async generateInitialSummations(
    @Req() req: Request,
    @Param('challengeId') challengeId: string,
  ): Promise<ReviewSummationBatchResponseDto> {
    const authUser: JwtUser = req['user'] as JwtUser;
    this.logger.log(
      `Generating initial review summations for challenge ${challengeId}`,
    );
    return this.service.generateInitialSummationsForChallenge(
      authUser,
      challengeId,
    );
  }

  @Post('/challenges/:challengeId/final')
  @Roles(UserRole.Admin)
  @Scopes(Scope.UpdateReviewSummation)
  @ApiOperation({
    summary: 'Finalize review summations for a challenge',
    description:
      'Roles: Admin | Scopes: update:review_summation. Updates review summations with final scores once reviews are completed.',
  })
  @ApiParam({
    name: 'challengeId',
    description: 'The ID of the challenge to finalize',
  })
  @ApiResponse({
    status: 200,
    description: 'Summations finalized successfully.',
    type: ReviewSummationBatchResponseDto,
  })
  async finalizeSummations(
    @Req() req: Request,
    @Param('challengeId') challengeId: string,
  ): Promise<ReviewSummationBatchResponseDto> {
    const authUser: JwtUser = req['user'] as JwtUser;
    this.logger.log(
      `Finalizing review summations for challenge ${challengeId}`,
    );
    return this.service.finalizeSummationsForChallenge(authUser, challengeId);
  }

  @Delete('/:reviewSummationId')
  @Roles(UserRole.Admin)
  @Scopes(Scope.DeleteReviewSummation)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a review summation',
    description: 'Roles: Admin | Scopes: delete:review_summation',
  })
  @ApiParam({
    name: 'reviewSummationId',
    description: 'The ID of the review summation',
  })
  @ApiResponse({
    status: 200,
    description: 'Review type deleted successfully.',
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Review not found.' })
  async deleteReviewSummation(
    @Param('reviewSummationId') reviewSummationId: string,
  ) {
    this.logger.log(`Deleting review summation with ID: ${reviewSummationId}`);
    await this.service.deleteSummation(reviewSummationId);
    return {
      message: `Review type ${reviewSummationId} deleted successfully.`,
    };
  }

  private requestWantsTabSeparated(req: Request): boolean {
    const acceptHeader = Array.isArray(req.headers.accept)
      ? req.headers.accept.join(',')
      : (req.headers.accept ?? '');
    if (acceptHeader) {
      const lowered = acceptHeader
        .split(',')
        .map((value) => value.trim().toLowerCase());
      const matchesHeader = lowered.some((value) =>
        value.startsWith(
          ReviewSummationController.TSV_CONTENT_TYPE.toLowerCase(),
        ),
      );
      if (matchesHeader) {
        return true;
      }
    }

    const formatParam = req.query['format'];
    if (
      typeof formatParam === 'string' &&
      formatParam.trim().toLowerCase() === 'tsv'
    ) {
      return true;
    }

    return false;
  }

  private buildReviewSummationTsv(
    payload: PaginatedResponse<ReviewSummationResponseDto>,
  ): string {
    const headers = [
      'submissionId',
      'submitterId',
      'submitterHandle',
      'aggregateScore',
      'isFinal',
      'isProvisional',
      'isExample',
      'reviewedDate',
      'createdAt',
      'updatedAt',
      'score',
      'testcase',
    ];

    const lines = [headers.join('\t')];

    payload.data.forEach((entry) => {
      const scoreRows = this.extractTestScoreEntries(entry.metadata);
      if (!scoreRows.length) {
        lines.push(
          this.toTabSeparatedRow(entry, {
            score: '',
            testcase: '',
          }),
        );
        return;
      }

      scoreRows.forEach((scoreEntry) => {
        lines.push(this.toTabSeparatedRow(entry, scoreEntry));
      });
    });

    return lines.join('\n');
  }

  private toTabSeparatedRow(
    entry: ReviewSummationResponseDto,
    metadataEntry: { score: unknown; testcase: unknown },
  ): string {
    const values: Array<unknown> = [
      entry.submissionId,
      entry.submitterId,
      entry.submitterHandle,
      entry.aggregateScore,
      entry.isFinal,
      entry.isProvisional,
      entry.isExample,
      entry.reviewedDate,
      entry.createdAt,
      entry.updatedAt,
      metadataEntry.score,
      metadataEntry.testcase,
    ];

    return values
      .map((value) => this.sanitizeTabSeparatedValue(value))
      .join('\t');
  }

  private extractTestScoreEntries(
    metadata: ReviewSummationResponseDto['metadata'],
  ): Array<{ score: unknown; testcase: unknown }> {
    if (metadata === null || metadata === undefined) {
      return [];
    }

    const results: Array<{ score: unknown; testcase: unknown }> = [];

    const visit = (value: unknown, inTestsScope = false) => {
      if (Array.isArray(value)) {
        value.forEach((entry) => visit(entry, inTestsScope));
        return;
      }

      if (!value || typeof value !== 'object') {
        return;
      }

      const record = value as Record<string, unknown>;
      const hasScore = Object.prototype.hasOwnProperty.call(record, 'score');
      const hasTestCase =
        Object.prototype.hasOwnProperty.call(record, 'testcase') ||
        Object.prototype.hasOwnProperty.call(record, 'testCase');

      if (inTestsScope && (hasScore || hasTestCase)) {
        results.push({
          score: record['score'] ?? null,
          testcase: record['testcase'] ?? record['testCase'] ?? null,
        });
      }

      Object.entries(record).forEach(([key, child]) => {
        const normalizedKey = key.toLowerCase();
        const isTestKey =
          normalizedKey === 'tests' || normalizedKey === 'testscores';
        visit(child, inTestsScope || isTestKey);
      });
    };

    visit(metadata);
    return results;
  }

  private sanitizeTabSeparatedValue(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch (error) {
        this.logger.warn(`Failed to stringify TSV value: ${error}`);
        return '';
      }
    }

    if (typeof value === 'function') {
      // Functions shouldn't appear in tab-separated exports; fall back to empty string.
      this.logger.warn(
        'Encountered function value while sanitizing TSV export',
      );
      return '';
    }

    if (typeof value === 'symbol') {
      return value.toString();
    }

    const primitiveValue = value as string | number | boolean | bigint;
    const asString = String(primitiveValue);
    return asString.replace(/[\t\n\r]+/g, ' ');
  }

  private buildFilenameSlug(challengeId: string): string {
    return challengeId.replace(/[^A-Za-z0-9-_]+/g, '_') || 'export';
  }
}
