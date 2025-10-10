import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export const ACTIVE_MY_REVIEW_SORT_FIELDS = [
  'challengeName',
  'phase',
  'phaseEndDate',
  'timeLeft',
  'reviewProgress',
] as const;

export const PAST_MY_REVIEW_SORT_FIELDS = [
  'challengeName',
  'challengeEndDate',
] as const;

export const ALL_MY_REVIEW_SORT_FIELDS = [
  ...ACTIVE_MY_REVIEW_SORT_FIELDS,
  ...PAST_MY_REVIEW_SORT_FIELDS,
] as const;

export type MyReviewSortField = (typeof ALL_MY_REVIEW_SORT_FIELDS)[number];

export class MyReviewWinnerDto {
  @ApiProperty({ description: 'Winner user identifier' })
  userId: number;

  @ApiProperty({ description: 'Winner handle' })
  handle: string;

  @ApiProperty({ description: 'Winner placement order' })
  placement: number;

  @ApiProperty({ description: 'Winner prize set type' })
  type: string;

  @ApiProperty({
    description: 'Winner maximum rating across tracks',
    required: false,
    nullable: true,
  })
  maxRating?: number | null;
}

export class MyReviewFilterDto {
  @ApiProperty({
    description: 'Filter results to a specific challenge type ID',
    required: false,
  })
  @IsOptional()
  @IsString()
  challengeTypeId?: string;

  @ApiProperty({
    description: 'Filter results to a specific challenge track ID',
    required: false,
  })
  @IsOptional()
  @IsString()
  challengeTrackId?: string;

  @ApiProperty({
    description: 'Filter results to a specific challenge type name',
    required: false,
  })
  @IsOptional()
  @IsString()
  challengeTypeName?: string;

  @ApiProperty({
    description:
      'Whether or not to include current challenges or past challenges',
    required: false,
  })
  @IsOptional()
  @IsString()
  past?: string;

  @ApiProperty({
    description:
      'Field to sort the results by. Supported values differ for active vs past challenges.',
    required: false,
    enum: ALL_MY_REVIEW_SORT_FIELDS,
  })
  @IsOptional()
  @IsString()
  @IsIn(ALL_MY_REVIEW_SORT_FIELDS)
  sortBy?: MyReviewSortField;

  @ApiProperty({
    description: 'Sort order for the selected field',
    required: false,
    enum: ['asc', 'desc'],
    default: 'asc',
  })
  @IsOptional()
  @IsString()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

export class MyReviewSummaryDto {
  @ApiProperty({ description: 'Challenge identifier' })
  challengeId: string;

  @ApiProperty({ description: 'Challenge name' })
  challengeName: string;

  @ApiProperty({
    description: 'Identifier of the challenge type',
    required: false,
  })
  challengeTypeId?: string | null;

  @ApiProperty({ description: 'Name of the challenge type', required: false })
  challengeTypeName?: string | null;

  @ApiProperty({
    description: 'Overall end date of the challenge',
    required: false,
  })
  challengeEndDate?: string | null;

  @ApiProperty({ description: 'Current phase display name', required: false })
  currentPhaseName?: string | null;

  @ApiProperty({
    description:
      'End date for the current phase, prioritising the actual end when available',
    required: false,
  })
  currentPhaseEndDate?: string | null;

  @ApiProperty({
    description:
      'Seconds remaining until the current phase ends. Negative values indicate the phase is past due. Returns 0 when the end date is unavailable.',
  })
  timeLeftInCurrentPhase: number;

  @ApiProperty({
    description: "The requesting user's resource role on the challenge",
    required: false,
  })
  resourceRoleName?: string | null;

  @ApiProperty({
    description: 'Review progress expressed as a ratio between 0 and 1',
  })
  reviewProgress: number;

  @ApiProperty({
    description:
      'Indicates whether the user has outstanding review deliverables for this challenge',
  })
  deliverableDue: boolean;

  @ApiProperty({
    description:
      'Name of the phase associated with the outstanding deliverable when deliverableDue is true',
    required: false,
    nullable: true,
  })
  deliverableDuePhaseName?: string | null;

  @ApiProperty({
    description: 'Challenge winners when available',
    required: false,
    nullable: true,
    isArray: true,
    type: () => MyReviewWinnerDto,
  })
  winners?: MyReviewWinnerDto[] | null;

  @ApiProperty({
    description: 'Challenge status',
    required: false,
  })
  status?: string;
}
