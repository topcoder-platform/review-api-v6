import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Patch,
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
import { AiWorkflowService } from './aiWorkflow.service';
import {
  CreateAiWorkflowDto,
  CreateAiWorkflowRunDto,
  UpdateAiWorkflowDto,
} from '../../dto/aiWorkflow.dto';
import { Scopes } from 'src/shared/decorators/scopes.decorator';
import { UserRole } from 'src/shared/enums/userRole.enum';
import { Scope } from 'src/shared/enums/scopes.enum';
import { Roles } from 'src/shared/guards/tokenRoles.guard';
import { User } from 'src/shared/decorators/user.decorator';
import { JwtUser } from 'src/shared/modules/global/jwt.service';

@ApiTags('ai_workflow')
@ApiBearerAuth()
@Controller('/workflows')
export class AiWorkflowController {
  constructor(private readonly aiWorkflowService: AiWorkflowService) {}

  @Post()
  @Roles(UserRole.Admin)
  @Scopes(Scope.CreateWorkflow)
  @ApiOperation({ summary: 'Create a new AI workflow' })
  @ApiResponse({
    status: 201,
    description: 'The AI workflow has been successfully created.',
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async create(@Body() createAiWorkflowDto: CreateAiWorkflowDto) {
    return this.aiWorkflowService.createWithValidation(createAiWorkflowDto);
  }

  @Get(':id')
  @Roles(
    UserRole.Admin,
    UserRole.User,
    UserRole.Copilot,
    UserRole.Reviewer,
    UserRole.Submitter,
    UserRole.Talent,
  )
  @Scopes(Scope.ReadWorkflow)
  @ApiOperation({ summary: 'Get an AI workflow by ID' })
  @ApiResponse({ status: 200, description: 'The AI workflow record.' })
  @ApiResponse({ status: 404, description: 'AI workflow not found.' })
  async getById(@Param('id') id: string) {
    return this.aiWorkflowService.getWorkflowById(id);
  }

  @Patch('/:id')
  @Scopes(Scope.UpdateWorkflow)
  @Roles(UserRole.Admin)
  @ApiOperation({ summary: 'Update an existing AI workflow' })
  @ApiParam({
    name: 'id',
    description: 'The ID of the AI workflow',
    example: '229c5PnhSKqsSu',
  })
  @ApiBody({ description: 'AI workflow data', type: UpdateAiWorkflowDto })
  @ApiResponse({
    status: 200,
    description: 'AI workflow updated successfully.',
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'AI workflow not found.' })
  async update(
    @Param('id') id: string,
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    updateDto: UpdateAiWorkflowDto,
    @User() user: JwtUser,
  ) {
    return this.aiWorkflowService.updateWorkflow(id, updateDto, user.userId);
  }

  @Post('/:workflowId/runs')
  @Roles(UserRole.Admin)
  @Scopes(Scope.CreateWorkflowRuns)
  @ApiOperation({ summary: 'Create a new run for an AI workflow' })
  @ApiResponse({
    status: 201,
    description: 'The AI workflow run has been successfully created.',
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  createRun(
    @Param('workflowId') workflowId: string,
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    body: CreateAiWorkflowRunDto,
  ) {
    return this.aiWorkflowService.createWorkflowRun(workflowId, body);
  }
}
