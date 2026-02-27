import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsObject,
  IsEnum,
  IsOptional,
  ValidateBy,
  ValidationOptions,
} from 'class-validator';
import { Transform } from 'class-transformer';

const trimTransformer = ({ value }: { value: unknown }): string | undefined =>
  typeof value === 'string' ? value.trim() : undefined;

function isNonEmptyObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0
  );
}

function IsNonEmptyObject(validationOptions?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isNonEmptyObject',
      validator: {
        validate(value: unknown) {
          return isNonEmptyObject(value);
        },
        defaultMessage() {
          return 'context must be a non-empty object';
        },
      },
    },
    validationOptions,
  );
}

export enum ChallengeReviewContextStatus {
  AI_GENERATED = 'AI_GENERATED',
  HUMAN_APPROVED = 'HUMAN_APPROVED',
  HUMAN_REJECTED = 'HUMAN_REJECTED',
}

export class CreateChallengeReviewContextDto {
  @ApiProperty({
    description: 'Challenge ID this review context applies to',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsString()
  @Transform(trimTransformer)
  @IsNotEmpty()
  challengeId: string;

  @ApiProperty({
    description: 'Review context payload (must be a non-empty JSON object)',
    example: { summary: 'Challenge overview', criteria: ['C1', 'C2'] },
  })
  @IsObject()
  @IsNonEmptyObject()
  context: Record<string, unknown>;

  @ApiProperty({
    description: 'Status of the review context',
    enum: ChallengeReviewContextStatus,
  })
  @IsEnum(ChallengeReviewContextStatus)
  status: ChallengeReviewContextStatus;
}

export class UpdateChallengeReviewContextDto {
  @ApiProperty({
    description: 'Review context payload (must be a non-empty JSON object)',
    example: { summary: 'Updated overview', criteria: ['C1', 'C2', 'C3'] },
  })
  @IsObject()
  @IsNonEmptyObject()
  context: Record<string, unknown>;

  @ApiProperty({
    description: 'Status of the review context',
    enum: ChallengeReviewContextStatus,
    required: false,
  })
  @IsOptional()
  @IsEnum(ChallengeReviewContextStatus)
  status?: ChallengeReviewContextStatus;
}

export class ChallengeReviewContextResponseDto {
  @ApiProperty({ description: 'Unique ID of the challenge review context' })
  id: string;

  @ApiProperty({ description: 'Challenge ID' })
  challengeId: string;

  @ApiProperty({
    description: 'Review context payload',
    type: 'object',
    additionalProperties: true,
  })
  context: Record<string, unknown>;

  @ApiProperty({
    description: 'Status of the review context',
    enum: ChallengeReviewContextStatus,
  })
  status: ChallengeReviewContextStatus;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({
    description: 'User ID that created the record',
    nullable: true,
  })
  createdBy: string | null;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt: Date;

  @ApiProperty({
    description: 'User ID that last updated the record',
    nullable: true,
  })
  updatedBy: string | null;
}
