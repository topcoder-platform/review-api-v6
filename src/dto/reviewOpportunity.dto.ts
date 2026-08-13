import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type {
  ReviewApplicationResponseDto,
  ReviewApplicationStatus,
} from './reviewApplication.dto';
import { Expose, Transform } from 'class-transformer';
import { ChallengeStatus } from 'src/shared/enums/challengeStatus.enum';

/**
 * Normalizes one scalar or repeated query parameter into trimmed strings.
 *
 * @param input - Raw query parameter value supplied by Express.
 * @returns Non-empty normalized strings.
 */
const toNormalizedStrings = (input: unknown): string[] => {
  if (Array.isArray(input)) {
    return input
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  if (typeof input === 'string') {
    const trimmed = input.trim();
    return trimmed ? [trimmed] : [];
  }

  return [];
};

/**
 * Merges aliases for a repeated query parameter without duplicate values.
 *
 * @param inputs - Scalar or repeated values from supported query aliases.
 * @returns Unique normalized values in first-seen order.
 */
const mergeNormalizedStrings = (...inputs: unknown[]): string[] => {
  const unique = new Set<string>();
  for (const input of inputs) {
    for (const value of toNormalizedStrings(input)) {
      unique.add(value);
    }
  }
  return [...unique];
};

/**
 * Converts a query-string boolean into a real boolean for class validation.
 *
 * @param value - Raw query parameter value.
 * @returns Parsed boolean, or the original value so validation can reject it.
 */
const toBoolean = (value: unknown): unknown => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return value;
  if (value.toLowerCase() === 'true' || value === '1') return true;
  if (value.toLowerCase() === 'false' || value === '0') return false;
  return value;
};

export enum ReviewOpportunityStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  CANCELLED = 'CANCELLED',
}

const opportunityAllStatus = [
  ReviewOpportunityStatus.OPEN,
  ReviewOpportunityStatus.CLOSED,
  ReviewOpportunityStatus.CANCELLED,
];

export enum ReviewOpportunityType {
  REGULAR_REVIEW = 'REGULAR_REVIEW',
  COMPONENT_DEV_REVIEW = 'COMPONENT_DEV_REVIEW',
  SPEC_REVIEW = 'SPEC_REVIEW',
  ITERATIVE_REVIEW = 'ITERATIVE_REVIEW',
  SCENARIOS_REVIEW = 'SCENARIOS_REVIEW',
}

/** Stable reason codes used to render review-application eligibility. */
export enum ReviewOpportunityCanApplyReason {
  CAN_APPLY = 'CAN_APPLY',
  NOT_AUTHENTICATED = 'NOT_AUTHENTICATED',
  NOT_REVIEWER = 'NOT_REVIEWER',
  OPPORTUNITY_CLOSED = 'OPPORTUNITY_CLOSED',
  CHALLENGE_NOT_ACTIVE = 'CHALLENGE_NOT_ACTIVE',
  ALREADY_APPLIED = 'ALREADY_APPLIED',
  NO_OPEN_POSITIONS = 'NO_OPEN_POSITIONS',
}

const opportunityAllType = [
  ReviewOpportunityType.REGULAR_REVIEW,
  ReviewOpportunityType.COMPONENT_DEV_REVIEW,
  ReviewOpportunityType.SPEC_REVIEW,
  ReviewOpportunityType.ITERATIVE_REVIEW,
  ReviewOpportunityType.SCENARIOS_REVIEW,
];

const reviewApplicationStatuses = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
];

export class CreateReviewOpportunityDto {
  @ApiProperty({
    description: 'Challenge id',
  })
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  challengeId: string;

  @ApiPropertyOptional({
    description: 'Review Opportunity Status',
    enum: opportunityAllStatus,
    example: ReviewOpportunityStatus.OPEN,
  })
  @IsOptional()
  @IsIn(opportunityAllStatus)
  status: ReviewOpportunityStatus = ReviewOpportunityStatus.OPEN;

  @ApiPropertyOptional({
    description: 'Review Opportunity Type',
    enum: opportunityAllType,
    example: ReviewOpportunityType.REGULAR_REVIEW,
  })
  @IsOptional()
  @IsIn(opportunityAllType)
  type: ReviewOpportunityType = ReviewOpportunityType.REGULAR_REVIEW;

  @ApiProperty({
    description: 'Number of open positions',
    example: 2,
  })
  @IsNumber()
  @IsPositive()
  openPositions: number;

  @ApiProperty({
    description: 'Review phase start time',
    example: '2025-05-30T12:34:56Z',
  })
  @IsDateString()
  @IsNotEmpty()
  startDate: string;

  @ApiProperty({
    description: 'Review phase duration(seconds)',
    example: '86400',
  })
  @IsNumber()
  @IsPositive()
  duration: number;

