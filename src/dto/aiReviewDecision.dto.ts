import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsEnum } from 'class-validator';
import { Transform } from 'class-transformer';

const trimTransformer = ({ value }: { value: unknown }): string | undefined =>
  typeof value === 'string' ? value.trim() : undefined;

export enum AiReviewDecisionStatus {
  PENDING = 'PENDING',
  PASSED = 'PASSED',
  FAILED = 'FAILED',
  ERROR = 'ERROR',
}

export class ListAiReviewDecisionQueryDto {
  @ApiProperty({
    description: 'Filter by submission ID',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Transform(trimTransformer)
  submissionId?: string;

  @ApiProperty({
    description: 'Filter by config ID',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Transform(trimTransformer)
  configId?: string;

  @ApiProperty({
    description: 'Filter by status',
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

  @ApiProperty({ description: 'Config ID' })
  configId: string;

  @ApiProperty({ description: 'Submission ID' })
  submissionId: string;

  @ApiProperty({ description: 'Decision status', enum: AiReviewDecisionStatus })
  status: AiReviewDecisionStatus;

  @ApiProperty({ description: 'Total score', required: false })
  totalScore?: number | null;

  @ApiProperty({ description: 'Whether submission is locked' })
  submissionLocked: boolean;

  @ApiProperty({ description: 'Reason', required: false })
  reason?: string | null;

  @ApiProperty({ description: 'Breakdown (JSON)', required: false })
  breakdown?: Record<string, unknown> | null;

  @ApiProperty({ description: 'Whether decision is final' })
  isFinal: boolean;

  @ApiProperty({ description: 'Finalized at', required: false })
  finalizedAt?: Date | null;

  @ApiProperty({ description: 'Created at' })
  createdAt: Date;

  @ApiProperty({ description: 'Updated at' })
  updatedAt: Date;
}
