import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsNumberString,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsBooleanString,
  IsDateString,
} from 'class-validator';

export class ReviewSummationQueryDto {
  @ApiProperty({
    description: 'The submission id',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  submissionId?: string;

  @ApiProperty({
    description: 'The aggregate score',
    required: false,
  })
  @IsOptional()
  @IsNumberString()
  aggregateScore?: string;

  @ApiProperty({
    description: 'The scorecard id',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  scorecardId?: string;

  @ApiProperty({
    description: 'The isPassing flag for review summation',
    required: false,
  })
  @IsOptional()
  @IsBooleanString()
  isPassing?: string;

  @ApiProperty({
    description: 'The isFinal flag for review summation',
    required: false,
  })
  @IsOptional()
  @IsBooleanString()
  isFinal?: string;

  @ApiProperty({
    description: 'The isProvisional flag for review summation (MMs)',
    required: false,
  })
  @IsOptional()
  @IsBooleanString()
  isProvisional?: string;

  @ApiProperty({
    description: 'The isExample flag for review summation (MMs)',
    required: false,
  })
  @IsOptional()
  @IsBooleanString()
  isExample?: string;

  @ApiProperty({
    description: 'The challenge id tied to the submission',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  challengeId?: string;

  @ApiProperty({
    description:
      'When true, include the metadata payload for each review summation in responses',
    required: false,
  })
  @IsOptional()
  @IsBooleanString()
  metadata?: string;
}

export class ReviewSummationBaseRequestDto {
  @ApiProperty({
    description: 'The submission id',
    example: 'd24d4180-65aa-42ec-a945-5fd21dec0501',
  })
  @IsString()
  @IsNotEmpty()
  submissionId: string;

  @ApiProperty({
    description: 'The aggregate score',
    example: 97.8,
  })
  @IsNumber()
  aggregateScore: number;

  @ApiProperty({
    description: 'The scorecard id',
    example: 'd24d4180-65aa-42ec-a945-5fd21dec0501',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  scorecardId?: string;

  @ApiProperty({
    description: 'The isPassing flag for review summation',
  })
  @IsBoolean()
  isPassing: boolean;

  @ApiProperty({
    description: 'The isFinal flag for review summation',
  })
  @IsOptional()
  @IsBoolean()
  isFinal?: boolean;

  @ApiProperty({
    description: 'The isProvisional flag for review summation',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isProvisional?: boolean | null;

  @ApiProperty({
    description: 'The isExample flag for review summation',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isExample?: boolean | null;

  @ApiProperty({
    description: 'The reviewed date',
    example: '2024-10-01T00:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  reviewedDate?: string;

  @ApiProperty({
    description:
      'Auxiliary metadata for the review summation (test scores, etc.)',
    required: false,
    type: Object,
    additionalProperties: true,
  })
  @IsOptional()
  metadata?: unknown;
}

export class ReviewSummationRequestDto extends ReviewSummationBaseRequestDto {}

export class ReviewSummationPutRequestDto extends ReviewSummationBaseRequestDto {}

export class ReviewSummationUpdateRequestDto {
  @ApiProperty({
    description: 'The submission id',
    example: 'd24d4180-65aa-42ec-a945-5fd21dec0501',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  submissionId?: string;

  @ApiProperty({
    description: 'The aggregate score',
    example: 97.8,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  aggregateScore?: number;

  @ApiProperty({
    description: 'The scorecard id',
    example: 'd24d4180-65aa-42ec-a945-5fd21dec0501',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  scorecardId?: string;

  @ApiProperty({
    description: 'The isPassing flag for review summation',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isPassing?: boolean;

  @ApiProperty({
    description: 'The isFinal flag for review summation',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isFinal?: boolean;

  @ApiProperty({
    description: 'The isProvisional flag for review summation',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isProvisional?: boolean | null;

  @ApiProperty({
    description: 'The isExample flag for review summation',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isExample?: boolean | null;

  @ApiProperty({
    description: 'The reviewed date',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  reviewedDate?: string;

  @ApiProperty({
    description:
      'Auxiliary metadata for the review summation (test scores, etc.)',
    required: false,
    type: Object,
    additionalProperties: true,
  })
  @IsOptional()
  metadata?: unknown;
}

export class ReviewSummationResponseDto {
  @ApiProperty({
    description: 'The ID of the review summation',
    example: 'c56a4180-65aa-42ec-a945-5fd21dec0501',
  })
  id: string;

  @ApiProperty({
    description: 'The submission id',
    example: 'id123',
  })
  submissionId: string;

  @ApiProperty({
    description: 'The aggregate score',
    example: 97.8,
  })
  aggregateScore: number;

  @ApiProperty({
    description: 'The scorecard id',
    example: 'd24d4180-65aa-42ec-a945-5fd21dec0501',
  })
  scorecardId: string | null;

  @ApiProperty({
    description: 'The isPassing flag for review summation',
  })
  isPassing: boolean;

  @ApiProperty({
    description: 'The isFinal flag for review summation',
  })
  isFinal: boolean | null;

  @ApiProperty({
    description: 'The isProvisional flag for review summation',
    required: false,
  })
  isProvisional: boolean | null;

  @ApiProperty({
    description: 'The isExample flag for review summation',
    required: false,
  })
  isExample: boolean | null;

  @ApiProperty({
    description: 'The reviewed date',
    example: '2024-10-01T00:00:00Z',
  })
  reviewedDate: Date | null;

  @ApiProperty({
    description: 'The creation timestamp',
    example: '2023-10-01T00:00:00Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'The user who created the review summation',
    example: 'user123',
  })
  createdBy: string | null;

  @ApiProperty({
    description: 'The last update timestamp',
    example: '2023-10-01T00:00:00Z',
  })
  updatedAt: Date | null;

  @ApiProperty({
    description: 'The user who last updated the review summation',
    example: 'user456',
  })
  updatedBy: string | null;

  @ApiProperty({
    description:
      'Numeric member ID of the submitter associated with this review summation',
    example: 305643,
    required: false,
    nullable: true,
    type: Number,
  })
  submitterId?: number | null;

  @ApiProperty({
    description:
      'Handle of the submitter associated with this review summation',
    example: 'submitter123',
    required: false,
    nullable: true,
  })
  submitterHandle?: string | null;

  @ApiProperty({
    description: 'Maximum rating of the submitter sourced from member profile',
    example: 2450,
    required: false,
    nullable: true,
    type: Number,
  })
  submitterMaxRating?: number | null;

  @ApiProperty({
    description:
      'Auxiliary metadata for the review summation (test scores, etc.)',
    required: false,
    nullable: true,
    type: Object,
    additionalProperties: true,
  })
  metadata?: Record<string, unknown> | null;
}

export class ReviewSummationBatchResponseDto {
  @ApiProperty({
    description: 'Challenge identifier that was processed',
    example: '3b0149a5-ff1c-4fd2-b861-1234567890ab',
  })
  challengeId: string;

  @ApiProperty({
    description: 'Stage of aggregation that was executed',
    enum: ['INITIAL', 'FINAL'],
    example: 'INITIAL',
  })
  stage: 'INITIAL' | 'FINAL';

  @ApiProperty({
    description: 'Total submissions considered for aggregation',
    example: 5,
  })
  processedSubmissions: number;

  @ApiProperty({
    description: 'Number of review summations created during this run',
    example: 3,
  })
  createdCount: number;

  @ApiProperty({
    description: 'Number of existing review summations that were updated',
    example: 2,
  })
  updatedCount: number;

  @ApiProperty({
    description: 'Submissions skipped due to insufficient data',
    example: 1,
  })
  skippedCount: number;
}
