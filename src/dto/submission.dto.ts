import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
} from 'class-validator';

import { ReviewResponseDto } from './review.dto';

export class SubmissionQueryDto {
  @ApiProperty({
    name: 'type',
    description: 'The submission type to filter by',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  type?: string;

  @ApiProperty({
    name: 'url',
    description: 'The submission file url to filter by',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  url?: string;

  @ApiProperty({
    name: 'challengeId',
    description: 'The challenge id to filter by',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  challengeId?: string;

  @ApiProperty({
    name: 'legacySubmissionId',
    description: 'The legacy submission id to filter by',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  legacySubmissionId?: string;

  @ApiProperty({
    name: 'legacyUploadId',
    description: 'The legacy upload id to filter by',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  legacyUploadId?: string;

  @ApiProperty({
    name: 'submissionPhaseId',
    description: 'The submission phase id to filter by',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  submissionPhaseId?: string;
}

export class SubmissionRequestBaseDto {
  @ApiProperty({
    description: 'The submission type',
    example: 'ContestSubmission',
  })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiProperty({
    description: 'The submission url',
  })
  @IsString()
  @IsNotEmpty()
  url: string;

  @ApiProperty({
    description: 'The member id',
  })
  @IsString()
  @IsNotEmpty()
  memberId: string;

  @ApiProperty({
    description: 'The challenge id',
  })
  @IsString()
  @IsNotEmpty()
  challengeId: string;

  @ApiProperty({
    description: 'The legacy submission id',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  legacySubmissionId?: string;

  @ApiProperty({
    description: 'The legacy upload id',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  legacyUploadId?: string;

  @ApiProperty({
    description: 'The submission phase id',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  submissionPhaseId?: string;

  @ApiProperty({
    description: 'The submitted date',
    example: '2024-10-01T00:00:00Z',
  })
  @IsDateString()
  submittedDate: string;
}

export class SubmissionRequestDto extends SubmissionRequestBaseDto {
  @ApiProperty({
    description: 'The user who created the submission',
    example: 'user123',
  })
  @IsString()
  @IsNotEmpty()
  createdBy: string;

  @ApiProperty({
    description: 'The user who last updated the submission',
    example: 'user456',
  })
  @IsString()
  @IsNotEmpty()
  updatedBy: string;
}

export class SubmissionPutRequestDto extends SubmissionRequestBaseDto {
  @ApiProperty({
    description: 'The user who last updated the submission',
    example: 'user456',
  })
  @IsString()
  @IsNotEmpty()
  updatedBy: string;
}

export class SubmissionUpdateRequestDto {
  @ApiProperty({
    description: 'The submission type',
    example: 'ContestSubmission',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  type?: string;

  @ApiProperty({
    description: 'The submission url',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  url?: string;

  @ApiProperty({
    description: 'The member id',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  memberId?: string;

  @ApiProperty({
    description: 'The challenge id',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  challengeId?: string;

  @ApiProperty({
    description: 'The legacy submission id',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  legacySubmissionId?: string;

  @ApiProperty({
    description: 'The legacy upload id',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  legacyUploadId?: string;

  @ApiProperty({
    description: 'The submission phase id',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  submissionPhaseId?: string;

  @ApiProperty({
    description: 'The submitted date',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  submittedDate?: string;

  @ApiProperty({
    description: 'The user who last updated the submission',
    example: 'user456',
  })
  @IsString()
  @IsNotEmpty()
  updatedBy: string;
}

export class SubmissionResponseDto {
  @ApiProperty({
    description: 'The ID of the submission',
    example: 'c56a4180-65aa-42ec-a945-5fd21dec0501',
  })
  id: string;

  @ApiProperty({
    description: 'The submission type',
    example: 'ContestSubmission',
  })
  type: string;

  @ApiProperty({
    description: 'The submission url',
  })
  url: string;

  @ApiProperty({
    description: 'The member id',
  })
  memberId: string;

  @ApiProperty({
    description: 'The challenge id',
  })
  challengeId: string;

  @ApiProperty({
    description: 'The legacy submission id',
  })
  legacySubmissionId?: string;

  @ApiProperty({
    description: 'The legacy upload id',
  })
  legacyUploadId?: string;

  @ApiProperty({
    description: 'The submission phase id',
  })
  submissionPhaseId?: string;

  @ApiProperty({
    description: 'The submitted date',
  })
  submittedDate: Date;

  @ApiProperty({
    description: 'The creation timestamp',
    example: '2023-10-01T00:00:00Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'The user who created the submission',
    example: 'user123',
  })
  createdBy: string;

  @ApiProperty({
    description: 'The last update timestamp',
    example: '2023-10-01T00:00:00Z',
  })
  updatedAt: Date;

  @ApiProperty({
    description: 'The user who last updated the submission',
    example: 'user456',
  })
  updatedBy: string;

  review?: ReviewResponseDto[];
  reviewSummation?: any[];
}
