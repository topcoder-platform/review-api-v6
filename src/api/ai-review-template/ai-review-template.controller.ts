import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
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
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { AiReviewTemplateService } from './ai-review-template.service';
import {
  CreateAiReviewTemplateConfigDto,
  UpdateAiReviewTemplateConfigDto,
  ListAiReviewTemplateQueryDto,
  AiReviewTemplateConfigResponseDto,
} from '../../dto/aiReviewTemplateConfig.dto';
import { Scopes } from 'src/shared/decorators/scopes.decorator';
import { UserRole } from 'src/shared/enums/userRole.enum';
import { Scope } from 'src/shared/enums/scopes.enum';
import { Roles } from 'src/shared/guards/tokenRoles.guard';

@ApiTags('AI Review Templates')
@ApiBearerAuth()
@Controller('ai-review/templates')
export class AiReviewTemplateController {
  constructor(
    private readonly aiReviewTemplateService: AiReviewTemplateService,
  ) {}

  @Post()
  @Roles(UserRole.Admin, UserRole.Copilot)
  @Scopes(Scope.CreateAiReviewTemplate)
  @ApiOperation({
    summary: 'Create an AI review template',
    description: 'Roles: Admin, Copilot | Scopes: create:ai-review-template',
  })
  @ApiBody({
    description: 'AI review template configuration',
    type: CreateAiReviewTemplateConfigDto,
  })
  @ApiResponse({
    status: 201,
    description: 'The AI review template has been successfully created.',
    type: AiReviewTemplateConfigResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request (e.g. workflow not found).',
  })
  @ApiResponse({
    status: 409,
    description:
      'Conflict. A template already exists for this challenge track and challenge type combination.',
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async create(
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: CreateAiReviewTemplateConfigDto,
  ) {
    return this.aiReviewTemplateService.create(dto);
  }

  @Get()
  @Roles(UserRole.Admin, UserRole.Copilot)
  @Scopes(Scope.ReadAiReviewTemplate)
  @ApiOperation({
    summary: 'List AI review templates',
    description: 'Roles: Admin, Copilot | Scopes: read:ai-review-template',
  })
  @ApiQuery({
    name: 'challengeTrack',
    description: 'Filter by challenge track',
    required: false,
    type: String,
  })
  @ApiQuery({
    name: 'challengeType',
    description: 'Filter by challenge type',
    required: false,
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: 'List of AI review templates.',
    type: [AiReviewTemplateConfigResponseDto],
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async findAll(
    @Query(new ValidationPipe({ whitelist: true, transform: true }))
    query: ListAiReviewTemplateQueryDto,
  ) {
    return this.aiReviewTemplateService.findAll({
      challengeTrack: query.challengeTrack,
      challengeType: query.challengeType,
    });
  }

  @Get(':id')
  @Roles(UserRole.Admin, UserRole.Copilot)
  @Scopes(Scope.ReadAiReviewTemplate)
  @ApiOperation({
    summary: 'Get an AI review template by ID',
    description: 'Roles: Admin, Copilot | Scopes: read:ai-review-template',
  })
  @ApiParam({
    name: 'id',
    description: 'The ID of the AI review template',
    example: '229c5PnhSKqsSu',
  })
  @ApiResponse({
    status: 200,
    description: 'The AI review template.',
    type: AiReviewTemplateConfigResponseDto,
  })
  @ApiResponse({ status: 404, description: 'AI review template not found.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async findOne(@Param('id') id: string) {
    return this.aiReviewTemplateService.findById(id);
  }

  @Put(':id')
  @Roles(UserRole.Admin, UserRole.Copilot)
  @Scopes(Scope.UpdateAiReviewTemplate)
  @ApiOperation({
    summary: 'Update an AI review template',
    description:
      'Roles: Admin, Copilot | Scopes: update:ai-review-template. challengeTrack and challengeType cannot be updated.',
  })
  @ApiParam({
    name: 'id',
    description: 'The ID of the AI review template',
    example: '229c5PnhSKqsSu',
  })
  @ApiBody({
    description: 'Partial AI review template data',
    type: UpdateAiReviewTemplateConfigDto,
  })
  @ApiResponse({
    status: 200,
    description: 'AI review template updated successfully.',
    type: AiReviewTemplateConfigResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request (e.g. workflow not found).',
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'AI review template not found.' })
  async update(
    @Param('id') id: string,
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: UpdateAiReviewTemplateConfigDto,
  ) {
    return this.aiReviewTemplateService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.Admin, UserRole.Copilot)
  @Scopes(Scope.DeleteAiReviewTemplate)
  @ApiOperation({
    summary: 'Delete an AI review template',
    description: 'Roles: Admin, Copilot | Scopes: delete:ai-review-template',
  })
  @ApiParam({
    name: 'id',
    description: 'The ID of the AI review template',
    example: '229c5PnhSKqsSu',
  })
  @ApiResponse({
    status: 200,
    description: 'AI review template deleted successfully.',
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'AI review template not found.' })
  async delete(@Param('id') id: string) {
    await this.aiReviewTemplateService.delete(id);
  }
}
