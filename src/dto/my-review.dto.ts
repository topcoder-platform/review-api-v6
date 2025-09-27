import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class MyReviewFilterDto {
  @ApiProperty({
    description: 'Filter results to a specific challenge type ID',
    required: false,
  })
  @IsOptional()
  @IsString()
  challengeTypeId?: string;

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
      'Seconds remaining until the current phase ends. Zero when the phase has ended or the end date is unavailable.',
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
}
