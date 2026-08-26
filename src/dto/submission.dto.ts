import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsIn,
  IsUrl,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

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

/** Query for the public-safe, phase-gated Design preview gallery. */
export class ReleasedSubmissionPreviewQueryDto {
  @ApiProperty({ description: 'Owning v6 challenge UUID' })
  @IsUUID()
  challengeId: string;

  @ApiProperty({ description: 'One-based page', default: 1, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiProperty({
    description: 'Preview cards per page',
    default: 20,
    maximum: 100,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  perPage = 20;
}

/** A released Design submission preview safe for gallery display. */
export class ReleasedSubmissionPreviewDto {
  @ApiProperty({ description: 'Submission identifier' })
  id: string;

  @ApiProperty({ description: 'Contest or checkpoint submission type' })
  type: string;

  @ApiProperty({ description: 'Submission timestamp', nullable: true })
  submittedDate: Date | null;

  @ApiProperty({ description: 'Public immutable preview asset URL' })
  previewUrl: string;

  @ApiProperty({
    description: 'Public submitter handle when member lookup succeeds',
    required: false,
  })
  submitterHandle?: string;
}

/** Pagination metadata for the released preview gallery. */
export class ReleasedSubmissionPreviewMetadataDto {
  @ApiProperty({ description: 'One-based current page' })
  page: number;

  @ApiProperty({ description: 'Preview cards requested per page' })
  perPage: number;

  @ApiProperty({ description: 'Total released preview cards' })
  totalCount: number;

  @ApiProperty({ description: 'Total released preview pages' })
  totalPages: number;
}

/** Exact response envelope for the released preview gallery. */
export class ReleasedSubmissionPreviewPageDto {
  @ApiProperty({ type: [ReleasedSubmissionPreviewDto] })
  data: ReleasedSubmissionPreviewDto[];

  @ApiProperty({ type: ReleasedSubmissionPreviewMetadataDto })
  meta: ReleasedSubmissionPreviewMetadataDto;
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

  @ApiProperty({
    name: 'isLatest',
    description:
      'When true, only the latest submission per challenge/member pair is returned. When false, latest submissions are excluded.',
    required: false,
  })
  @IsOptional()
  @IsIn(['true', 'false', '1', '0', 'TRUE', 'FALSE'])
  isLatest?: string;
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

export class ManualSubmissionUploadRequestDto {
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
    description:
      'Optional submitter handle. When provided, it must match a submitter resource on the challenge and the supplied member id.',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  memberHandle?: string;

  @ApiProperty({
    description:
      'Optional file name override used when storing the uploaded file in DMZ',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  fileName?: string;

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
    example: '2024-10-01T00:00:00Z',
    required: false,
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
    description:
      'Indicates whether this submission was created from a file upload, or is a URL (for Wipro)',
    required: false,
  })
  isFileSubmission?: boolean;

  @ApiProperty({
    description:
      'Lowercase hex SHA-256 digest (64 characters) of the submission file contents. Computed from the uploaded buffer, or by reading back the S3 object when the front end uploaded the file directly. Null for non-file submissions and when the digest could not be computed.',
    example: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    required: false,
    nullable: true,
    type: String,
  })
  sha256Hash?: string | null;

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
    description:
      'Submitter email (visible to Admin, M2M, or challenge Copilot/Manager resources)',
    required: false,
    nullable: true,
  })
  submitterEmail?: string | null;

  @ApiProperty({
    description: 'Submitter maximum rating (visible to Admin/Copilot/M2M)',
    required: false,
    nullable: true,
    type: Number,
  })
  submitterMaxRating?: number | null;

  @ApiProperty({
    description:
      'Indicates whether this is the most recent submission for the member on this challenge',
    example: true,
    required: false,
  })
  isLatest?: boolean;

  @ApiProperty({
    description:
      'Total number of submissions for this member matching the same challenge submission filters',
    example: 3,
    required: false,
  })
  submissionCount?: number;
}
