import { ApiProperty } from '@nestjs/swagger';

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
  resourceId: string;

  @ApiProperty({
    description: 'Phase ID of the challenge',
    example: 'phase456',
  })
  phaseId: string;

  @ApiProperty({
    description: 'Submission ID being reviewed',
    example: 'submission789',
  })
  submissionId: string;

  @ApiProperty({
    description: 'Scorecard ID used for the review',
    example: 'scorecard101',
  })
  scorecardId: string;

  @ApiProperty({ description: 'Final score of the review', example: 85.5 })
  finalScore: number;

  @ApiProperty({
    description: 'Initial score before finalization',
    example: 80.0,
  })
  initialScore: number;

  @ApiProperty({ description: 'Is the review committed?', example: false })
  committed?: boolean;

  reviewItems?: any[];
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

export function mapReviewRequestToDto(request: ReviewRequestDto) {
  const userFields = {
    createdBy: '',
    updatedBy: '',
  };

  return {
    ...request,
    ...userFields,
    reviewItems: {
      create: request.reviewItems?.map((item) =>
        mapReviewItemRequestToDto(item),
      ),
    },
  };
}

export function mapReviewItemRequestToDto(request: ReviewItemRequestDto) {
  const userFields = {
    createdBy: '',
    updatedBy: '',
  };

  return {
    ...request,
    ...userFields,
    reviewId: '',
    reviewItemComments: {
      create: request.reviewItemComments?.map((comment) => ({
        ...comment,
        ...userFields,
        resourceId: '',
        reviewItemId: '',
      })),
    },
  };
}
