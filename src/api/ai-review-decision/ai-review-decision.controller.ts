import {
  Controller,
  Get,
  Param,
  Query,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { AiReviewDecisionService } from './ai-review-decision.service';
import {
  ListAiReviewDecisionQueryDto,
  AiReviewDecisionResponseDto,
  AiReviewDecisionStatus,
} from '../../dto/aiReviewDecision.dto';
import { Scopes } from 'src/shared/decorators/scopes.decorator';
import { User } from 'src/shared/decorators/user.decorator';
import { JwtUser } from 'src/shared/modules/global/jwt.service';
import { UserRole } from 'src/shared/enums/userRole.enum';
import { Scope } from 'src/shared/enums/scopes.enum';
import { Roles } from 'src/shared/guards/tokenRoles.guard';

@ApiTags('AI Review Decisions')
@ApiBearerAuth()
@Controller('ai-review/decisions')
export class AiReviewDecisionController {
  constructor(
    private readonly aiReviewDecisionService: AiReviewDecisionService,
  ) {}

  @Get()
  @Roles(
    UserRole.Admin,
    UserRole.Copilot,
    UserRole.Submitter,
    UserRole.Reviewer,
    UserRole.ProjectManager,
    UserRole.Observer,
    UserRole.Approver,
  )
  @Scopes(Scope.ReadAiReviewDecision)
  @ApiOperation({
    summary: 'List AI review decisions',
    description:
      'Roles: Admin, Copilot, Submitter, Reviewer, Manager, Observer, Approver | Scopes: read:ai-review-decision. For non-admin, configId or submissionId is required.',
  })
  @ApiQuery({
    name: 'submissionId',
    description: 'Filter by submission ID',
    required: false,
    type: String,
  })
  @ApiQuery({
    name: 'configId',
    description: 'Filter by AI review config ID',
    required: false,
    type: String,
  })
  @ApiQuery({
    name: 'status',
    description: 'Filter by decision status',
    required: false,
    enum: AiReviewDecisionStatus,
  })
  @ApiResponse({
    status: 200,
    description: 'List of AI review decisions.',
    type: [AiReviewDecisionResponseDto],
  })
  @ApiResponse({
    status: 400,
    description:
      'Bad Request. For non-admin access, configId or submissionId is required.',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden. Caller is not assigned to the challenge.',
  })
  async list(
    @Query(new ValidationPipe({ whitelist: true, transform: true }))
    query: ListAiReviewDecisionQueryDto,
    @User() authUser: JwtUser,
  ) {
    return this.aiReviewDecisionService.list(query, authUser);
  }

  @Get(':id')
  @Roles(
    UserRole.Admin,
    UserRole.Copilot,
    UserRole.Submitter,
    UserRole.Reviewer,
    UserRole.ProjectManager,
    UserRole.Observer,
    UserRole.Approver,
  )
  @Scopes(Scope.ReadAiReviewDecision)
  @ApiOperation({
    summary: 'Get AI review decision by ID',
    description:
      'Roles: Admin, Copilot, Submitter, Reviewer, Manager, Observer, Approver | Scopes: read:ai-review-decision',
  })
  @ApiParam({
    name: 'id',
    description: 'The ID of the AI review decision',
    example: '229c5PnhSKqsSu',
  })
  @ApiResponse({
    status: 200,
    description: 'The AI review decision.',
    type: AiReviewDecisionResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden. Caller is not assigned to the challenge.',
  })
  @ApiResponse({ status: 404, description: 'AI review decision not found.' })
  async getById(@Param('id') id: string, @User() authUser: JwtUser) {
    return this.aiReviewDecisionService.getById(id, authUser);
  }
}
