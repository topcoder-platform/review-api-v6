import { ApiProperty } from '@nestjs/swagger';

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
  @ApiProperty({ description: 'The type of the question', enum: QuestionType })
  type: QuestionType;

  @ApiProperty({
    description: 'The description of the question',
    example: 'What is the challenge?',
  })
  description: string;

  @ApiProperty({
    description: 'Guidelines for the question',
    example: 'Provide detailed information.',
  })
  guidelines: string;

  @ApiProperty({ description: 'The weight of the question', example: 10 })
  weight: number;

  @ApiProperty({
    description: 'Indicates whether the question requires an upload',
    example: true,
  })
  requiresUpload: boolean;

  @ApiProperty({
    description: 'Minimum scale value (if applicable)',
    example: 0,
    required: false,
  })
  scaleMin?: number;

  @ApiProperty({
    description: 'Maximum scale value (if applicable)',
    example: 9,
    required: false,
  })
  scaleMax?: number;
}

export class ScorecardQuestionRequestDto extends ScorecardQuestionBaseDto {}

export class ScorecardQuestionResponseDto extends ScorecardQuestionBaseDto {
  @ApiProperty({ description: 'The ID of the question', example: 'q123' })
  id: string;
}

export class ScorecardSectionBaseDto {
  @ApiProperty({
    description: 'The name of the section',
    example: 'Technical Skills',
  })
  name: string;

  @ApiProperty({ description: 'The weight of the section', example: 20 })
  weight: number;

  @ApiProperty({ description: 'Sort order of the section', example: 1 })
  sortOrder: number;

  questions: any[];
}

export class ScorecardSectionRequestDto extends ScorecardSectionBaseDto {
  @ApiProperty({
    description: 'The list of questions within this section',
    type: [ScorecardQuestionRequestDto],
  })
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
  @ApiProperty({ description: 'The name of the group', example: 'Group A' })
  name: string;

  @ApiProperty({ description: 'The weight of the group', example: 30 })
  weight: number;

  @ApiProperty({ description: 'Sort order of the group', example: 1 })
  sortOrder: number;

  sections: any[];
}
export class ScorecardGroupRequestDto extends ScorecardGroupBaseDto {
  @ApiProperty({
    description: 'The list of sections within this group',
    type: [ScorecardSectionRequestDto],
  })
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
  status: ScorecardStatus;

  @ApiProperty({
    description: 'The type of the scorecard',
    enum: ScorecardType,
  })
  type: ScorecardType;

  @ApiProperty({
    description: 'The challenge track associated with the scorecard',
    enum: ChallengeTrack,
  })
  challengeTrack: ChallengeTrack;

  @ApiProperty({ description: 'The challenge type', example: 'Code' })
  challengeType: string;

  @ApiProperty({
    description: 'The name of the scorecard',
    example: 'Sample Scorecard',
  })
  name: string;

  @ApiProperty({ description: 'The version of the scorecard', example: '1.0' })
  version: string;

  @ApiProperty({ description: 'The minimum score', example: 0 })
  minScore: number;

  @ApiProperty({ description: 'The maximum score', example: 100 })
  maxScore: number;

  @ApiProperty({
    description: 'The creation timestamp',
    example: '2023-10-01T00:00:00Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'The user who created the scorecard',
    example: 'user123',
  })
  createdBy: string;

  @ApiProperty({
    description: 'The last update timestamp',
    example: '2023-10-01T00:00:00Z',
  })
  updatedAt: Date;

  @ApiProperty({
    description: 'The user who last updated the scorecard',
    example: 'user456',
  })
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
  scorecardGroups: ScorecardGroupRequestDto[];
}

export class ScorecardResponseDto extends ScorecardBaseDto {
  @ApiProperty({ description: 'The ID of the scorecard', example: 'abc123' })
  id: string;
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

export class ScorecardQueryDto {
  challengeTrack?: ChallengeTrack[];
  challengeType?: string[];
  name?: string;
  page?: number;
  perPage?: number;
}

export function mapScorecardRequestToDto(request: ScorecardRequestDto) {
  const userFields = {
    createdBy: request.createdBy,
    updatedBy: request.updatedBy,
  };

  return {
    ...request,
    ...userFields,
    scorecardGroups: {
      create: request.scorecardGroups.map((group) => ({
        ...group,
        ...userFields,
        sections: {
          create: group.sections.map((section) => ({
            ...section,
            ...userFields,
            questions: {
              create: section.questions.map((question) => ({
                ...question,
                sortOrder: 1,
                ...userFields,
              })),
            },
          })),
        },
      })),
    },
  };
}
