import { ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsArray,
  ValidateNested,
  IsOptional,
  Min,
  Max,
  IsBoolean,
  IsEnum,
  IsObject,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { AiReviewMode } from './aiReviewTemplateConfig.dto';

const trimTransformer = ({ value }: { value: unknown }): string | undefined =>
  typeof value === 'string' ? value.trim() : undefined;

export class CreateAiReviewConfigWorkflowItemDto {
  @ApiProperty({
    description: 'The ID of the AI workflow to include in this config',
    example: '229c5PnhSKqsSu',
  })
  @IsString()
  @IsNotEmpty()
  workflowId: string;

  @ApiProperty({
    description: 'Weight percentage for this workflow (0-100)',
    example: 50,
    minimum: 0,
    maximum: 100,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  weightPercent: number;

  @ApiProperty({
    description: 'Whether this workflow is gating',
    example: false,
  })
  @IsBoolean()
  isGating: boolean;
}

export class CreateAiReviewConfigDto {
  @ApiProperty({
    description: 'Challenge ID this config applies to',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsString()
  @Transform(trimTransformer)
  @IsNotEmpty()
  challengeId: string;

  @ApiProperty({
    description: 'Minimum passing threshold (0-100)',
    example: 70,
    minimum: 0,
    maximum: 100,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  minPassingThreshold: number;

  @ApiProperty({
    description: 'AI review mode',
    enum: AiReviewMode,
    default: AiReviewMode.AI_GATING,
  })
  @IsEnum(AiReviewMode)
  mode: AiReviewMode;

  @ApiProperty({
    description: 'Whether to auto-finalize AI review decisions',
    example: false,
  })
  @IsBoolean()
  autoFinalize: boolean;

  @ApiProperty({
    description: 'Optional formula configuration (JSON object)',
    required: false,
  })
  @IsOptional()
  @IsObject()
  formula?: Record<string, unknown>;

  @ApiProperty({
    description: 'Optional template ID to clone config from',
    required: false,
    example: '229c5PnhSKqsSu',
  })
  @IsOptional()
  @IsString()
  @Transform(trimTransformer)
  templateId?: string;

  @ApiProperty({
    description: 'Workflows linked to this config with weights and gating',
    type: [CreateAiReviewConfigWorkflowItemDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateAiReviewConfigWorkflowItemDto)
  workflows: CreateAiReviewConfigWorkflowItemDto[];
}

export class UpdateAiReviewConfigDto extends OmitType(
  PartialType(CreateAiReviewConfigDto),
  ['challengeId', 'templateId'],
) {}

export class ListAiReviewConfigQueryDto {
  @ApiProperty({
    description: 'Filter by challenge ID',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Transform(trimTransformer)
  challengeId?: string;

  @ApiProperty({
    description: 'Filter by mode',
    required: false,
    enum: AiReviewMode,
  })
  @IsOptional()
  @IsEnum(AiReviewMode)
  mode?: AiReviewMode;
}

export class AiReviewConfigWorkflowResponseDto {
  @ApiProperty({ description: 'Config-workflow link ID' })
  id: string;

  @ApiProperty({ description: 'Workflow ID' })
  workflowId: string;

  @ApiProperty({ description: 'Weight percentage' })
  weightPercent: number;

  @ApiProperty({ description: 'Whether the workflow is gating' })
  isGating: boolean;

  @ApiProperty({ description: 'Full workflow details' })
  workflow: Record<string, unknown>;
}

export class AiReviewConfigResponseDto {
  @ApiProperty({ description: 'Config ID' })
  id: string;

  @ApiProperty({ description: 'Challenge ID' })
  challengeId: string;

  @ApiProperty({ description: 'Version' })
  version: number;

  @ApiProperty({ description: 'Minimum passing threshold' })
  minPassingThreshold: number;

  @ApiProperty({ description: 'AI review mode', enum: AiReviewMode })
  mode: AiReviewMode;

  @ApiProperty({ description: 'Auto-finalize enabled' })
  autoFinalize: boolean;

  @ApiProperty({ description: 'Formula configuration', required: false })
  formula?: Record<string, unknown>;

  @ApiProperty({ description: 'Template ID if cloned from template', required: false })
  templateId?: string | null;

  @ApiProperty({ description: 'Created at' })
  createdAt: Date;

  @ApiProperty({ description: 'Updated at' })
  updatedAt: Date;

  @ApiProperty({
    description: 'Workflows with full details',
    type: [AiReviewConfigWorkflowResponseDto],
  })
  workflows: AiReviewConfigWorkflowResponseDto[];

  @ApiProperty({
    description: 'AI review decisions for this config',
    type: 'array',
    items: { type: 'object' },
  })
  decisions: Record<string, unknown>[];
}
