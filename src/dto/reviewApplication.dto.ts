import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
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
  ReviewOpportunityType
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
}
