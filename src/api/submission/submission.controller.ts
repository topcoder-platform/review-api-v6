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
  NotFoundException,
  InternalServerErrorException,
  UseInterceptors,
  UploadedFile,
  StreamableFile,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiBody,
  ApiBearerAuth,
  ApiConsumes,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { createReadStream } from 'fs';
import { join } from 'path';

import { Roles } from 'src/shared/guards/tokenRoles.guard';
import { UserRole } from 'src/shared/enums/userRole.enum';
import { Scopes } from 'src/shared/decorators/scopes.decorator';
import { Scope } from 'src/shared/enums/scopes.enum';
import {
  SubmissionQueryDto,
  SubmissionResponseDto,
  SubmissionRequestDto,
  SubmissionPutRequestDto,
  SubmissionUpdateRequestDto,
} from 'src/dto/submission.dto';
import {
  // ArtifactsCreateRequestDto,
  ArtifactsCreateResponseDto,
  ArtifactsListResponseDto,
} from 'src/dto/artifacts.dto';
import { PrismaService } from '../../shared/modules/global/prisma.service';
import { LoggerService } from '../../shared/modules/global/logger.service';
import { PaginatedResponse, PaginationDto } from '../../dto/pagination.dto';
import { SortDto } from '../../dto/sort.dto';
import { PrismaErrorService } from '../../shared/modules/global/prisma-error.service';

