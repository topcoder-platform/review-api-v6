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
  Redirect,
  Header,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiBody,
  ApiBearerAuth,
  ApiConsumes,
  ApiQuery,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Request } from 'express';

import { Roles } from 'src/shared/guards/tokenRoles.guard';
import { UserRole } from 'src/shared/enums/userRole.enum';
import { Scopes } from 'src/shared/decorators/scopes.decorator';
import { Scope } from 'src/shared/enums/scopes.enum';
import {
  SubmissionQueryDto,
  SubmissionResponseDto,
  SubmissionRequestDto,
  ManualSubmissionUploadRequestDto,
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
import { SubmissionAccessAuditResponseDto } from 'src/dto/submission-access-audit.dto';
import { SubmissionPreviewService } from 'src/shared/modules/global/submission-preview.service';

@ApiTags('Submissions')
@ApiBearerAuth()
@Controller('/submissions')
export class SubmissionController {
  private readonly logger: LoggerService;

  constructor(
    private readonly service: SubmissionService,
    private readonly submissionPreviewService: SubmissionPreviewService,
  ) {
    this.logger = LoggerService.forRoot('SubmissionController');
  }

  @Post()
  @Roles(UserRole.Admin, UserRole.Copilot, UserRole.User)
  @Scopes(Scope.CreateSubmission)
  @ApiOperation({
    summary:
      'Create a new submission when the required submission phase is open (Submission, Checkpoint Submission, or Final Fix)',
    description:
      'Roles: Admin, User (must be registered to the challenge). Final Fix submissions are restricted to winners. | Scopes: create:submission',
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
        file: {
          type: 'string',
          format: 'binary',
        },
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
    @UploadedFile() file: Express.Multer.File,
    @Body() body: SubmissionRequestDto,
  ): Promise<SubmissionResponseDto> {
    console.log(
      `Creating submission with request body: ${JSON.stringify(body)}`,
    );
    const authUser: JwtUser = req['user'] as JwtUser;
    return this.service.createSubmission(authUser, body, file);
  }

  @Post('/manual-upload')
  @Roles(UserRole.Admin)
  @Scopes(Scope.CreateSubmission)
  @ApiOperation({
    summary:
      'Upload and create a submission as Admin/M2M through the manual upload flow',
    description:
      'Roles: Admin (M2M allowed via scope). Uploads file contents to DMZ before creating the submission and triggering normal scan/event flow. By default, the relevant submission window must be closed and a downstream screening/review phase must be open. Set MANUAL_UPLOAD_ALLOW_OPEN_SUBMISSION_PHASE=true to allow this endpoint during the active submission window. | Scopes: create:submission',
  })
  @ApiResponse({
    status: 201,
    description: 'Manual submission uploaded and created successfully.',
    type: SubmissionResponseDto,
  })
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
        file: {
          type: 'string',
          format: 'binary',
        },
        fileName: {
          type: 'string',
        },
        challengeId: {
          type: 'string',
        },
        memberHandle: {
          type: 'string',
        },
        type: {
          type: 'string',
        },
        memberId: {
          type: 'number',
        },
        legacySubmissionId: {
          type: 'string',
        },
        legacyUploadId: {
          type: 'string',
        },
        submissionPhaseId: {
          type: 'string',
        },
        submittedDate: {
          type: 'string',
          format: 'date-time',
        },
      },
      required: ['file', 'challengeId', 'type', 'memberId'],
    },
  })
  async manualUploadSubmission(
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: ManualSubmissionUploadRequestDto,
  ): Promise<SubmissionResponseDto> {
    const authUser: JwtUser = req['user'] as JwtUser;
    return this.service.createManualSubmissionUpload(authUser, body, file);
  }

  @Post('/validation-upload')
  @Roles(UserRole.Admin)
  @Scopes(
    Scope.CreateSubmission,
    Scope.UpdateMarathonMatch,
    Scope.AllMarathonMatch,
  )
  @ApiOperation({
    summary: 'Upload and create a clean validation submission as Admin/M2M',
    description:
      'Roles: Admin (M2M allowed via create:submission, update:marathon-match, or all:marathon-match scope). Uploads file contents directly to clean submission storage and creates a downloadable submission row without phase, submitter, counter, scan, or notification side effects. Intended for Marathon Match scorer validation before challenge launch.',
  })
  @ApiResponse({
    status: 201,
    description: 'Validation submission uploaded and created successfully.',
    type: SubmissionResponseDto,
  })
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
        file: {
          type: 'string',
          format: 'binary',
        },
        fileName: {
          type: 'string',
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
        submissionPhaseId: {
          type: 'string',
        },
        submittedDate: {
          type: 'string',
          format: 'date-time',
        },
      },
      required: ['file', 'challengeId', 'type', 'memberId'],
    },
  })
  async validationUploadSubmission(
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: ManualSubmissionUploadRequestDto,
  ): Promise<SubmissionResponseDto> {
    const authUser: JwtUser = req['user'] as JwtUser;
    return this.service.createValidationSubmissionUpload(authUser, body, file);
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
    @Req() req: Request,
    @Query() queryDto: SubmissionQueryDto,
    @Query() paginationDto?: PaginationDto,
    @Query() sortDto?: SortDto,
  ): Promise<PaginatedResponse<SubmissionResponseDto>> {
    this.logger.log(
      `Getting submissions with filters - ${JSON.stringify(queryDto)}`,
    );
    const authUser: JwtUser =
      (req['user'] as JwtUser) ?? ({ isMachine: false, roles: [] } as JwtUser);
    return this.service.listSubmission(
      authUser,
      queryDto,
      paginationDto,
      sortDto,
    );
  }

  @Get('/:submissionId/preview')
  @ApiOperation({
    summary: 'View a released Design submission preview',
    description:
      'Public-safe redirect to an immutable Payload asset. Challenge whitelist access is enforced for anonymous and authenticated callers. Checkpoint previews remain unavailable until Checkpoint Review has an actual end time; contest previews remain unavailable until Review has an actual end time. Every absent, failed, or not-yet-released preview returns the same 404 response.',
  })
  @ApiParam({
    name: 'submissionId',
    description: 'The submission whose preview should be displayed',
  })
  @ApiResponse({
    status: HttpStatus.FOUND,
    description: 'Redirects to the immutable public Payload asset URL.',
    headers: {
      Location: {
        description: 'Public preview image URL.',
        schema: { type: 'string', format: 'uri' },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'The caller cannot access the challenge whitelist.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'The preview is absent or has not reached its release gate.',
  })
  @Header('Cache-Control', 'private, no-store')
  @Redirect('', HttpStatus.FOUND)
  /**
   * Redirects to a released preview after public visibility checks.
   *
   * @param req - Optional authenticated request used for whitelist access.
   * @param submissionId - Submission whose preview is requested.
   * @returns A 302 redirect descriptor for Nest.
   * @throws ForbiddenException when whitelist access is denied.
   * @throws NotFoundException while the preview is unavailable.
   */
  async getSubmissionPreview(
    @Req() req: Request,
    @Param('submissionId') submissionId: string,
  ): Promise<{ url: string; statusCode: HttpStatus }> {
    const authUser = req['user'] as JwtUser | undefined;
    const url = await this.submissionPreviewService.getVisiblePreviewUrl(
      authUser,
      submissionId,
    );
    return { url, statusCode: HttpStatus.FOUND };
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
    @Req() req: Request,
    @Param('submissionId') submissionId: string,
  ): Promise<SubmissionResponseDto> {
    this.logger.log(`Getting submission with ID: ${submissionId}`);
    const authUser: JwtUser = req['user'] as JwtUser;
    return this.service.getSubmission(authUser, submissionId);
  }

  @Delete('/:submissionId')
  @Roles(UserRole.Admin, UserRole.Copilot, UserRole.User, UserRole.Reviewer)
  @Scopes(Scope.DeleteSubmission)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a submission',
    description: 'Roles: Admin, User | Scopes: delete:submission',
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
  async deleteSubmission(
    @Req() req: Request,
    @Param('submissionId') submissionId: string,
  ) {
    this.logger.log(`Deleting submission with ID: ${submissionId}`);
    const authUser: JwtUser = req['user'] as JwtUser;
    await this.service.deleteSubmission(authUser, submissionId);
    return { message: `Submission ${submissionId} deleted successfully.` };
  }

  @Get('/:submissionId/download')
  @Roles(UserRole.Copilot, UserRole.Admin, UserRole.User, UserRole.Reviewer)
  @Scopes(Scope.ReadSubmission)
  @ApiOperation({
    summary: 'Get a temporary redirect for downloading the submission',
    description:
      'Roles: Copilot, Admin, User, Reviewer. After challenge completion, the exact metadata value allowAllRegistrantsToDownloadWinningSubmissions=true lets every registered Submitter download only an exact final winning submission and denies non-winners without legacy fallback. Other values require passing-submission eligibility, except non-Design First2Finish challenges retain legacy submitter eligibility. Browser XHR/fetch clients should use /submissions/{submissionId}/download-url to avoid a cross-origin redirect. | Scopes: read:submission',
  })
  @ApiParam({
    name: 'submissionId',
    description: 'The ID of the submission',
  })
  @ApiResponse({
    status: HttpStatus.FOUND,
    description:
      'Redirects to a short-lived signed URL for the clean submission file.',
    headers: {
      Location: {
        description: 'Short-lived signed S3 download URL.',
        schema: { type: 'string', format: 'uri' },
      },
    },
  })
  @Header('Cache-Control', 'private, no-store')
  @Redirect('', HttpStatus.FOUND)
  async downloadSubmission(
    @Req() req: Request,
    @Param('submissionId') submissionId: string,
  ): Promise<{ url: string; statusCode: HttpStatus }> {
    const authUser: JwtUser = req['user'] as JwtUser;
    const url = await this.service.getSubmissionDownloadUrl(
      authUser,
      submissionId,
    );
    return { url, statusCode: HttpStatus.FOUND };
  }

  /**
   * Issues a short-lived signed submission download URL as JSON without an
   * HTTP redirect. Browser clients use this endpoint before making a separate
   * request to clean submission storage.
   *
   * @param req - Request containing the authenticated user or machine token.
   * @param submissionId - ID of the submission to download.
   * @returns An object containing the authorized short-lived download URL.
   * @throws ForbiddenException when the requester cannot download the submission.
   * @throws NotFoundException when the submission or clean object is unavailable.
   * @throws InternalServerErrorException when URL signing cannot be completed.
   */
  @Get('/:submissionId/download-url')
  @Roles(UserRole.Copilot, UserRole.Admin, UserRole.User, UserRole.Reviewer)
  @Scopes(Scope.ReadSubmission)
  @ApiOperation({
    summary: 'Get a temporary URL for downloading the submission',
    description:
      'Roles: Copilot, Admin, User, Reviewer. Returns a short-lived clean-storage URL as JSON so browser clients can start a separate download without following a cross-origin API redirect. The same submission download authorization rules apply as for /submissions/{submissionId}/download. | Scopes: read:submission',
  })
  @ApiParam({
    name: 'submissionId',
    description: 'The ID of the submission',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Short-lived signed URL for the clean submission file.',
    schema: {
      type: 'object',
      required: ['url'],
      properties: {
        url: {
          type: 'string',
          format: 'uri',
          description: 'Short-lived signed S3 download URL.',
        },
      },
    },
  })
  @Header('Cache-Control', 'private, no-store')
  async getSubmissionDownloadUrl(
    @Req() req: Request,
    @Param('submissionId') submissionId: string,
  ): Promise<{ url: string }> {
    const authUser: JwtUser = req['user'] as JwtUser;
    const url = await this.service.getSubmissionDownloadUrl(
      authUser,
      submissionId,
    );
    return { url };
  }

  @Get('/:submissionId/access-audit')
  @Roles(UserRole.Admin)
  @Scopes(Scope.ReadSubmission)
  @ApiOperation({
    summary: 'List access audit records for a submission',
    description: 'Roles: Admin | Scopes: read:submission (M2M allowed)',
  })
  @ApiParam({
    name: 'submissionId',
    description: 'The ID of the submission',
  })
  @ApiResponse({
    status: 200,
    description: 'List of audit records',
    type: [SubmissionAccessAuditResponseDto],
  })
  async listSubmissionAccessAudit(
    @Req() req: Request,
    @Param('submissionId') submissionId: string,
  ): Promise<SubmissionAccessAuditResponseDto[]> {
    const authUser: JwtUser = req['user'] as JwtUser;
    return this.service.listSubmissionAccessAudit(authUser, submissionId);
  }

  @Post('/:submissionId/artifacts')
  @Roles(UserRole.Admin, UserRole.User)
  @Scopes(Scope.CreateSubmissionArtifacts)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Create artifact for the given submission ID',
    description: 'Roles: Admin, User | Scopes: create:submission-artifacts',
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
  @ApiQuery({
    name: 'filename',
    required: false,
    description:
      'Optional file name (without extension) to use when storing the artifact',
  })
  async createArtifact(
    @Req() req: Request,
    @Param('submissionId') submissionId: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('filename') filename?: string,
  ): Promise<ArtifactsCreateResponseDto> {
    const authUser: JwtUser = req['user'] as JwtUser;
    return this.service.createArtifact(authUser, submissionId, file, filename);
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
    @Req() req: Request,
    @Param('submissionId') submissionId: string,
  ): Promise<ArtifactsListResponseDto> {
    const authUser: JwtUser = req['user'] as JwtUser;
    return this.service.listArtifacts(authUser, submissionId);
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
    const { stream, contentType, fileName } =
      await this.service.getArtifactStream(authUser, submissionId, artifactId);
    return new StreamableFile(stream, {
      type: contentType || 'application/octet-stream',
      disposition: `attachment; filename="${fileName}"`,
    });
  }

  @Delete('/:submissionId/artifacts/:artifactId')
  @Roles(UserRole.Admin, UserRole.User)
  @Scopes(Scope.DeleteSubmissionArtifacts)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a artifact',
    description: 'Roles: Admin, User | Scopes: delete:submission-artifacts',
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
    @Req() req: Request,
    @Param('challengeId') challengeId: string,
  ): Promise<number> {
    // Return the actual count of submissions for the challenge
    const authUser: JwtUser = req['user'] as JwtUser;
    return this.service.countSubmissionsForChallenge(authUser, challengeId);
  }

  @Get('/download/:challengeId')
  @Roles(UserRole.Copilot, UserRole.Admin, UserRole.User, UserRole.Reviewer)
  @Scopes(Scope.ReadSubmission)
  @ApiOperation({
    summary: 'Download all submissions for a challenge as a ZIP file',
    description: 'Roles: Copilot, Admin, Reviewer. | Scopes: read:submission',
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
    @Req() req: Request,
    @Param('challengeId') challengeId: string,
    @Query('status') status?: string,
  ): Promise<StreamableFile> {
    const authUser: JwtUser = req['user'] as JwtUser;
    const { stream, contentType, fileName } =
      await this.service.getChallengeSubmissionsZipStream(
        authUser,
        challengeId,
        { status },
      );
    return new StreamableFile(stream, {
      type: contentType || 'application/zip',
      disposition: `attachment; filename="${fileName}"`,
    });
  }
}
