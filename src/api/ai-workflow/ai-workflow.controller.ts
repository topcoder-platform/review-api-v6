import {
  Controller,
  Post,
  Body,
  Get,
  Patch,
  ValidationPipe,
  Query,
  Param,
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
import { AiWorkflowService } from './ai-workflow.service';
import {
  CreateAiWorkflowDto,
  CreateAiWorkflowRunDto,
  UpdateAiWorkflowDto,
  CreateAiWorkflowRunItemsDto,
  UpdateAiWorkflowRunDto,
} from '../../dto/aiWorkflow.dto';
import { Scopes } from 'src/shared/decorators/scopes.decorator';
import { UserRole } from 'src/shared/enums/userRole.enum';
import { Scope } from 'src/shared/enums/scopes.enum';
import { Roles } from 'src/shared/guards/tokenRoles.guard';
import { JwtUser } from 'src/shared/modules/global/jwt.service';
import { User } from 'src/shared/decorators/user.decorator';

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

  @Get()
  @Roles(UserRole.Admin, UserRole.User, UserRole.Copilot, UserRole.Reviewer)
  @Scopes(Scope.ReadWorkflow)
  @ApiOperation({ summary: 'Fetch AI workflows' })
  @ApiQuery({
    name: 'name',
    description: 'Filter AI workflows by name',
    required: false,
    type: 'string',
  })
  @ApiResponse({ status: 200, description: 'The AI workflow records.' })
  async fetchRecords(@Query('name') name: string) {
    return this.aiWorkflowService.getWorkflows({ name: name?.trim() });
  }

  @Get(':id')
  @Roles(UserRole.Admin, UserRole.User, UserRole.Copilot, UserRole.Reviewer)
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
    @Body() updateDto: UpdateAiWorkflowDto,
  ) {
    return this.aiWorkflowService.updateWorkflow(id, updateDto);
  }

  @Post('/:workflowId/runs')
  @Scopes(Scope.CreateWorkflowRun)
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

  @Get('/:workflowId/runs')
  @Roles(
    UserRole.Admin,
    UserRole.Copilot,
    UserRole.ProjectManager,
    UserRole.Reviewer,
    UserRole.Submitter,
    UserRole.User,
  )
  @Scopes(Scope.ReadWorkflowRun)
  @ApiOperation({
    summary: 'Get all the AI workflow runs for a given submission ID',
  })
  @ApiQuery({
    name: 'submissionId',
    description: 'The ID of the submission to fetch AI workflow runs for',
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'The AI workflow runs for the given submission ID.',
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  getRuns(
    @Param('workflowId') workflowId: string,
    @Query('submissionId') submissionId: string,
    @User() user: JwtUser,
  ) {
    return this.aiWorkflowService.getWorkflowRuns(workflowId, user, {
      submissionId,
    });
  }

  @Get('/:workflowId/runs/:runId')
  @Roles(
    UserRole.Admin,
    UserRole.Copilot,
    UserRole.ProjectManager,
    UserRole.Reviewer,
    UserRole.Submitter,
    UserRole.User,
  )
  @Scopes(Scope.ReadWorkflowRun)
  @ApiOperation({
    summary: 'Get an AI workflow run by its ID',
  })
  @ApiParam({
    name: 'runId',
    description: 'The ID of the run to fetch AI workflow run',
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'The AI workflow run for the given ID.',
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async getRun(
    @Param('workflowId') workflowId: string,
    @Param('runId') runId: string,
    @User() user: JwtUser,
  ) {
    const runs = await this.aiWorkflowService.getWorkflowRuns(
      workflowId,
      user,
      {
        runId,
      },
    );

    return runs[0];
  }

  @Patch('/:workflowId/runs/:runId')
  @Scopes(Scope.UpdateWorkflowRun)
  @ApiOperation({ summary: 'Update a run for an AI workflow' })
  @ApiResponse({
    status: 200,
    description: 'The AI workflow run has been successfully updated.',
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  updateRun(
    @Param('workflowId') workflowId: string,
    @Param('runId') runId: string,
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    body: UpdateAiWorkflowRunDto,
  ) {
    return this.aiWorkflowService.updateWorkflowRun(workflowId, runId, body);
  }

  @Post('/:workflowId/runs/:runId/items')
  @Scopes(Scope.CreateWorkflowRun)
  @ApiOperation({ summary: 'Create AIWorkflowRunItems in batch' })
  @ApiResponse({
    status: 201,
    description: 'AIWorkflowRunItems created successfully.',
  })
  @ApiResponse({ status: 400, description: 'Bad Request.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Workflow or Run not found.' })
  async createRunItems(
    @Param('workflowId') workflowId: string,
    @Param('runId') runId: string,
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    createItemsDto: CreateAiWorkflowRunItemsDto,
  ) {
    return this.aiWorkflowService.createRunItemsBatch(
      workflowId,
      runId,
      createItemsDto.items,
    );
  }

  @Get('/:workflowId/runs/:runId/items')
  @Roles(
    UserRole.Admin,
    UserRole.Copilot,
    UserRole.ProjectManager,
    UserRole.User,
  )
  @Scopes(Scope.ReadWorkflowRun)
  @ApiOperation({
    summary: 'Get AIWorkflowRunItems for a given workflow run ID',
  })
  @ApiResponse({
    status: 200,
    description: 'The AIWorkflowRunItems for the given run ID.',
  })
  @ApiResponse({ status: 400, description: 'Bad Request.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Run not found.' })
  async getRunItems(
    @Param('workflowId') workflowId: string,
    @Param('runId') runId: string,
    @User() user: JwtUser,
  ) {
    return this.aiWorkflowService.getRunItems(workflowId, runId, user);
  }
}
