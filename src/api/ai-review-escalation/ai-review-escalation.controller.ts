import {
  Controller,
  Post,
  Patch,
  Body,
  Param,
  ValidationPipe,
  Get,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { AiReviewEscalationService } from './ai-review-escalation.service';
import {
  CreateAiReviewEscalationDto,
  UpdateAiReviewEscalationDto,
  AiReviewDecisionEscalationResponseDto,
  ListAiReviewEscalationQueryDto,
  AiReviewDecisionEscalationDecisionResponseDto,
  AiReviewDecisionEscalationStatus,
} from '../../dto/aiReviewEscalation.dto';
import { User } from 'src/shared/decorators/user.decorator';
import { JwtUser } from 'src/shared/modules/global/jwt.service';
import { UserRole } from 'src/shared/enums/userRole.enum';
import { Roles } from 'src/shared/guards/tokenRoles.guard';

@ApiTags('AI Review Escalation')
@ApiBearerAuth()
@Controller('ai-review')
export class AiReviewEscalationController {
  constructor(
    private readonly aiReviewEscalationService: AiReviewEscalationService,
  ) {}

  @Get('escalations')
  @Roles(UserRole.Admin, UserRole.Copilot, UserRole.Reviewer)
  @ApiOperation({
    summary: 'List AI review escalations by challenge, submission, or decision',
    description:
      'Roles: Admin, Copilot, Reviewer. Requires one of challengeId, submissionId, or aiReviewDecisionId. Returns AI review decision entries with associated escalations.',
  })
  @ApiQuery({
    name: 'challengeId',
    required: false,
    type: String,
    description: 'Filter by challenge ID',
  })
  @ApiQuery({
    name: 'submissionId',
    required: false,
    type: String,
    description: 'Filter by submission ID',
  })
  @ApiQuery({
    name: 'aiReviewDecisionId',
    required: false,
    type: String,
    description: 'Filter by AI review decision ID',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: AiReviewDecisionEscalationStatus,
    description: 'Filter escalations by status',
  })
  @ApiQuery({
    name: 'submissionLocked',
    required: false,
    type: Boolean,
    description: 'Filter by decision lock state',
  })
  @ApiResponse({
    status: 200,
    description: 'List of AI review decisions and related escalation records.',
    type: [AiReviewDecisionEscalationDecisionResponseDto],
  })
  @ApiResponse({
    status: 400,
    description:
      'Bad Request. At least one of challengeId, submissionId, or aiReviewDecisionId is required.',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden. Caller is not assigned to challenge.',
  })
  async list(
    @Query(new ValidationPipe({ whitelist: true, transform: true }))
    query: ListAiReviewEscalationQueryDto,
    @User() authUser: JwtUser,
  ): Promise<AiReviewDecisionEscalationDecisionResponseDto[]> {
    const results: AiReviewDecisionEscalationDecisionResponseDto[] =
      await this.aiReviewEscalationService.list(query, authUser);
    return results;
  }

  @Post('decisions/:id/escalation')
  @Roles(UserRole.Admin, UserRole.Copilot, UserRole.Reviewer)
  @ApiOperation({
    summary: 'Create an AI review escalation',
    description:
      'Roles: Admin, Copilot, Reviewer, Screener, Checkpoint Screener. Reviewer: creates with PENDING_APPROVAL (escalationNotes required) when challenge is in Review or Iterative Review phase. Screener/Checkpoint Screener: same PENDING_APPROVAL flow when challenge is in Screening or Checkpoint Screening phase. Admin/Copilot: direct unlock with APPROVED (approverNotes required). Override not allowed for passing decisions. Once an escalation is APPROVED for the decision, no further escalation or unlock actions are allowed.',
  })
  @ApiParam({
    name: 'id',
    description: 'The ID of the AI review decision',
    example: '229c5PnhSKqsSu',
  })
  @ApiBody({
    description: 'Escalation payload',
    type: CreateAiReviewEscalationDto,
  })
  @ApiResponse({
    status: 201,
    description: 'The escalation has been created.',
    type: AiReviewDecisionEscalationResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Bad Request. Missing required notes for role, override not allowed for passing decision, or an approved escalation already exists for this decision.',
  })
  @ApiResponse({
    status: 403,
    description:
      'Forbidden. Challenge not in the required phase (Review/Iterative Review for Reviewers; Screening/Checkpoint Screening for Screeners)',
  })
  @ApiResponse({
    status: 404,
    description: 'AI review decision not found.',
  })
  async create(
    @Param('id') id: string,
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: CreateAiReviewEscalationDto,
    @User() authUser: JwtUser,
  ) {
    return this.aiReviewEscalationService.create(id, dto, authUser);
  }

  @Patch('decisions/:id/escalation/:escalationId')
  @Roles(UserRole.Admin, UserRole.Copilot)
  @ApiOperation({
    summary: 'Update an AI review escalation',
    description:
      'Roles: Admin, Copilot. React to a PENDING_APPROVAL escalation: set approverNotes and status to APPROVED or REJECTED. If APPROVED, the decision is set to HUMAN_OVERRIDE and submissionLocked to false. Once an escalation is APPROVED for the decision, no further escalation or unlock actions are allowed.',
  })
  @ApiParam({
    name: 'id',
    description: 'The ID of the AI review decision',
    example: '229c5PnhSKqsSu',
  })
  @ApiParam({
    name: 'escalationId',
    description: 'The ID of the escalation record',
    example: 'abc12Def34Ghi56',
  })
  @ApiBody({
    description: 'Update payload',
    type: UpdateAiReviewEscalationDto,
  })
  @ApiResponse({
    status: 200,
    description: 'The escalation has been updated.',
    type: AiReviewDecisionEscalationResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Bad Request. Only PENDING_APPROVAL escalations can be updated, and updates are blocked if an approved escalation already exists for this decision.',
  })
  @ApiResponse({
    status: 404,
    description: 'Escalation not found for this decision.',
  })
  async update(
    @Param('id') id: string,
    @Param('escalationId') escalationId: string,
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: UpdateAiReviewEscalationDto,
    @User() authUser: JwtUser,
  ) {
    return this.aiReviewEscalationService.update(
      id,
      escalationId,
      dto,
      authUser,
    );
  }
}