@ApiTags('Submissions')
@ApiBearerAuth()
@Controller('/api/submissions')
export class SubmissionController {
  private readonly logger: LoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaErrorService: PrismaErrorService,
  ) {
    this.logger = LoggerService.forRoot('SubmissionController');
  }

  @Post()
  @Roles(
    UserRole.Admin,
    UserRole.Copilot,
    UserRole.Submitter,
    UserRole.Reviewer,
  )
  @Scopes(Scope.CreateSubmission)
  @ApiOperation({
    summary: 'Create a new submission',
    description:
      'Roles: Admin, Copilot, Submitter, Reviewer | Scopes: create:submission',
  })
  @ApiBody({ description: 'Submission data', type: SubmissionRequestDto })
  @ApiResponse({
    status: 201,
    description: 'Submission created successfully.',
    type: SubmissionResponseDto,
  })
  async createSubmission(
    @Body() body: SubmissionRequestDto,
  ): Promise<SubmissionResponseDto> {
    this.logger.log(
      `Creating submission with request boy: ${JSON.stringify(body)}`,
    );
    try {
      const data = await this.prisma.submission.create({
        data: body,
      });
      this.logger.log(`Submission created with ID: ${data.id}`);
      return data as SubmissionResponseDto;
    } catch (error) {
      const errorResponse = this.prismaErrorService.handleError(
        error,
        'creating submission',
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
      });
    }
  }

  @Patch('/:submissionId')
  @Roles(UserRole.Admin)
  @Scopes(Scope.UpdateSubmission)
  @ApiOperation({
    summary: 'Update a submission partially',
    description: 'Roles: Admin | Scopes: update:submission',
  })
  @ApiParam({
    name: 'submissionId',
    description: 'The ID of the submission',
  })
  @ApiBody({ description: 'submission data', type: SubmissionUpdateRequestDto })
  @ApiResponse({
    status: 200,
    description: 'Submission updated successfully.',
    type: SubmissionUpdateRequestDto,
  })
  @ApiResponse({ status: 404, description: 'Submission not found.' })
  async patchSubmission(
    @Param('submissionId') submissionId: string,
    @Body() body: SubmissionUpdateRequestDto,
  ): Promise<SubmissionResponseDto> {
    return this._updateSubmission(submissionId, body);
  }

  @Put('/:submissionId')
  @Roles(UserRole.Admin)
  @Scopes(Scope.UpdateSubmission)
  @ApiOperation({
    summary: 'Update a submission',
    description: 'Roles: Admin | Scopes: update:submission',
  })
  @ApiParam({
    name: 'submissionId',
    description: 'The ID of the submission',
  })
  @ApiBody({ description: 'Review type data', type: SubmissionPutRequestDto })
  @ApiResponse({
    status: 200,
    description: 'Submission updated successfully.',
    type: SubmissionRequestDto,
  })
  @ApiResponse({ status: 404, description: 'Submission not found.' })
  async updateSubmission(
    @Param('submissionId') submissionId: string,
    @Body() body: SubmissionPutRequestDto,
  ): Promise<SubmissionResponseDto> {
    return this._updateSubmission(submissionId, body);
  }

  /**
   * The inner update method for entity
   */
  async _updateSubmission(
    submissionId: string,
    body: SubmissionUpdateRequestDto,
  ): Promise<SubmissionResponseDto> {
    this.logger.log(`Updating submission with ID: ${submissionId}`);
    try {
      const data = await this.prisma.submission.update({
        where: { id: submissionId },
        data: body,
      });
      this.logger.log(`Submission updated successfully: ${submissionId}`);
      return data as SubmissionResponseDto;
    } catch (error) {
      throw this._rethrowError(
        error,
        submissionId,
        `updating submission ${submissionId}`,
      );
    }
  }

  @Get()
  @Roles(
    UserRole.Copilot,
    UserRole.Admin,
    UserRole.Submitter,
    UserRole.Reviewer,
  )
  @Scopes(Scope.ReadSubmission)
  @ApiOperation({
    summary: 'Search for submissions',
    description:
      'Roles: Copilot, Admin, Submitter, Reviewer. | Scopes: read:submission',
  })
  @ApiResponse({
    status: 200,
    description: 'List of submissions',
    type: [SubmissionResponseDto],
  })
  async listSubmissions(
    @Query() queryDto: SubmissionQueryDto,
    @Query() paginationDto?: PaginationDto,
    @Query() sortDto?: SortDto,
  ): Promise<PaginatedResponse<SubmissionResponseDto>> {
    this.logger.log(
      `Getting submissions with filters - ${JSON.stringify(queryDto)}`,
    );

    const { page = 1, perPage = 10 } = paginationDto || {};
    const skip = (page - 1) * perPage;
    let orderBy;

    if (sortDto && sortDto.orderBy && sortDto.sortBy) {
      orderBy = {
        [sortDto.sortBy]: sortDto.orderBy.toLowerCase(),
      };
    }

    try {
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
        data: submissions as SubmissionResponseDto[],
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
        'fetching submissions',
      );
      throw new InternalServerErrorException({
        message: errorResponse.message,
        code: errorResponse.code,
      });
    }
  }

  @Get('/:submissionId')
  @Roles(
    UserRole.Copilot,
    UserRole.Admin,
    UserRole.Submitter,
    UserRole.Reviewer,
  )
  @Scopes(Scope.ReadSubmission)
  @ApiOperation({
    summary: 'View a specific submission',
    description:
      'Roles: Copilot, Admin, Submitter, Reviewer | Scopes: read:submission',
  })
  @ApiParam({
    name: 'submissionId',
    description: 'The ID of the submission',
  })
  @ApiResponse({
    status: 200,
    description: 'Submission retrieved successfully.',
    type: SubmissionResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Submission not found.' })
  async getSubmission(
    @Param('submissionId') submissionId: string,
  ): Promise<SubmissionResponseDto> {
    this.logger.log(`Getting submission with ID: ${submissionId}`);
    try {
      const data = await this.prisma.submission.findUniqueOrThrow({
        where: { id: submissionId },
        include: {
          review: {},
          reviewSummation: {},
        },
      });

      this.logger.log(`Review type found: ${submissionId}`);
      return data as SubmissionResponseDto;
    } catch (error) {
      throw this._rethrowError(
        error,
        submissionId,
        `fetching submission ${submissionId}`,
      );
    }
  }

  @Delete('/:submissionId')
  @Roles(
    UserRole.Admin,
    UserRole.Copilot,
    UserRole.Submitter,
    UserRole.Reviewer,
  )
  @Scopes(Scope.DeleteSubmission)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a submission',
    description:
      'Roles: Admin, Copilot, Submitter, Reviewer | Scopes: delete:submission',
  })
  @ApiParam({
    name: 'submissionId',
    description: 'The ID of the submission',
  })
  @ApiResponse({
    status: 204,
    description: 'Submission deleted successfully.',
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Submission not found.' })
  async deleteSubmission(@Param('submissionId') submissionId: string) {
    this.logger.log(`Deleting review type with ID: ${submissionId}`);
    try {
      await this.prisma.submission.delete({
        where: { id: submissionId },
      });
      this.logger.log(`Submission deleted successfully: ${submissionId}`);
      return { message: `Submission ${submissionId} deleted successfully.` };
    } catch (error) {
      throw this._rethrowError(
        error,
        submissionId,
        `deleting submission ${submissionId}`,
      );
    }
  }

  @Get('/:submissionId/download')
  @Roles(
    UserRole.Copilot,
    UserRole.Admin,
    UserRole.Submitter,
    UserRole.Reviewer,
  )
  @Scopes(Scope.ReadSubmission)
  @ApiOperation({
    summary: 'Download the submission',
    description:
      'Roles: Copilot, Admin, Submitter Reviewer. | Scopes: read:submission',
  })
  @ApiParam({
    name: 'submissionId',
    description: 'The ID of the submission',
  })
  @ApiResponse({
    status: 200,
    description: 'Submission file',
    schema: {
      type: 'string', // Indicate binary data
      format: 'binary', // Use binary format
    },
  })
  async downloadSubmission(
    @Param('submissionId') submissionId: string, // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<StreamableFile> {
    // The artifact file is from S3 in original codes
    // Not data from DB
    // So just return mock data now.
    const file = createReadStream(
      join(process.cwd(), 'uploads/submission-123.zip'),
    );
    return Promise.resolve(
      new StreamableFile(file, {
        type: 'application/zip',
        disposition: 'attachment; filename="submission-123.zip"',
      }),
    );
  }

  /**
   * Build exception by error code
   */
  _rethrowError(error: any, submissionId: string, message: string) {
    const errorResponse = this.prismaErrorService.handleError(error, message);

    if (errorResponse.code === 'RECORD_NOT_FOUND') {
      return new NotFoundException({
        message: `Review type with ID ${submissionId} was not found`,
        code: errorResponse.code,
      });
    }

    return new InternalServerErrorException({
      message: errorResponse.message,
      code: errorResponse.code,
    });
  }

  @Post('/:submissionId/artifacts')
  @Roles(
    UserRole.Admin,
    UserRole.Copilot,
    UserRole.Submitter,
    UserRole.Reviewer,
  )
  @Scopes(Scope.CreateSubmission)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Create artifact for the given submission ID',
    description:
      'Roles: Admin, Copilot, Submitter, Reviewer | Scopes: create:submission',
  })
  @ApiParam({
    name: 'submissionId',
    description: 'The ID of the submission',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    required: true,
    type: 'multipart/form-data',
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Submission created successfully.',
    type: ArtifactsCreateResponseDto,
  })
  async createArtifact(
    @Param('submissionId') submissionId: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<ArtifactsCreateResponseDto> {
    const fileName = file.filename;
    return Promise.resolve({
      artifacts: fileName.substring(fileName.lastIndexOf('/') + 1),
    });
  }

  @Get('/:submissionId/artifacts')
  @Roles(
    UserRole.Copilot,
    UserRole.Admin,
    UserRole.Submitter,
    UserRole.Reviewer,
  )
  @Scopes(Scope.ReadSubmission)
  @ApiOperation({
    summary: 'List artifacts for the given Submission ID',
    description:
      'Roles: Copilot, Admin, Submitter, Reviewer. | Scopes: read:submission',
  })
  @ApiParam({
    name: 'submissionId',
    description: 'The ID of the submission',
  })
  @ApiResponse({
    status: 200,
    description: 'List of artifacts',
    type: [ArtifactsListResponseDto],
  })
  async listArtifacts(
    @Param('submissionId') submissionId: string, // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<ArtifactsListResponseDto> {
    // These artifacts are from S3 in original codes
    // Not data from DB
    // So just return mock data now.
    const mockData = {
      artifacts: ['c56a4180-65aa-42ec-a945-5fd21dec0503'],
    };
    return Promise.resolve(mockData);
  }

  @Get('/:submissionId/artifacts/:artifactId/download')
  @Roles(
    UserRole.Copilot,
    UserRole.Admin,
    UserRole.Submitter,
    UserRole.Reviewer,
  )
  @Scopes(Scope.ReadSubmission)
  @ApiOperation({
    summary: 'Download artifact using Submission ID and Artifact ID',
    description:
      'Roles: Copilot, Admin, Submitter, Reviewer. | Scopes: read:submission',
  })
  @ApiParam({
    name: 'submissionId',
    description: 'The ID of the submission',
  })
  @ApiParam({
    name: 'artifactId',
    description: 'The ID of the artifact',
  })
  @ApiResponse({
    status: 200,
    description: 'Artifact file',
    schema: {
      type: 'string', // Indicate binary data
      format: 'binary', // Use binary format
    },
  })
  async downloadArtifacts(
    @Param('submissionId') submissionId: string, // eslint-disable-line @typescript-eslint/no-unused-vars
    @Param('artifactId') artifactId: string, // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<StreamableFile> {
    // The artifact file is from S3 in original codes
    // Not data from DB
    // So just return mock data now.
    const file = createReadStream(
      join(process.cwd(), 'uploads/artifact-123.zip'),
    );
    return Promise.resolve(
      new StreamableFile(file, {
        type: 'application/zip',
        disposition: 'attachment; filename="artifact-123.zip"',
      }),
    );
  }

  @Delete('/:submissionId/artifacts/:artifactId')
  @Roles(UserRole.Admin)
  @Scopes(Scope.DeleteSubmission)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a artifact',
    description: 'Roles: Admin | Scopes: delete:submission',
  })
  @ApiParam({
    name: 'submissionId',
    description: 'The ID of the submission',
  })
  @ApiParam({
    name: 'artifactId',
    description: 'The ID of the artifact',
  })
  @ApiResponse({
    status: 204,
    description: 'Submission deleted successfully.',
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Submission not found.' })
  // eslint-disable-next-line @typescript-eslint/require-await
  async deleteArtifact(
    @Param('submissionId') submissionId: string, // eslint-disable-line @typescript-eslint/no-unused-vars
    @Param('artifactId') artifactId: string, // eslint-disable-line @typescript-eslint/no-unused-vars
  ) {
    return;
  }

  @Get('/:challengeId/count')
  @Roles(
    UserRole.Copilot,
    UserRole.Admin,
    UserRole.Submitter,
    UserRole.Reviewer,
  )
  @Scopes(Scope.ReadSubmission)
  @ApiOperation({
    summary: 'Get submission count for the given Challenge ID',
    description:
      'Roles: Copilot, Admin, Submitter, Reviewer. | Scopes: read:submission',
  })
  @ApiParam({
    name: 'challengeId',
    description: 'The ID of the challenge',
  })
  @ApiResponse({
    status: 200,
    description: 'Count of submissions',
  })
  async countSubmissions(
    @Param('challengeId') challengeId: string, // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<number> {
    // These artifacts are from S3 in original codes
    // Not data from DB
    // So just return mock data now.
    return Promise.resolve(3);
  }

  @Get('/download/:challengeId')
  @Roles(
    UserRole.Copilot,
    UserRole.Admin,
    UserRole.Submitter,
    UserRole.Reviewer,
  )
  @Scopes(Scope.ReadSubmission)
  @ApiOperation({
    summary: 'Download all submissions for a challenge as a ZIP file',
    description:
      'Roles: Copilot, Admin, Submitter, Reviewer. | Scopes: read:submission',
  })
  @ApiParam({
    name: 'challengeId',
    description: 'The ID of the challenge',
  })
  @ApiResponse({
    status: 200,
    description: 'Submission files',
    schema: {
      type: 'string', // Indicate binary data
      format: 'binary', // Use binary format
    },
  })
  async downloadAllSubmission(
    @Param('challengeId') challengeId: string, // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<StreamableFile> {
    // The artifact file is from S3 in original codes
    // Not data from DB
    // So just return mock data now.
    const file = createReadStream(
      join(process.cwd(), 'uploads/submission-123.zip'),
    );
    return Promise.resolve(
      new StreamableFile(file, {
        type: 'application/zip',
        disposition: 'attachment; filename="submission-123.zip"',
      }),
    );
  }
}
