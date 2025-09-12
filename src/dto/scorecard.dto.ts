import { ApiProperty } from '@nestjs/swagger';
import { $Enums } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  IsGreaterThan,
  IsSmallerThan,
  WeightSum,
} from '../../src/shared/validators/customValidators';

export enum ScorecardStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  DELETED = 'DELETED',
}

export enum ScorecardType {
  SCREENING = 'SCREENING',
  REVIEW = 'REVIEW',
  APPROVAL = 'APPROVAL',
  POST_MORTEM = 'POST_MORTEM',
  SPECIFICATION_REVIEW = 'SPECIFICATION_REVIEW',
  CHECKPOINT_SCREENING = 'CHECKPOINT_SCREENING',
  CHECKPOINT_REVIEW = 'CHECKPOINT_REVIEW',
  ITERATIVE_REVIEW = 'ITERATIVE_REVIEW',
}

export enum ChallengeTrack {
  DEVELOPMENT = 'DEVELOPMENT',
  DATA_SCIENCE = 'DATA_SCIENCE',
  DESIGN = 'DESIGN',
  QUALITY_ASSURANCE = 'QUALITY_ASSURANCE',
}

export enum QuestionType {
  SCALE = 'SCALE',
  YES_NO = 'YES_NO',
  TEST_CASE = 'TEST_CASE',
}

export class ScorecardQuestionBaseDto {
  @ApiProperty({ description: 'The id of the question', example: 'abc' })
  @IsOptional()
  @IsString()
  id: string;

  @ApiProperty({ description: 'The type of the question', enum: QuestionType })
  @IsEnum(QuestionType)
  type: QuestionType;

  @ApiProperty({
    description: 'The description of the question',
    example: 'What is the challenge?',
  })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({
    description: 'Guidelines for the question',
    example: 'Provide detailed information.',
  })
  @IsString()
  guidelines: string;

  @ApiProperty({ description: 'The weight of the question', example: 10 })
  @IsNumber()
  @Min(0)
  @Max(100)
  weight: number;