  @ApiProperty({
    description: 'Payment for reviewer if there is 1 submission.',
    example: '180.0',
  })
  @IsNumber()
  @IsPositive()
  basePayment: number;

  @ApiProperty({
    description: 'Review payment for each extra submission.',
    example: '50.0',
  })
  @IsNumber()
  @IsPositive()
  incrementalPayment: number;
}

export class UpdateReviewOpportunityDto extends PartialType(
  OmitType(CreateReviewOpportunityDto, ['challengeId', 'type']),
) {}

export class ReviewPaymentDto {
  @ApiProperty({
    description: 'Review application role name',
    example: 'Iterative Reviewer',
  })
  role: string;

  @ApiProperty({
    description: 'Review application role id',
    example: 8,
  })
  roleId: number;

  @ApiProperty({
    description:
      'Review payment. Should be base payment if there is 1 submission.',
    example: 180.0,
  })
  @IsNumber()
  @IsPositive()
  payment: number;
}

export class ReviewOpportunityResponseDto extends CreateReviewOpportunityDto {
  @ApiProperty({
    description: 'Review opportunity id',
  })
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  id: string;

  @ApiProperty({
    description: 'Current submission count of this challenge',
  })
  submissions: number | null;

  @ApiProperty({
    description: 'Challenge name',
  })
  challengeName: string | null;

  @ApiProperty({
    description:
      'Challenge data including id, title, track, subTrack, technologies, platforms',
  })
  challengeData: Record<string, string | number | string[]> | null;

  @ApiProperty({
    description: 'Review applications on this opportunity',
  })
  applications: ReviewApplicationResponseDto[] | null;

  @ApiProperty({
    description: 'Review payments',
  })
  payments: ReviewPaymentDto[] | null;

  @ApiProperty({
    description:
      'Whether the current caller can submit a review application now',
    example: true,
  })
  canApply: boolean;

  @ApiProperty({
    description: 'Stable explanation for the canApply value',
    enum: ReviewOpportunityCanApplyReason,
    example: ReviewOpportunityCanApplyReason.CAN_APPLY,
  })
  canApplyReason: ReviewOpportunityCanApplyReason;

  @ApiProperty({
    description: 'Applications belonging to the authenticated caller only',
    type: 'array',
    items: { type: 'object' },
  })
  myApplications: ReviewApplicationResponseDto[];

  @ApiProperty({
    description: 'Number of approved applications occupying reviewer spots',
    example: 1,
  })
  approvedApplicationCount: number;

  @ApiProperty({
    description: 'Reviewer positions not yet occupied by approved applications',
    example: 2,
  })
  remainingPositions: number;
}

/** Pagination metadata returned by metadata-first opportunity searches. */
export class ReviewOpportunitySearchMetadataDto {
  @ApiProperty({ description: 'Total rows matching all filters', example: 42 })
  total: number;

  @ApiProperty({ description: 'Zero-based row offset', example: 0 })
  offset: number;

  @ApiProperty({ description: 'Maximum rows returned', example: 10 })
  limit: number;

  @ApiProperty({
    description: 'One-based page derived from offset',
    example: 1,
  })
  page: number;

  @ApiProperty({ description: 'Total number of pages', example: 5 })
  totalPages: number;
}

export class ReviewOpportunitySummaryDto {
  @ApiProperty({ description: 'Challenge id' })
  challengeId: string;

  @ApiProperty({ description: 'Challenge name' })
  challengeName: string;

  @ApiProperty({
    description: 'Challenge status',
    enum: ChallengeStatus,
    example: ChallengeStatus.ACTIVE,
  })
  challengeStatus: ChallengeStatus;

  @ApiPropertyOptional({
    description: 'Submission phase end date',
    type: String,
    format: 'date-time',
  })
  submissionEndDate?: Date | null;

  @ApiProperty({ description: 'Number of submissions received' })
  numberOfSubmissions: number;

  @ApiProperty({ description: 'Number of reviewer spots available' })
  numberOfReviewerSpots: number;

  @ApiProperty({ description: 'Number of pending review applications' })
  numberOfPendingApplications: number;

  @ApiProperty({ description: 'Number of approved review applications' })
  numberOfApprovedApplications: number;
}

export class QueryReviewOpportunitySummaryDto {
  @ApiProperty({
    description: 'Page number (1-based)',
    example: 1,
    required: false,
    default: 1,
  })
  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  @Min(1)
  @IsOptional()
  page: number = 1;

  @ApiProperty({
    description: 'Items per page',
    example: 10,
    required: false,
    default: 10,
  })
  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  @IsPositive()
  @IsOptional()
  perPage: number = 10;

