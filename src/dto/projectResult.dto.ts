import { ApiProperty } from '@nestjs/swagger';

export class AppealResultDto {
  @ApiProperty({ description: 'The ID of the appeal', example: '12' })
  id: string;

  @ApiProperty({
    description: 'Indicates if the appeal was successful',
    example: true,
  })
  success: boolean;
}

export class ReviewResultDto {
  @ApiProperty({ description: 'The score given in the review', example: 12.12 })
  score: number;

  @ApiProperty({
    description: 'List of appeals associated with this review',
    type: [AppealResultDto],
  })
  appeals: AppealResultDto[];
}

export class ProjectResultResponseDto {
  @ApiProperty({
    description: 'The ID of the challenge',
    example: 'mock-challenge-id',
  })
  challengeId: string;

  @ApiProperty({
    description: 'The ID of the user',
    example: 'mock-user-id',
  })
  userId: string;

  @ApiProperty({
    description: 'The payment ID (optional)',
    example: 'mock-payment-id',
    nullable: true,
  })
  paymentId?: string;

  @ApiProperty({
    description: 'The submission ID',
    example: 'mock-submission-id',
  })
  submissionId: string;

  @ApiProperty({
    description: 'The old rating of the user',
    example: 1500,
    nullable: true,
  })
  oldRating?: number;

  @ApiProperty({
    description: 'The new rating of the user',
    example: 1525,
    nullable: true,
  })
  newRating?: number;

  @ApiProperty({
    description: 'Initial aggregated score before appeals',
    example: 85.0,
  })
  initialScore: number;

  @ApiProperty({
    description: 'Final aggregated score after appeals',
    example: 88.5,
  })
  finalScore: number;

  @ApiProperty({
    description: 'The placement of the user in the challenge',
    example: 1,
  })
  placement: number;

  @ApiProperty({
    description: 'Indicates if the challenge was rated',
    example: true,
  })
  rated: boolean;

  @ApiProperty({
    description: 'Indicates if the user passed the review',
    example: true,
  })
  passedReview: boolean;

  @ApiProperty({
    description: 'Indicates if the submission was valid',
    example: true,
  })
  validSubmission: boolean;

  @ApiProperty({
    description: 'Point adjustment for rating calculation (optional)',
    example: -2.5,
    nullable: true,
  })
  pointAdjustment?: number;

  @ApiProperty({
    description: 'Rating order for rating calculation (optional)',
    example: 5,
    nullable: true,
  })
  ratingOrder?: number;

  @ApiProperty({
    description: 'The date when the result was created',
    example: '2025-02-11T12:34:56.789Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'The user who created the record',
    example: 'admin-user',
  })
  createdBy: string;

  @ApiProperty({
    description: 'The date when the result was last updated',
    example: '2025-02-12T14:23:45.678Z',
  })
  updatedAt: Date;

  @ApiProperty({
    description: 'The user who last updated the record',
    example: 'reviewer-user',
  })
  updatedBy: string;

  @ApiProperty({
    description: 'List of reviews associated with this submission',
    type: [ReviewResultDto],
  })
  reviews: ReviewResultDto[];
}