  @ApiProperty({
    description: 'Indicates whether the question requires an upload',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  requiresUpload: boolean;

  @ApiProperty({
    description: 'Minimum scale value (if applicable)',
    example: 0,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  scaleMin?: number;

  @ApiProperty({
    description: 'Maximum scale value (if applicable)',
    example: 9,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  scaleMax?: number;

  @ApiProperty({ description: 'Sort order of the question', example: 1 })
  @IsNumber()
  sortOrder: number;
}

export class ScorecardQuestionRequestDto extends ScorecardQuestionBaseDto {}

export class ScorecardQuestionResponseDto extends ScorecardQuestionBaseDto {
  @ApiProperty({ description: 'The ID of the question', example: 'q123' })
  id: string;
}

export class ScorecardSectionBaseDto {
  @ApiProperty({ description: 'The id of the section', example: 'abc' })
  @IsOptional()
  @IsString()
  id: string;

  @ApiProperty({
    description: 'The name of the section',
    example: 'Technical Skills',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'The weight of the section', example: 20 })
  @IsNumber()
  @Min(0)
  @Max(100)
  weight: number;

  @ApiProperty({ description: 'Sort order of the section', example: 1 })
  @IsNumber()
  sortOrder: number;

  questions: any[];
}

export class ScorecardSectionRequestDto extends ScorecardSectionBaseDto {
  @ApiProperty({
    description: 'The list of questions within this section',
    type: [ScorecardQuestionRequestDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScorecardQuestionRequestDto)
  @WeightSum()
  questions: ScorecardQuestionRequestDto[];
}

export class ScorecardSectionResponseDto extends ScorecardSectionBaseDto {
  @ApiProperty({ description: 'The ID of the section', example: 's123' })
  id: string;

  @ApiProperty({
    description: 'The list of questions within this section',
    type: [ScorecardQuestionResponseDto],
  })
  questions: ScorecardQuestionResponseDto[];
}

export class ScorecardGroupBaseDto {
  @ApiProperty({ description: 'The id of the group', example: 'abc' })
  @IsOptional()
  @IsString()
  id: string;

  @ApiProperty({ description: 'The name of the group', example: 'Group A' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'The weight of the group', example: 30 })
  @IsNumber()
  @Min(0)
  @Max(100)
  weight: number;

  @ApiProperty({ description: 'Sort order of the group', example: 1 })
  @IsNumber()
  sortOrder: number;

  sections: any[];
}
export class ScorecardGroupRequestDto extends ScorecardGroupBaseDto {
  @ApiProperty({
    description: 'The list of sections within this group',
    type: [ScorecardSectionRequestDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScorecardSectionRequestDto)
  @WeightSum()
  sections: ScorecardSectionRequestDto[];
}

export class ScorecardGroupResponseDto extends ScorecardGroupBaseDto {
  @ApiProperty({ description: 'The ID of the group', example: 'g123' })
  id: string;

  @ApiProperty({
    description: 'The list of sections within this group',
    type: [ScorecardSectionResponseDto],
  })
  sections: ScorecardSectionResponseDto[];
}

export class ScorecardBaseDto {
  @ApiProperty({
    description: 'The status of the scorecard',
    enum: ScorecardStatus,
  })
  @IsEnum(ScorecardStatus)
  status: ScorecardStatus;

  @ApiProperty({
    description: 'The type of the scorecard',
    enum: ScorecardType,
  })
  @IsEnum(ScorecardType)
  type: ScorecardType;

  @ApiProperty({
    description: 'The challenge track associated with the scorecard',
    enum: ChallengeTrack,
  })
  @IsEnum(ChallengeTrack)
  challengeTrack: ChallengeTrack;

  @ApiProperty({ description: 'The challenge type', example: 'Code' })
  @IsString()
  @IsNotEmpty()
  challengeType: string;

  @ApiProperty({
    description: 'The name of the scorecard',
    example: 'Sample Scorecard',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'The version of the scorecard', example: '1.0' })
  @IsString()
  version: string;

  @ApiProperty({ description: 'The minimum score', example: 0 })
  @IsNumber()
  @Min(0)
  @IsSmallerThan('maxScore')
  minScore: number;

  @ApiProperty({ description: 'The maximum score', example: 100 })
  @IsNumber()
  @Max(100)
  @IsGreaterThan('minScore')
  maxScore: number;

  /**
   * These shouldn't be editable via API
   */
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
}

export class ScorecardBaseWithGroupsDto extends ScorecardBaseDto {
  scorecardGroups: any[];
}

export class ScorecardRequestDto extends ScorecardBaseWithGroupsDto {
  @ApiProperty({ description: 'The ID of the scorecard', example: 'abc123' })
  id: string;

  @ApiProperty({
    description: 'The list of groups associated with the scorecard',
    type: [ScorecardGroupRequestDto],
  })
  @IsArray()
  @ValidateNested({ each: true }) // validate each item in the array
  @Type(() => ScorecardGroupRequestDto)
  @WeightSum()
  scorecardGroups: ScorecardGroupRequestDto[];
}

export class ScorecardResponseDto extends ScorecardBaseDto {
  @ApiProperty({ description: 'The ID of the scorecard', example: 'abc123' })
  id: string;
}

function toArray<T = string>(value: unknown): T[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const asArray = Array.isArray(value) ? value : [value];
  return asArray
    .flatMap((v) => String(v).split(','))
    .map((s) => s.trim())
    .filter(Boolean) as T[];
}

export class SearchScorecardQuery {
  @IsOptional()
  @Transform(({ value }) => toArray<ChallengeTrack>(value))
  @IsArray()
  @IsEnum(ChallengeTrack, { each: true })
  challengeTrack?: ChallengeTrack[];

  @IsOptional()
  @Transform(({ value }) => toArray<string>(value))
  @IsArray()
  @IsString({ each: true })
  challengeType?: string[];

  @IsOptional()
  @Transform(({ value }) => toArray<$Enums.ScorecardStatus>(value))
  @IsArray()
  @IsEnum($Enums.ScorecardStatus, {
    each: true,
    message: (args) => `Invalid value "${args.value}" for "${args.property}".`,
  })
  status?: $Enums.ScorecardStatus[];

  @IsOptional()
  @Transform(({ value }) => toArray<$Enums.ScorecardType>(value))
  @IsArray()
  @IsEnum($Enums.ScorecardType, { each: true })
  scorecardType?: $Enums.ScorecardType[];

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  perPage: number = 10;
}

export class ScorecardWithGroupResponseDto extends ScorecardBaseDto {
  @ApiProperty({ description: 'The ID of the scorecard', example: 'abc123' })
  id: string;

  @ApiProperty({
    description: 'The list of groups associated with the scorecard',
    type: [ScorecardGroupResponseDto],
  })
  scorecardGroups: ScorecardGroupResponseDto[];
}

export class PaginationMetaDto {
  @ApiProperty({ example: 100 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 10 })
  perPage: number;

  @ApiProperty({ example: 10 })
  totalPages: number;
}

export class ScorecardPaginatedResponseDto {
  @ApiProperty({ description: 'This contains pagination metadata' })
  metadata: PaginationMetaDto;

  @ApiProperty({
    description: 'The list of score cards',
    type: [ScorecardGroupResponseDto],
  })
  scoreCards: ScorecardResponseDto[];
}
