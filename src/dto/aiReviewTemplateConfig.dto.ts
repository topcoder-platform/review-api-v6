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

const trimTransformer = ({ value }: { value: unknown }): string | undefined =>
  typeof value === 'string' ? value.trim() : undefined;

export enum AiReviewMode {
  AI_GATING = 'AI_GATING',
  AI_ONLY = 'AI_ONLY',
}

export class CreateAiReviewTemplateConfigWorkflowItemDto {
  @ApiProperty({
    description: 'The ID of the AI workflow to include in this template',
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

export class CreateAiReviewTemplateConfigDto {
  @ApiProperty({
    description: 'Challenge track (e.g. DEVELOPMENT, DATA_SCIENCE)',
    example: 'DEVELOPMENT',
  })
  @IsString()
  @Transform(trimTransformer)
  @IsNotEmpty()
  challengeTrack: string;

  @ApiProperty({
    description: 'Challenge type (e.g. Code, Design)',
    example: 'Code',
  })
  @IsString()
  @Transform(trimTransformer)
  @IsNotEmpty()
  challengeType: string;

  @ApiProperty({
    description: 'Template title',
    example: 'Standard Code Review Template',
  })
  @IsString()
  @Transform(trimTransformer)
  @IsNotEmpty()
  title: string;

  @ApiProperty({
    description: 'Template description',
    example: 'Default AI review configuration for code challenges',
  })
  @IsString()
  @Transform(trimTransformer)
  @IsNotEmpty()
  description: string;

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
    description: 'Workflows linked to this template with weights and gating',
    type: [CreateAiReviewTemplateConfigWorkflowItemDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateAiReviewTemplateConfigWorkflowItemDto)
  workflows: CreateAiReviewTemplateConfigWorkflowItemDto[];
}

export class UpdateAiReviewTemplateConfigDto extends OmitType(
  PartialType(CreateAiReviewTemplateConfigDto),
  ['challengeTrack', 'challengeType'],
) {}

export class ListAiReviewTemplateQueryDto {
  @ApiProperty({
    description: 'Filter by challenge track',
    required: false,
    example: 'DEVELOPMENT',
  })
  @IsOptional()
  @IsString()
  @Transform(trimTransformer)
  challengeTrack?: string;

  @ApiProperty({
    description: 'Filter by challenge type',
    required: false,
    example: 'Code',
  })
  @IsOptional()
  @IsString()
  @Transform(trimTransformer)
  challengeType?: string;
}

export class AiReviewTemplateConfigWorkflowResponseDto {
  @ApiProperty({ description: 'Template-workflow link ID' })
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

export class AiReviewTemplateConfigResponseDto {
  @ApiProperty({ description: 'Template ID' })
  id: string;

  @ApiProperty({ description: 'Challenge track' })
  challengeTrack: string;

  @ApiProperty({ description: 'Challenge type' })
  challengeType: string;

  @ApiProperty({ description: 'Version' })
  version: number;

  @ApiProperty({ description: 'Template title' })
  title: string;

  @ApiProperty({ description: 'Template description' })
  description: string;

  @ApiProperty({ description: 'Minimum passing threshold' })
  minPassingThreshold: number;

  @ApiProperty({ description: 'AI review mode', enum: AiReviewMode })
  mode: AiReviewMode;

  @ApiProperty({ description: 'Auto-finalize enabled' })
  autoFinalize: boolean;

  @ApiProperty({ description: 'Formula configuration', required: false })
  formula?: Record<string, unknown>;

  @ApiProperty({ description: 'Created at' })
  createdAt: Date;

  @ApiProperty({ description: 'Updated at' })
  updatedAt: Date;

  @ApiProperty({
    description: 'Workflows with full details',
    type: [AiReviewTemplateConfigWorkflowResponseDto],
  })
  workflows: AiReviewTemplateConfigWorkflowResponseDto[];
}
