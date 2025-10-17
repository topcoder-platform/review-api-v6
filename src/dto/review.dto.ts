import { ApiHideProperty, ApiProperty, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsString,
  IsNumber,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsObject,
  IsArray,
  ValidateNested,
  IsEnum,
  IsInt,
  IsEmpty,
} from 'class-validator';
import { AppealResponseDto } from 'src/dto/appeal.dto';

export enum ReviewItemCommentType {
  COMMENT = 'COMMENT',
  REQUIRED = 'REQUIRED',
  RECOMMENDED = 'RECOMMENDED',
  AGGREGATION_COMMENT = 'AGGREGATION_COMMENT',
  AGGREGATION_REVIEW_COMMENT = 'AGGREGATION_REVIEW_COMMENT',
  SUBMITTER_COMMENT = 'SUBMITTER_COMMENT',
  FINAL_FIX_COMMENT = 'FINAL_FIX_COMMENT',
  FINAL_REVIEW_COMMENT = 'FINAL_REVIEW_COMMENT',
  MANAGER_COMMENT = 'MANAGER_COMMENT',
  APPROVAL_REVIEW_COMMENT = 'APPROVAL_REVIEW_COMMENT',
  APPROVAL_REVIEW_COMMENT_OTHER_FIXES = 'APPROVAL_REVIEW_COMMENT_OTHER_FIXES',
  SPECIFICATION_REVIEW_COMMENT = 'SPECIFICATION_REVIEW_COMMENT',
}

export enum ReviewStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export class ReviewItemCommentBaseDto {
  @ApiProperty({
    description: 'Content of the comment',
    example: 'This needs more explanation',
  })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiProperty({
    description: 'Type of the comment',
    enum: ReviewItemCommentType,
    example: ReviewItemCommentType.COMMENT,
  })
  @IsEnum(ReviewItemCommentType)
  type: ReviewItemCommentType;

