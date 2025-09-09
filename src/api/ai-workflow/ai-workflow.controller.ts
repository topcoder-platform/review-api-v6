import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { AiWorkflowService } from './ai-workflow.service';
import { CreateAiWorkflowDto } from '../../dto/aiWorkflow.dto';
import { Scopes } from 'src/shared/decorators/scopes.decorator';
import { UserRole } from 'src/shared/enums/userRole.enum';
import { Scope } from 'src/shared/enums/scopes.enum';
import { Roles } from 'src/shared/guards/tokenRoles.guard';

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
  @Roles(UserRole.Admin, UserRole.User, UserRole.Copilot, UserRole.Reviewer)
  @Scopes(Scope.ReadWorkflow)
  @ApiOperation({ summary: 'Get an AI workflow by ID' })
  @ApiResponse({ status: 200, description: 'The AI workflow record.' })
  @ApiResponse({ status: 404, description: 'AI workflow not found.' })
  async getById(@Param('id') id: string) {
    return this.aiWorkflowService.getWorkflowById(id);
  }
}
