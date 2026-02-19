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
import { AiReviewConfigService } from './ai-review-config.service';
import {
  CreateAiReviewConfigDto,
  UpdateAiReviewConfigDto,
  ListAiReviewConfigQueryDto,
  AiReviewConfigResponseDto,
} from '../../dto/aiReviewConfig.dto';
import { Scopes } from 'src/shared/decorators/scopes.decorator';
import { UserRole } from 'src/shared/enums/userRole.enum';
import { Scope } from 'src/shared/enums/scopes.enum';
import { Roles } from 'src/shared/guards/tokenRoles.guard';

@ApiTags('AI Review Configs')
@ApiBearerAuth()
@Controller('ai-review/configs')
export class AiReviewConfigController {
  constructor(
    private readonly aiReviewConfigService: AiReviewConfigService,
  ) {}

  @Post()
  @Roles(UserRole.Admin, UserRole.Copilot)
  @Scopes(Scope.CreateAiReviewConfig)
  @ApiOperation({
    summary: 'Create an AI review config',
    description:
      'Roles: Admin, Copilot | Scopes: create:ai-review-config. Blocked if challenge has any submissions.',
  })
  @ApiBody({
    description: 'AI review config for a challenge',
    type: CreateAiReviewConfigDto,
  })
  @ApiResponse({
    status: 201,
    description: 'The AI review config has been successfully created.',
    type: AiReviewConfigResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request (e.g. workflow not found, weights do not sum to 100).',
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({
    status: 404,
    description: 'Challenge or template not found.',
  })
  @ApiResponse({
    status: 409,
    description:
      'Conflict. Challenge already has submissions.',
  })
  async create(
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: CreateAiReviewConfigDto,
  ) {
    return this.aiReviewConfigService.create(dto);
  }

  @Get()
  @Roles(UserRole.Admin, UserRole.Copilot)
  @Scopes(Scope.ReadAiReviewConfig)
  @ApiOperation({
    summary: 'List AI review configs',
    description: 'Roles: Admin, Copilot | Scopes: read:ai-review-config',
  })
  @ApiQuery({
    name: 'challengeId',
    description: 'Filter by challenge ID',
    required: false,
    type: String,
  })
  @ApiQuery({
    name: 'mode',
    description: 'Filter by mode',
    required: false,
    enum: ['AI_GATING', 'AI_ONLY'],
  })
  @ApiResponse({
    status: 200,
    description: 'List of AI review configs.',
    type: [AiReviewConfigResponseDto],
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async list(
    @Query(new ValidationPipe({ whitelist: true, transform: true }))
    query: ListAiReviewConfigQueryDto,
  ) {
    return this.aiReviewConfigService.list(query);
  }

  @Get(':challengeId')
  @Roles(
    UserRole.Admin,
    UserRole.Copilot,
    UserRole.Submitter,
    UserRole.Reviewer,
    UserRole.ProjectManager,
    UserRole.User,
  )
  @Scopes(Scope.ReadAiReviewConfig)
  @ApiOperation({
    summary: 'Get AI review config by challenge ID',
    description:
      'Returns the latest version. Roles: Admin, Copilot, Submitter, Reviewer, Manager, User | Scopes: read:ai-review-config',
  })
  @ApiParam({
    name: 'challengeId',
    description: 'The challenge ID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiResponse({
    status: 200,
    description: 'The AI review config (latest version).',
    type: AiReviewConfigResponseDto,
  })
  @ApiResponse({ status: 404, description: 'AI review config not found.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async getByChallengeId(@Param('challengeId') challengeId: string) {
    return this.aiReviewConfigService.getByChallengeId(challengeId);
  }

  @Put(':id')
  @Roles(UserRole.Admin, UserRole.Copilot)
  @Scopes(Scope.UpdateAiReviewConfig)
  @ApiOperation({
    summary: 'Update an AI review config',
    description:
      'Roles: Admin, Copilot | Scopes: update:ai-review-config. Blocked if challenge is completed or config has decisions. challengeId cannot be updated.',
  })
  @ApiParam({
    name: 'id',
    description: 'The ID of the AI review config',
    example: '229c5PnhSKqsSu',
  })
  @ApiBody({
    description: 'Partial AI review config data',
    type: UpdateAiReviewConfigDto,
  })
  @ApiResponse({
    status: 200,
    description: 'AI review config updated successfully.',
    type: AiReviewConfigResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request (e.g. workflow not found, weights do not sum to 100).',
  })
  @ApiResponse({ status: 403, description: 'Forbidden (e.g. challenge completed).' })
  @ApiResponse({ status: 404, description: 'AI review config not found.' })
  @ApiResponse({
    status: 409,
    description: 'Conflict. Config has decisions.',
  })
  async update(
    @Param('id') id: string,
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: UpdateAiReviewConfigDto,
  ) {
    return this.aiReviewConfigService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.Admin, UserRole.Copilot)
  @Scopes(Scope.DeleteAiReviewConfig)
  @ApiOperation({
    summary: 'Delete an AI review config',
    description:
      'Roles: Admin, Copilot | Scopes: delete:ai-review-config. Blocked if challenge is completed or config has decisions.',
  })
  @ApiParam({
    name: 'id',
    description: 'The ID of the AI review config',
    example: '229c5PnhSKqsSu',
  })
  @ApiResponse({
    status: 200,
    description: 'AI review config deleted successfully.',
  })
  @ApiResponse({ status: 403, description: 'Forbidden (e.g. challenge completed).' })
  @ApiResponse({ status: 404, description: 'AI review config not found.' })
  @ApiResponse({
    status: 409,
    description: 'Conflict. Config has decisions.',
  })
  async delete(@Param('id') id: string) {
    await this.aiReviewConfigService.delete(id);
  }
}