  @ApiProperty({
    description: 'Sorting field',
    enum: [
      'challengeName',
      'submissionEndDate',
      'numberOfPendingApplications',
      'numberOfApprovedApplications',
      'numberOfReviewerSpots',
      'numberOfSubmissions',
    ],
    example: 'submissionEndDate',
    required: false,
    default: 'submissionEndDate',
  })
  @IsIn([
    'challengeName',
    'submissionEndDate',
    'numberOfPendingApplications',
    'numberOfApprovedApplications',
    'numberOfReviewerSpots',
    'numberOfSubmissions',
  ])
  @IsString()
  @IsOptional()
  sortBy: string = 'submissionEndDate';

  @ApiProperty({
    description: 'Sorting order',
    enum: ['asc', 'desc'],
    example: 'desc',
    required: false,
    default: 'desc',
  })
  @IsIn(['asc', 'desc'])
  @IsString()
  @IsOptional()
  sortOrder: string = 'desc';
}

export class QueryReviewOpportunityDto {
  @ApiPropertyOptional({
    description: 'Case-insensitive challenge name search',
    example: 'dashboard',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({
    description: 'Restrict results to challenge IDs',
    type: [String],
  })
  @Transform(({ value }) => toNormalizedStrings(value))
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  challengeIds?: string[];

  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  @Min(0)
  @IsOptional()
  paymentFrom: number | undefined;

  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  @Min(0)
  @IsOptional()
  paymentTo: number | undefined;

  @ApiProperty({
    description: 'Start time min value',
    example: '2025-05-30T12:34:56Z',
  })
  @IsDateString()
  @IsOptional()
  startDateFrom: string | undefined;

  @ApiProperty({
    description: 'Start time max value',
    example: '2025-05-30T12:34:56Z',
  })
  @IsDateString()
  @IsOptional()
  startDateTo: string | undefined;

  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  @IsPositive()
  @IsOptional()
  durationFrom: number | undefined;

  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  @IsPositive()
  @IsOptional()
  durationTo: number | undefined;

  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  @Min(0)
  @IsOptional()
  numSubmissionsFrom: number | undefined;

  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  @Min(0)
  @IsOptional()
  numSubmissionsTo: number | undefined;

  @Expose({ name: 'track' })
  @Transform(({ value, obj }): string[] | undefined => {
    const sourceObj = obj as Record<string, unknown> | undefined;
    const values = mergeNormalizedStrings(
      value,
      sourceObj?.tracks,
      sourceObj?.track,
    );
    return values.length > 0 ? values : undefined;
  })
  @IsArray()
  @IsOptional()
  tracks: string[] | undefined;

  @Expose({ name: 'type' })
  @Transform(({ value, obj }): string[] | undefined => {
    const sourceObj = obj as Record<string, unknown> | undefined;
    const values = mergeNormalizedStrings(
      value,
      sourceObj?.types,
      sourceObj?.type,
    );
    return values.length > 0 ? values : undefined;
  })
  @IsArray()
  @IsOptional()
  types: string[] | undefined;

  @ApiPropertyOptional({
    description: 'Review opportunity types',
    enum: opportunityAllType,
    isArray: true,
  })
  @Transform(({ value }) => toNormalizedStrings(value))
  @IsArray()
  @IsIn(opportunityAllType, { each: true })
  @IsOptional()
  opportunityTypes?: ReviewOpportunityType[];

  @ApiPropertyOptional({
    description:
      'Opportunity statuses. Omit to preserve the historical OPEN-only default.',
    enum: opportunityAllStatus,
    isArray: true,
  })
  @Expose({ name: 'status' })
  @Transform(({ value, obj }): ReviewOpportunityStatus[] | undefined => {
    const sourceObj = obj as Record<string, unknown> | undefined;
    const values = mergeNormalizedStrings(
      value,
      sourceObj?.statuses,
      sourceObj?.status,
    );
    return values.length ? (values as ReviewOpportunityStatus[]) : undefined;
  })
  @IsArray()
  @IsIn(opportunityAllStatus, { each: true })
  @IsOptional()
  statuses?: ReviewOpportunityStatus[];

  @ApiPropertyOptional({
    description:
      'Return only opportunities with (true) or without (false) an application by the authenticated caller',
  })
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  @IsOptional()
  appliedByMe?: boolean;

  @ApiPropertyOptional({
    description:
      'Filter the authenticated caller application by status; implies appliedByMe=true',
    enum: reviewApplicationStatuses,
    isArray: true,
  })
  @Transform(({ value }) => toNormalizedStrings(value))
  @IsArray()
  @IsIn(reviewApplicationStatuses, { each: true })
  @IsOptional()
  applicationStatuses?: ReviewApplicationStatus[];

  @IsIn(['basePayment', 'duration', 'startDate', 'openPositions'])
  @IsString()
  @IsOptional()
  sortBy: string = 'startDate';

  @IsIn(['asc', 'desc'])
  @IsString()
  @IsOptional()
  sortOrder: string = 'asc';

  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  @IsPositive()
  @Max(100)
  @IsOptional()
  limit: number | undefined = 10;

  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  @Min(0)
  @IsOptional()
  offset: number | undefined = 0;
}
