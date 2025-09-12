import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsObject,
} from 'class-validator';

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
  content: string;

  @ApiProperty({
    description: 'Type of the comment',
    enum: ReviewItemCommentType,
    example: ReviewItemCommentType.COMMENT,
  })
  type: ReviewItemCommentType;

  @ApiProperty({
    description: 'Sort order of the comment. Defaults to 0',
    example: 1,
    default: 0,
  })
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
  scorecardQuestionId: string;

  @ApiProperty({
    description: 'Initial answer for the review item',
    example: 'Yes',
    required: true,
  })
  initialAnswer: string;

  @ApiProperty({
    description: 'Final answer after review updates',
    example: 'No',
    required: false,
  })
  finalAnswer?: string;

  @ApiProperty({
    description: 'Manager comment',
    example: 'This is a required change',
    required: false,
  })
  managerComment?: string;

  reviewItemComments?: any[];
}

export class ReviewItemRequestDto extends ReviewItemBaseDto {
  @ApiProperty({
    description:
      'Parent review ID to attach this item to (required for standalone create)',
    example: 'review123',
    required: false,
  })
  reviewId?: string;

  @ApiProperty({
    description: 'List of comments on this review item',
    type: [ReviewItemCommentRequestDto],
    required: false,
  })
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

export class ReviewBaseDto {
  @ApiProperty({
    description: 'Resource ID associated with the review',
    example: 'resource123',
  })
  @IsString()
  @IsNotEmpty()
  resourceId: string;

  @ApiProperty({
    description: 'Phase ID of the challenge',
    example: 'phase456',
  })
  @IsString()
  @IsNotEmpty()
  phaseId: string;

  @ApiProperty({
    description: 'Submission ID being reviewed',
    example: 'submission789',
  })
  @IsString()
  @IsNotEmpty()
  submissionId: string;

  @ApiProperty({
    description: 'Scorecard ID used for the review',
    example: 'scorecard101',
  })
  @IsString()
  @IsNotEmpty()
  scorecardId: string;

  @ApiProperty({ description: 'Final score of the review', example: 85.5 })
  @IsNumber()
  finalScore: number;

  @ApiProperty({
    description: 'Initial score before finalization',
    example: 80.0,
  })
  @IsNumber()
  initialScore: number;

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

export class ReviewRequestDto extends ReviewBaseDto {
  @ApiProperty({ description: 'The ID of the review', example: '123' })
  id: string;

  @ApiProperty({
    description: 'List of review items',
    type: [ReviewItemRequestDto],
    required: false,
  })
  reviewItems?: ReviewItemRequestDto[];
}

export class ReviewPutRequestDto extends ReviewBaseDto {}

export class ReviewPatchRequestDto {
  @ApiProperty({
    description: 'Resource ID associated with the review',
    example: 'resource123',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  resourceId?: string;

  @ApiProperty({
    description: 'Phase ID of the challenge',
    example: 'phase456',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  phaseId?: string;

  @ApiProperty({
    description: 'Submission ID being reviewed',
    example: 'submission789',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  submissionId?: string;

  @ApiProperty({
    description: 'Scorecard ID used for the review',
    example: 'scorecard101',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  scorecardId?: string;

  @ApiProperty({ description: 'Final score of the review', example: 85.5 })
  @IsOptional()
  @IsNumber()
  finalScore?: number;

  @ApiProperty({
    description: 'Initial score before finalization',
    example: 80.0,
  })
  @IsOptional()
  @IsNumber()
  initialScore?: number;

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
}

export class ReviewResponseDto extends ReviewBaseDto {
  @ApiProperty({ description: 'The ID of the review', example: '123' })
  id: string;

  @ApiProperty({
    description: 'List of review items',
    type: [ReviewItemResponseDto],
    required: false,
  })
  reviewItems?: ReviewItemResponseDto[];

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

type MappedReviewItemComment = {
  content: string;
  type: ReviewItemCommentType;
  sortOrder: number;
  createdBy: string;
  updatedBy: string;
  resourceId: string;
};

type MappedReviewItem = {
  scorecardQuestionId: string;
  initialAnswer: string;
  finalAnswer?: string;
  managerComment?: string;
  createdBy: string;
  updatedBy: string;
  review?: { connect: { id: string } };
  reviewItemComments?: { create?: MappedReviewItemComment[] };
};

export function mapReviewRequestToDto(
  request: ReviewRequestDto | ReviewPatchRequestDto,
) {
  const userFields = {
    createdBy: '',
    updatedBy: '',
  };

  if (request instanceof ReviewRequestDto) {
    return {
      ...request,
      ...userFields,
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
                  resourceId: comment.resourceId || request.resourceId,
                }),
              );
          }
          return itemPayload;
        }),
      },
    };
  } else {
    return {
      ...request,
      ...userFields,
    };
  }
}

export function mapReviewItemRequestToDto(
  request: ReviewItemRequestDto,
): MappedReviewItem {
  const userFields = {
    createdBy: '',
    updatedBy: '',
  };

  const { reviewId, ...rest } = request as {
    reviewId?: string;
  } & ReviewItemRequestDto;

  const payload: MappedReviewItem = {
    ...rest,
    ...userFields,
    reviewItemComments: {
      create: request.reviewItemComments?.map((comment) => ({
        ...comment,
        ...userFields,
        // resourceId is required on reviewItemComment; leave population to controller/service
        resourceId: '',
      })),
    },
  };

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
  const userFields = {
    updatedBy: '',
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { reviewId, reviewItemComments, ...rest } = request as {
    reviewId?: string;
    reviewItemComments?: any[];
  } & ReviewItemRequestDto;

  // For updates, we only include the core review item fields
  // Comments should be handled separately via dedicated comment endpoints
  const payload: Partial<MappedReviewItem> = {
    ...rest,
    ...userFields,
  };

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
