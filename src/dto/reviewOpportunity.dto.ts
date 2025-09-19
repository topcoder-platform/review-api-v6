import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { ReviewApplicationResponseDto } from './reviewApplication.dto';
import { Expose, Transform } from 'class-transformer';
import { ChallengeStatus } from 'src/shared/enums/challengeStatus.enum';

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

const mergeNormalizedStrings = (...inputs: unknown[]): string[] => {
  const unique = new Set<string>();
  for (const input of inputs) {
    for (const value of toNormalizedStrings(input)) {
      unique.add(value);
    }
  }
  return [...unique];
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

const opportunityAllType = [
  ReviewOpportunityType.REGULAR_REVIEW,
  ReviewOpportunityType.COMPONENT_DEV_REVIEW,
  ReviewOpportunityType.SPEC_REVIEW,
  ReviewOpportunityType.ITERATIVE_REVIEW,
  ReviewOpportunityType.SCENARIOS_REVIEW,
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

export class QueryReviewOpportunityDto {
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
  @IsPositive()
  @IsOptional()
  numSubmissionsFrom: number | undefined;

  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  @IsPositive()
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

  @IsIn(['basePayment', 'duration', 'startDate'])
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
  @IsOptional()
  limit: number | undefined = 10;

  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  @Min(0)
  @IsOptional()
  offset: number | undefined = 0;
}
