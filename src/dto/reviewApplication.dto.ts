import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { ReviewOpportunityType as PrismaReviewOpportunityType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ReviewOpportunityType } from './reviewOpportunity.dto';

export enum ReviewApplicationStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

export enum ReviewApplicationRole {
  PRIMARY_REVIEWER = 'PRIMARY_REVIEWER',
  SECONDARY_REVIEWER = 'SECONDARY_REVIEWER',
  PRIMARY_FAILURE_REVIEWER = 'PRIMARY_FAILURE_REVIEWER',
  ACCURACY_REVIEWER = 'ACCURACY_REVIEWER',
  STRESS_REVIEWER = 'STRESS_REVIEWER',
  FAILURE_REVIEWER = 'FAILURE_REVIEWER',
  SPECIFICATION_REVIEWER = 'SPECIFICATION_REVIEWER',
  ITERATIVE_REVIEWER = 'ITERATIVE_REVIEWER',
  REVIEWER = 'REVIEWER',
}

// read from review_application_role_lu
export const ReviewApplicationRoleIds: Record<ReviewApplicationRole, number> = {
  PRIMARY_REVIEWER: 1,
  SECONDARY_REVIEWER: 2,
  PRIMARY_FAILURE_REVIEWER: 3,
  ACCURACY_REVIEWER: 4,
  STRESS_REVIEWER: 5,
  FAILURE_REVIEWER: 6,
  SPECIFICATION_REVIEWER: 7,
  ITERATIVE_REVIEWER: 8,
  REVIEWER: 9,
};

// read from review_application_role_lu.review_auction_type_id
export const ReviewApplicationRoleOpportunityTypeMap: Record<
  ReviewApplicationRole,
  PrismaReviewOpportunityType
> = {
  PRIMARY_REVIEWER: ReviewOpportunityType.COMPONENT_DEV_REVIEW,
  SECONDARY_REVIEWER: ReviewOpportunityType.COMPONENT_DEV_REVIEW,
  PRIMARY_FAILURE_REVIEWER: ReviewOpportunityType.COMPONENT_DEV_REVIEW,
  ACCURACY_REVIEWER: ReviewOpportunityType.COMPONENT_DEV_REVIEW,
  STRESS_REVIEWER: ReviewOpportunityType.COMPONENT_DEV_REVIEW,
  FAILURE_REVIEWER: ReviewOpportunityType.COMPONENT_DEV_REVIEW,
  SPECIFICATION_REVIEWER: ReviewOpportunityType.SPEC_REVIEW,
  ITERATIVE_REVIEWER: ReviewOpportunityType.ITERATIVE_REVIEW,
  REVIEWER: ReviewOpportunityType.REGULAR_REVIEW,
};

const allReviewApplicationRole = Object.values(ReviewApplicationRole);

/**
 * Normalizes a scalar or repeated query parameter into trimmed strings.
 *
 * @param value - Raw query parameter supplied by Express.
 * @returns Non-empty string values.
 */
const normalizeQueryValues = (value: unknown): string[] => {
  const values = Array.isArray(value) ? value : [value];
  return values
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
};

/**
 * Convert review application role enum to string value. Eg, 'ITERATIVE_REVIEWER' => 'Iterative Reviewer'
 * @param role ReviewApplicationRole value
 * @returns role name displayed on frontend pages
 */
export const convertRoleName = (role: ReviewApplicationRole): string => {
  return role
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
};

export class CreateReviewApplicationDto {
  @ApiProperty({
    description: 'Review Opportunity id',
  })
  @IsString()
  @IsNotEmpty()
  opportunityId: string;

  @ApiPropertyOptional({
    description: 'Review application role',
    enum: allReviewApplicationRole,
    example: ReviewApplicationRole.REVIEWER,
  })
  @IsOptional()
  @IsIn(allReviewApplicationRole)
  role: ReviewApplicationRole;
}

export class ReviewApplicationResponseDto {
  @ApiProperty({
    description: 'Review application id',
  })
  id: string;

  @ApiProperty({
    description: 'Review Opportunity id',
  })
  opportunityId: string;

  @ApiProperty({
    description: 'user id',
  })
  userId: string;

  @ApiProperty({
    description: 'user handle',
  })
  handle: string;

  @ApiProperty({
    description: 'Review Application Role',
  })
  role: ReviewApplicationRole;

  @ApiProperty({
    description: 'Review Application Status',
  })
  status: ReviewApplicationStatus;

  @ApiProperty({
    description: 'Review Application create time',
  })
  applicationDate: string;

  @ApiProperty({
    description:
      'Number of active challenges where the applicant is currently a reviewer',
    example: 3,
  })
  openReviews = 0;

  @ApiProperty({
    description:
      'Number of review challenges completed in the past 60 days where the applicant was a reviewer',
    example: 2,
  })
  latestCompletedReviews = 0;
}

/** Validated filters for the current member's review applications. */
export class QueryMyReviewApplicationDto {
  @ApiPropertyOptional({
    description: 'Filter by application status',
    enum: Object.values(ReviewApplicationStatus),
    isArray: true,
  })
  @Transform(({ value }) => normalizeQueryValues(value))
  @IsOptional()
  @IsIn(Object.values(ReviewApplicationStatus), { each: true })
  statuses?: ReviewApplicationStatus[];

  @ApiPropertyOptional({
    description: 'Filter by requested reviewer role',
    enum: allReviewApplicationRole,
    isArray: true,
  })
  @Transform(({ value }) => normalizeQueryValues(value))
  @IsOptional()
  @IsIn(allReviewApplicationRole, { each: true })
  roles?: ReviewApplicationRole[];

  @ApiPropertyOptional({ description: 'Filter by one review opportunity ID' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  opportunityId?: string;

  @ApiPropertyOptional({ description: 'One-based page', default: 1 })
  @Transform(({ value }) => Number(value))
  @IsOptional()
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ description: 'Rows per page', default: 10 })
  @Transform(({ value }) => Number(value))
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  perPage = 10;

  @ApiPropertyOptional({
    description: 'Application date sort order',
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';
}

/** Pagination metadata for a current-member application page. */
export class ReviewApplicationListMetadataDto {
  @ApiProperty({ description: 'Total matching applications' })
  total: number;

  @ApiProperty({ description: 'One-based page' })
  page: number;

  @ApiProperty({ description: 'Rows per page' })
  perPage: number;

  @ApiProperty({ description: 'Total number of pages' })
  totalPages: number;
}