  @ApiProperty({
    description: 'Sort order of the comment. Defaults to 0',
    example: 1,
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  sortOrder: number;
}

export class ReviewItemCommentRequestDto extends ReviewItemCommentBaseDto {}

export class ReviewItemCommentResponseDto extends ReviewItemCommentBaseDto {
  @ApiProperty({
    description: 'The ID of the review item comment',
    example: '123',
  })
  id: string;

  @ApiProperty({
    description: 'Appeal linked to this comment, if one exists',
    type: () => AppealResponseDto,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @Type(() => AppealResponseDto)
  appeal?: AppealResponseDto | null;

  @ApiProperty({
    description: 'The creation timestamp',
    example: '2023-10-01T00:00:00Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'The user who created the review',
    example: 'user123',
  })
  createdBy: string;

  @ApiProperty({
    description: 'The last update timestamp',
    example: '2023-10-01T00:00:00Z',
  })
  updatedAt: Date;

  @ApiProperty({
    description: 'The user who last updated the review',
    example: 'user456',
  })
  updatedBy: string;
}

export class ReviewItemBaseDto {
  @ApiProperty({ description: 'Scorecard question ID', example: 'question123' })
  @IsString()
  @IsNotEmpty()
  scorecardQuestionId: string;

  @ApiProperty({
    description: 'Initial answer for the review item',
    example: 'Yes',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  initialAnswer: string;

  @ApiProperty({
    description: 'Final answer after review updates',
    example: 'No',
    required: false,
  })
  @IsOptional()
  @IsString()
  finalAnswer?: string;

  @ApiProperty({
    description: 'Manager comment',
    example: 'This is a required change',
    required: false,
  })
  @IsOptional()
  @IsString()
  managerComment?: string;
}

export class ReviewItemRequestDto extends ReviewItemBaseDto {
  @ApiProperty({
    description:
      'Parent review ID to attach this item to (required for standalone create)',
    example: 'review123',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  reviewId?: string;

  @ApiProperty({
    description: 'List of comments on this review item',
    type: [ReviewItemCommentRequestDto],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReviewItemCommentRequestDto)
  reviewItemComments?: ReviewItemCommentRequestDto[];
}

export class ReviewItemResponseDto extends ReviewItemBaseDto {
  @ApiProperty({ description: 'The ID of the review item', example: '123' })
  id: string;

  @ApiProperty({
    description: 'List of comments on this review item',
    type: [ReviewItemCommentResponseDto],
    required: false,
  })
  reviewItemComments?: ReviewItemCommentResponseDto[];

  @ApiProperty({
    description: 'The creation timestamp',
    example: '2023-10-01T00:00:00Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'The user who created the review',
    example: 'user123',
  })
  createdBy: string;

  @ApiProperty({
    description: 'The last update timestamp',
    example: '2023-10-01T00:00:00Z',
  })
  updatedAt: Date;

  @ApiProperty({
    description: 'The user who last updated the review',
    example: 'user456',
  })
  updatedBy: string;
}

// Common fields shared across Review request/response
export class ReviewCommonDto {
  @ApiProperty({
    description: 'Resource ID associated with the review',
    example: 'resource123',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  resourceId?: string;

  @ApiProperty({
    description: 'Submission ID being reviewed',
    example: 'submission789',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  submissionId?: string;

  @ApiProperty({
    description: 'Scorecard ID used for the review',
    example: 'scorecard101',
  })
  @IsString()
  @IsNotEmpty()
  scorecardId: string;

  @ApiProperty({
    description: 'Type ID used for the review',
    example: 'type101',
  })
  @IsString()
  @IsNotEmpty()
  typeId: string;

  @ApiProperty({
    description: 'The metadata for the review',
  })
  @IsOptional()
  @IsObject()
  metadata?: object;

  @ApiProperty({
    description: 'Status for the review',
    enum: ReviewStatus,
    example: ReviewStatus.PENDING,
  })
  @IsString()
  @IsNotEmpty()
  status: ReviewStatus;

  @ApiProperty({
    description: 'Review date for the review',
    example: '2023-10-01T00:00:00Z',
  })
  @IsDateString()
  reviewDate: Date;

  @ApiProperty({ description: 'Is the review committed?', example: false })
  @IsOptional()
  @IsBoolean()
  committed?: boolean;
}

export class ReviewRequestDto extends ReviewCommonDto {
  @ApiProperty({ description: 'The ID of the review', example: '123' })
  id: string;

  @ApiProperty({
    description: 'List of review items',
    type: [ReviewItemRequestDto],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReviewItemRequestDto)
  reviewItems?: ReviewItemRequestDto[];
}

const ReviewPutBase = OmitType(ReviewCommonDto, [
  'resourceId',
  'submissionId',
] as const);

export class ReviewPutRequestDto extends ReviewPutBase {
  @ApiHideProperty()
  @IsEmpty({ message: 'resourceId cannot be updated.' })
  resourceId?: never;

  @ApiHideProperty()
  @IsEmpty({ message: 'submissionId cannot be updated.' })
  submissionId?: never;
}

export class ReviewPatchRequestDto {
  @ApiHideProperty()
  @IsEmpty({ message: 'resourceId cannot be updated.' })
  resourceId?: never;

  @ApiHideProperty()
  @IsEmpty({ message: 'submissionId cannot be updated.' })
  submissionId?: never;

  @ApiProperty({
    description: 'Scorecard ID used for the review',
    example: 'scorecard101',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  scorecardId?: string;

  @ApiProperty({
    description: 'Type ID used for the review',
    example: 'type101',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  typeId?: string;

  @ApiProperty({
    description: 'Status for the review',
    enum: ReviewStatus,
    example: ReviewStatus.PENDING,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  status?: ReviewStatus;

  @ApiProperty({
    description: 'Review date for the review',
    example: '2023-10-01T00:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  reviewDate?: string;

  @ApiProperty({
    description: 'The metadata for the review',
  })
  @IsOptional()
  @IsObject()
  metadata?: object;

  @ApiProperty({ description: 'Is the review committed?', example: false })
  @IsOptional()
  @IsBoolean()
  committed?: boolean;

  @ApiProperty({
    description: 'List of review items to replace the current set with',
    type: [ReviewItemRequestDto],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReviewItemRequestDto)
  reviewItems?: ReviewItemRequestDto[];
}

export class ReviewResponseDto extends ReviewCommonDto {
  @ApiProperty({ description: 'The ID of the review', example: '123' })
  id: string;

  @ApiProperty({
    description: 'Phase ID of the challenge',
    example: 'phase456',
  })
  phaseId: string;

  @ApiProperty({
    description:
      'Human-readable name of the challenge phase associated with this review',
    example: 'Review',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  phaseName?: string | null;

  @ApiProperty({ description: 'Final score of the review', example: 85.5 })
  finalScore: number | null;

  @ApiProperty({
    description: 'Initial score before finalization',
    example: 80.0,
  })
  initialScore: number | null;

  @ApiProperty({
    description: 'List of review items',
    type: [ReviewItemResponseDto],
    required: false,
  })
  reviewItems?: ReviewItemResponseDto[];

  @ApiProperty({
    description:
      'Flattened list of all appeals across this review (aggregated from review item comments). Includes appeal responses when present.',
    type: [AppealResponseDto],
    required: false,
  })
  appeals?: AppealResponseDto[];

  @ApiProperty({
    description: 'The creation timestamp',
    example: '2023-10-01T00:00:00Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'The user who created the review',
    example: 'user123',
  })
  createdBy: string;

  @ApiProperty({
    description: 'The last update timestamp',
    example: '2023-10-01T00:00:00Z',
  })
  updatedAt: Date;

  @ApiProperty({
    description: 'The user who last updated the review',
    example: 'user456',
  })
  updatedBy: string;

  @ApiProperty({
    description: 'Handle of the reviewer associated with this review',
    example: 'reviewer123',
    required: false,
    nullable: true,
  })
  reviewerHandle?: string | null;

  @ApiProperty({
    description: 'Maximum rating of the reviewer sourced from member profile',
    example: 2760,
    required: false,
    nullable: true,
    type: Number,
  })
  reviewerMaxRating?: number | null;

  @ApiProperty({
    description: 'Handle of the submitter associated with this review',
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
}

type MappedReviewItemComment = {
  content: string;
  type: ReviewItemCommentType;
  sortOrder: number;
  resourceId: string;
};

type MappedReviewItem = {
  scorecardQuestionId: string;
  initialAnswer: string;
  finalAnswer?: string;
  managerComment?: string | null;
  review?: { connect: { id: string } };
  reviewItemComments?: { create?: MappedReviewItemComment[] };
};

export function mapReviewRequestToDto(
  request: ReviewRequestDto | ReviewPatchRequestDto | ReviewPutRequestDto,
) {
  if (request instanceof ReviewRequestDto) {
    return {
      ...request,
      reviewItems: {
        create: request.reviewItems?.map((item) => {
          // When creating review items nested within a review, don't include reviewId
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { reviewId, ...itemWithoutReviewId } = item;
          const itemPayload: MappedReviewItem =
            mapReviewItemRequestToDto(itemWithoutReviewId);
          if (itemPayload.reviewItemComments?.create) {
            itemPayload.reviewItemComments.create =
              itemPayload.reviewItemComments.create.map(
                (comment: MappedReviewItemComment) => ({
                  ...comment,
                  // Default commenter to the review's resourceId if not provided
                  resourceId: comment.resourceId ?? request.resourceId ?? '',
                }),
              );
          }
          return itemPayload;
        }),
      },
    };
  } else {
    const sanitizedRequest = {
      ...request,
    } as Partial<ReviewPatchRequestDto | ReviewPutRequestDto> &
      Record<string, unknown>;
    ['resourceId', 'submissionId', 'reviewItems'].forEach((field) => {
      delete sanitizedRequest[field];
    });

    return sanitizedRequest as ReviewPatchRequestDto;
  }
}

export function mapReviewItemRequestToDto(
  request: ReviewItemRequestDto,
): MappedReviewItem {
  const { reviewId, reviewItemComments, managerComment, ...rest } = request as {
    reviewId?: string;
  } & ReviewItemRequestDto;

  const payload: MappedReviewItem = {
    ...rest,
    reviewItemComments: {
      create: reviewItemComments?.map((comment) => ({
        ...comment,
        // resourceId is required on reviewItemComment; leave population to controller/service
        resourceId: '',
      })),
    },
  };

  if (managerComment !== undefined) {
    payload.managerComment = managerComment ?? null;
  }

  // Only add review connection if reviewId is explicitly provided
  // This is for standalone review item creation, not nested creation
  if (reviewId) {
    payload.review = { connect: { id: reviewId } };
  }

  return payload;
}

export function mapReviewItemRequestForUpdate(
  request: ReviewItemRequestDto,
): Partial<MappedReviewItem> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { reviewId, reviewItemComments, ...rest } = request as {
    reviewId?: string;
    reviewItemComments?: any[];
  } & ReviewItemRequestDto;

  const payload: Partial<MappedReviewItem> = {
    ...rest,
  };

  // Handle review item comments update if provided
  // Strategy: Delete all existing comments and create new ones
  if (reviewItemComments !== undefined) {
    payload.reviewItemComments = {
      deleteMany: {}, // Delete all existing comments for this review item
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      create: reviewItemComments?.map((comment) => ({
        ...comment,
        // resourceId is required on reviewItemComment; leave population to controller/service
        resourceId: '',
      })),
    } as any;
  }

  return payload;
}

export class ReviewProgressResponseDto {
  @ApiProperty({
    description: 'The ID of the challenge',
    example: 'challenge123',
  })
  @IsString()
  @IsNotEmpty()
  challengeId: string;

  @ApiProperty({
    description: 'Total number of reviewers for the challenge',
    example: 2,
  })
  @IsNumber()
  totalReviewers: number;

  @ApiProperty({
    description: 'Total number of submissions for the challenge',
    example: 4,
  })
  @IsNumber()
  totalSubmissions: number;

  @ApiProperty({
    description: 'Total number of submitted reviews',
    example: 6,
  })
  @IsNumber()
  totalSubmittedReviews: number;

  @ApiProperty({
    description: 'Review progress percentage',
    example: 75.0,
  })
  @IsNumber()
  progressPercentage: number;

  @ApiProperty({
    description: 'Timestamp when the progress was calculated',
    example: '2025-01-15T10:30:00Z',
  })
  @IsDateString()
  calculatedAt: string;
}
