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
  UseInterceptors,
  UploadedFile,
  StreamableFile,
  HttpCode,
  HttpStatus,
  Req,
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
import { memoryStorage } from 'multer';
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
import { LoggerService } from '../../shared/modules/global/logger.service';
import { PaginatedResponse, PaginationDto } from '../../dto/pagination.dto';
import { SortDto } from '../../dto/sort.dto';
import { SubmissionService } from './submission.service';
import { JwtUser } from 'src/shared/modules/global/jwt.service';

@ApiTags('Submissions')
@ApiBearerAuth()
@Controller('/submissions')
export class SubmissionController {
  private readonly logger: LoggerService;

  constructor(private readonly service: SubmissionService) {
    this.logger = LoggerService.forRoot('SubmissionController');
  }

  @Post()
  @Roles(UserRole.Admin, UserRole.Copilot, UserRole.User, UserRole.Reviewer)
  @Scopes(Scope.CreateSubmission)
  @ApiOperation({
    summary: 'Create a new submission',
    description:
      'Roles: Admin, Copilot, User, Reviewer | Scopes: create:submission',
  })
  @ApiResponse({
    status: 201,
    description: 'Submission created successfully.',
    type: SubmissionResponseDto,
  })
  // TODO: When we replace Community App, we should move this to JSON instead of form-data
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
    }),
  )
  @ApiBody({
    required: true,
    type: 'multipart/form-data',
    schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          format: 'url',
        },
        challengeId: {
          type: 'string',
        },
        type: {
          type: 'string',
        },
        memberId: {
          type: 'number',
        },
      },
    },
  })
  async createSubmission(
    @Req() req: Request,
    @Body() body: SubmissionRequestDto,
  ): Promise<SubmissionResponseDto> {
    console.log(
      `Creating submission with request body: ${JSON.stringify(body)}`,
    );
    const authUser: JwtUser = req['user'] as JwtUser;
    return this.service.createSubmission(authUser, body);
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
    @Req() req: Request,
    @Param('submissionId') submissionId: string,
    @Body() body: SubmissionUpdateRequestDto,
  ): Promise<SubmissionResponseDto> {
    const authUser: JwtUser = req['user'] as JwtUser;
    return this.service.updateSubmission(authUser, submissionId, body);
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
    @Req() req: Request,
    @Param('submissionId') submissionId: string,
    @Body() body: SubmissionPutRequestDto,
  ): Promise<SubmissionResponseDto> {
    const authUser: JwtUser = req['user'] as JwtUser;
    return this.service.updateSubmission(authUser, submissionId, body);
  }

  @Get()
  @Roles(UserRole.Copilot, UserRole.Admin, UserRole.Reviewer, UserRole.User)
  @Scopes(Scope.ReadSubmission)
  @ApiOperation({
    summary: 'Search for submissions',
    description:
      'Roles: Copilot, Admin, User, Reviewer. | Scopes: read:submission',
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
    return this.service.listSubmission(queryDto, paginationDto, sortDto);
  }

  @Get('/:submissionId')
  @Roles(UserRole.Copilot, UserRole.Admin, UserRole.User, UserRole.Reviewer)
  @Scopes(Scope.ReadSubmission)
  @ApiOperation({
    summary: 'View a specific submission',
    description:
      'Roles: Copilot, Admin, User, Reviewer | Scopes: read:submission',
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
    return this.service.getSubmission(submissionId);
  }

  @Delete('/:submissionId')
  @Roles(UserRole.Admin, UserRole.Copilot, UserRole.User, UserRole.Reviewer)
  @Scopes(Scope.DeleteSubmission)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a submission',
    description:
      'Roles: Admin, Copilot, User, Reviewer | Scopes: delete:submission',
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
    await this.service.deleteSubmission(submissionId);
    return { message: `Submission ${submissionId} deleted successfully.` };
  }

  @Get('/:submissionId/download')
  @Roles(UserRole.Copilot, UserRole.Admin, UserRole.User, UserRole.Reviewer)
  @Scopes(Scope.ReadSubmission)
  @ApiOperation({
    summary: 'Download the submission',
    description:
      'Roles: Copilot, Admin, User Reviewer. | Scopes: read:submission',
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

  @Post('/:submissionId/artifacts')
  @Roles(UserRole.Admin, UserRole.Copilot, UserRole.User, UserRole.Reviewer)
  @Scopes(Scope.CreateSubmissionArtifacts)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Create artifact for the given submission ID',
    description:
      'Roles: Admin, Copilot, User, Reviewer | Scopes: create:submission-artifacts',
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
    @Req() req: Request,
    @Param('submissionId') submissionId: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<ArtifactsCreateResponseDto> {
    const authUser: JwtUser = req['user'] as JwtUser;
    return this.service.createArtifact(authUser, submissionId, file);
  }

  @Get('/:submissionId/artifacts')
  @Roles(UserRole.Copilot, UserRole.Admin, UserRole.User, UserRole.Reviewer)
  @Scopes(Scope.ReadSubmission)
  @ApiOperation({
    summary: 'List artifacts for the given Submission ID',
    description:
      'Roles: Copilot, Admin, User, Reviewer. | Scopes: read:submission',
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
    @Param('submissionId') submissionId: string,
  ): Promise<ArtifactsListResponseDto> {
    return this.service.listArtifacts(submissionId);
  }

  @Get('/:submissionId/artifacts/:artifactId/download')
  @Roles(UserRole.Copilot, UserRole.Admin, UserRole.User, UserRole.Reviewer)
  @Scopes(Scope.ReadSubmissionArtifacts)
  @ApiOperation({
    summary: 'Download artifact using Submission ID and Artifact ID',
    description:
      'Roles: Copilot, Admin, User, Reviewer. | Scopes: read:submission-artifacts',
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
    @Req() req: Request,
    @Param('submissionId') submissionId: string,
    @Param('artifactId') artifactId: string,
  ): Promise<StreamableFile> {
    const authUser: JwtUser = req['user'] as JwtUser;
    const { stream, contentType, fileName } = await this.service.getArtifactStream(
      authUser,
      submissionId,
      artifactId,
    );
    return new StreamableFile(stream, {
      type: contentType || 'application/octet-stream',
      disposition: `attachment; filename="${fileName}"`,
    });
  }

  @Delete('/:submissionId/artifacts/:artifactId')
  @Roles(UserRole.Admin, UserRole.Copilot, UserRole.User, UserRole.Reviewer)
  @Scopes(Scope.DeleteSubmissionArtifacts)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a artifact',
    description:
      'Roles: Admin, Copilot, User, Reviewer | Scopes: delete:submission-artifacts',
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
    @Req() req: Request,
    @Param('submissionId') submissionId: string,
    @Param('artifactId') artifactId: string,
  ) {
    const authUser: JwtUser = req['user'] as JwtUser;
    await this.service.deleteArtifact(authUser, submissionId, artifactId);
    return;
  }

  @Get('/:challengeId/count')
  @Roles(UserRole.Copilot, UserRole.Admin, UserRole.User, UserRole.Reviewer)
  @Scopes(Scope.ReadSubmission)
  @ApiOperation({
    summary: 'Get submission count for the given Challenge ID',
    description:
      'Roles: Copilot, Admin, User, Reviewer. | Scopes: read:submission',
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
    @Param('challengeId') challengeId: string,
  ): Promise<number> {
    // Return the actual count of submissions for the challenge
    return this.service.countSubmissionsForChallenge(challengeId);
  }

  @Get('/download/:challengeId')
  @Roles(UserRole.Copilot, UserRole.Admin, UserRole.User, UserRole.Reviewer)
  @Scopes(Scope.ReadSubmission)
  @ApiOperation({
    summary: 'Download all submissions for a challenge as a ZIP file',
    description:
      'Roles: Copilot, Admin, User, Reviewer. | Scopes: read:submission',
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
