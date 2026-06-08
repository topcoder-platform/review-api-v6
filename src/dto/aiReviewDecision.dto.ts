import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsEnum } from 'class-validator';
import { Transform } from 'class-transformer';
import { AiReviewDecisionEscalationResponseDto } from './aiReviewEscalation.dto';

const trimTransformer = ({ value }: { value: unknown }): string | undefined =>
  typeof value === 'string' ? value.trim() : undefined;

export enum AiReviewDecisionStatus {
  PENDING = 'PENDING',
  PASSED = 'PASSED',
  FAILED = 'FAILED',
  ERROR = 'ERROR',
  HUMAN_OVERRIDE = 'HUMAN_OVERRIDE',
}

export class ListAiReviewDecisionQueryDto {
  @ApiProperty({
    description: 'Filter by submission ID',
    required: false,
    example: '229c5PnhSKqsSu',
  })
  @IsOptional()
  @IsString()
  @Transform(trimTransformer)
  submissionId?: string;

  @ApiProperty({
    description: 'Filter by AI review config ID',
    required: false,
    example: '229c5PnhSKqsSu',
  })
  @IsOptional()
  @IsString()
  @Transform(trimTransformer)
  configId?: string;

  @ApiProperty({
    description: 'Filter by decision status',
    required: false,
    enum: AiReviewDecisionStatus,
  })
  @IsOptional()
  @IsEnum(AiReviewDecisionStatus)
  status?: AiReviewDecisionStatus;
}

export class AiReviewDecisionResponseDto {
  @ApiProperty({ description: 'Decision ID' })
  id: string;

  @ApiProperty({ description: 'Submission ID' })
  submissionId: string;

  @ApiProperty({ description: 'AI review config ID' })
  configId: string;

  @ApiProperty({ description: 'Decision status', enum: AiReviewDecisionStatus })
  status: AiReviewDecisionStatus;

  @ApiProperty({
    description: 'Total score',
    required: false,
    nullable: true,
  })
  totalScore: number | null;

  @ApiProperty({ description: 'Whether submission is locked' })
  submissionLocked: boolean;

  @ApiProperty({
    description: 'Reason text',
    required: false,
    nullable: true,
  })
  reason: string | null;

  @ApiProperty({
    description: 'Score breakdown (JSON)',
    required: false,
    nullable: true,
  })
  breakdown: Record<string, unknown> | null;

  @ApiProperty({ description: 'Whether decision is final' })
  isFinal: boolean;

  @ApiProperty({
    description: 'When the decision was finalized',
    required: false,
    nullable: true,
  })
  finalizedAt: Date | null;

  @ApiProperty({ description: 'Created at' })
  createdAt: Date;

  @ApiProperty({ description: 'Updated at' })
  updatedAt: Date;

  @ApiProperty({
    description: 'Related AI review config (minimal)',
    required: false,
  })
  config?: Record<string, unknown>;

  @ApiProperty({
    description: 'Related submission (minimal)',
    required: false,
  })
  submission?: Record<string, unknown>;

  @ApiProperty({
    description: 'Escalation records for this decision',
    required: false,
    type: [AiReviewDecisionEscalationResponseDto],
  })
  escalations?: AiReviewDecisionEscalationResponseDto[];
}
