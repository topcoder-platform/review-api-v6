import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsIn,
  IsUrl,
} from 'class-validator';

import { ReviewResponseDto } from './review.dto';

export enum SubmissionType {
  CONTEST_SUBMISSION = 'CONTEST_SUBMISSION',
  SPECIFICATION_SUBMISSION = 'SPECIFICATION_SUBMISSION',
  CHECKPOINT_SUBMISSION = 'CHECKPOINT_SUBMISSION',
  STUDIO_FINAL_FIX_SUBMISSION = 'STUDIO_FINAL_FIX_SUBMISSION',
}

export enum SubmissionStatus {
  ACTIVE = 'ACTIVE',
  FAILED_SCREENING = 'FAILED_SCREENING',
  FAILED_REVIEW = 'FAILED_REVIEW',
  COMPLETED_WITHOUT_WIN = 'COMPLETED_WITHOUT_WIN',
  DELETED = 'DELETED',
  FAILED_CHECKPOINT_SCREENING = 'FAILED_CHECKPOINT_SCREENING',
  FAILED_CHECKPOINT_REVIEW = 'FAILED_CHECKPOINT_REVIEW',
}

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
    name: 'memberId',
    description: 'The member id to filter by',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  memberId?: string;

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
    enum: Object.values(SubmissionType),
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(Object.values(SubmissionType))
  type: string;

  @ApiProperty({
    description: 'The submission url',
    required: true,
  })
  @IsUrl()
  @IsNotEmpty()
  url: string;

  @ApiProperty({
    description: 'The member id',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  memberId: string;

  @ApiProperty({
    description: 'The challenge id',
    required: true,
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
  @IsOptional()
  @IsDateString()
  submittedDate?: string;
}

export class SubmissionRequestDto extends SubmissionRequestBaseDto {}

export class SubmissionPutRequestDto extends SubmissionRequestBaseDto {}

export class SubmissionUpdateRequestDto {
  @ApiProperty({
    description: 'The submission type',
    example: 'ContestSubmission',
    enum: Object.values(SubmissionType),
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @IsIn(Object.values(SubmissionType))
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
}

export class SubmissionResponseDto {
  @ApiProperty({
    description: 'The ID of the submission',
    example: 'CbgrlhpRMzh6j-',
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
  url: string | null;

  @ApiProperty({
    description: 'The member id',
  })
  memberId: string | null;

  @ApiProperty({
    description: 'The challenge id',
  })
  challengeId: string | null;

  @ApiProperty({
    description: 'The legacy submission id',
  })
  legacySubmissionId?: string | null;

  @ApiProperty({
    description: 'The legacy upload id',
  })
  legacyUploadId?: string | null;

  @ApiProperty({
    description: 'The submission phase id',
  })
  submissionPhaseId?: string | null;

  @ApiProperty({
    description: 'The submitted date',
  })
  submittedDate: Date | null;

  @ApiProperty({
    description: 'Legacy challenge id',
  })
  legacyChallengeId?: number | null;

  @ApiProperty({
    description: 'prize id',
  })
  prizeId?: number | null;

  @ApiProperty({
    description: 'Virus scan status (true when scan passed)',
    example: false,
  })
  virusScan?: boolean;

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
  updatedAt: Date | null;

  @ApiProperty({
    description: 'The user who last updated the submission',
    example: 'user456',
  })
  updatedBy: string | null;

  review?: ReviewResponseDto[];
  reviewSummation?: any[];

  @ApiProperty({
    description: 'Submitter member handle (visible to Admin/Copilot/M2M)',
    required: false,
  })
  submitterHandle?: string;

  @ApiProperty({
    description: 'Submitter maximum rating (visible to Admin/Copilot/M2M)',
    required: false,
    nullable: true,
    type: Number,
  })
  submitterMaxRating?: number | null;
}
