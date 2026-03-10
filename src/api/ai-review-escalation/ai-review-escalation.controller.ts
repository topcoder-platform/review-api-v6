import {
  Controller,
  Post,
  Patch,
  Body,
  Param,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { AiReviewEscalationService } from './ai-review-escalation.service';
import {
  CreateAiReviewEscalationDto,
  UpdateAiReviewEscalationDto,
  AiReviewDecisionEscalationResponseDto,
} from '../../dto/aiReviewEscalation.dto';
import { User } from 'src/shared/decorators/user.decorator';
import { JwtUser } from 'src/shared/modules/global/jwt.service';
import { UserRole } from 'src/shared/enums/userRole.enum';
import { Roles } from 'src/shared/guards/tokenRoles.guard';

@ApiTags('AI Review Escalation')
@ApiBearerAuth()
@Controller('ai-review/decisions/:id/escalation')
export class AiReviewEscalationController {
  constructor(
    private readonly aiReviewEscalationService: AiReviewEscalationService,
  ) {}

  @Post()
  @Roles(
    UserRole.Admin,
    UserRole.Copilot,
    UserRole.Reviewer,
  )
  @ApiOperation({
    summary: 'Create an AI review escalation',
    description:
      'Roles: Admin, Copilot, Reviewer, Screener, Checkpoint Screener. Reviewer: creates with PENDING_APPROVAL (escalationNotes required) when challenge is in Review or Iterative Review phase. Screener/Checkpoint Screener: same PENDING_APPROVAL flow when challenge is in Screening or Checkpoint Screening phase. Admin/Copilot: direct unlock with APPROVED (approverNotes required). Override not allowed for passing decisions.',
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
      'Bad Request. Missing required notes for role, or override not allowed for passing decision.',
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

  @Patch(':escalationId')
  @Roles(UserRole.Admin, UserRole.Copilot)
  @ApiOperation({
    summary: 'Update an AI review escalation',
    description:
      'Roles: Admin, Copilot. React to a PENDING_APPROVAL escalation: set approverNotes and status to APPROVED or REJECTED. If APPROVED, the decision is set to HUMAN_OVERRIDE and submissionLocked to false.',
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
      'Bad Request. Only PENDING_APPROVAL escalations can be updated.',
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
