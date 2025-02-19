import { ApiProperty } from '@nestjs/swagger';

export enum ReviewItemCommentType {
  COMMENT = 'COMMENT',
  REQUIRED = 'REQUIRED',
  RECOMMENDED = 'RECOMMENDED',
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

  @ApiProperty({ description: 'Sort order of the comment', example: 1 })
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
    required: false,
  })
  initialAnswer?: string;

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

export const mockReviewResponse: ReviewResponseDto = {
  id: 'mock-review-id',
  resourceId: 'mock-resource-id',
  phaseId: 'mock-phase-id',
  submissionId: 'mock-submission-id',
  scorecardId: 'mock-scorecard-id',
  finalScore: 85.5,
  initialScore: 80.0,
  committed: false,
  createdBy: 'user123',
  createdAt: new Date(),
  updatedBy: 'user456',
  updatedAt: new Date(),
  reviewItems: [
    {
      id: 'mock-item-id',
      scorecardQuestionId: 'mock-question-id',
      initialAnswer: 'Yes',
      finalAnswer: 'No',
      managerComment: 'Needs improvement',
      reviewItemComments: [
        {
          id: 'mock-comment-id',
          content: 'This needs more explanation',
          type: ReviewItemCommentType.COMMENT,
          sortOrder: 1,
          createdBy: 'user123',
          createdAt: new Date(),
          updatedBy: 'user456',
          updatedAt: new Date(),
        },
      ],
      createdBy: 'user123',
      createdAt: new Date(),
      updatedBy: 'user456',
      updatedAt: new Date(),
    },
  ],
};
