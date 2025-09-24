import {
  ApiHideProperty,
  ApiProperty,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsArray,
  ValidateNested,
  IsOptional,
  IsInt,
  IsDate,
  Min,
  IsUUID,
  Max,
  IsEmpty,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

const trimTransformer = ({ value }: { value: unknown }): string | undefined =>
  typeof value === 'string' ? value.trim() : undefined;

export class CreateAiWorkflowDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  llmId: string;

  @ApiProperty()
  @IsString()
  @Transform(trimTransformer)
  @IsNotEmpty()
  description: string;

  @ApiProperty()
  @IsString()
  @Transform(trimTransformer)
  @IsNotEmpty()
  defUrl: string;

  @ApiProperty()
  @IsString()
  @Transform(trimTransformer)
  @IsNotEmpty()
  gitId: string;

  @ApiProperty()
  @IsString()
  @Transform(trimTransformer)
  @IsNotEmpty()
  gitOwner: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  scorecardId: string;
}

export class UpdateAiWorkflowDto extends PartialType(CreateAiWorkflowDto) {}

export class CreateAiWorkflowRunDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  submissionId: string;

  @ApiProperty()
  @IsOptional()
  @IsDate()
  @IsNotEmpty()
  @Transform(({ value }) => new Date(value))
  startedAt?: Date;

  @ApiProperty()
  @IsOptional()
  @IsDate()
  @IsNotEmpty()
  @Transform(({ value }) => (value ? new Date(value) : undefined))
  completedAt?: Date;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  gitRunId: string;

  @ApiProperty()
  @IsNumber()
  @IsNotEmpty()
  @Min(0)
  @Max(100)
  @IsOptional()
  score?: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @Transform(trimTransformer)
  status: string;
}

export class UpdateAiWorkflowRunDto extends OmitType(
  PartialType(CreateAiWorkflowRunDto),
  ['submissionId'],
) {}

export class CreateAiWorkflowRunItemDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  scorecardQuestionId: string;

  @ApiProperty()
  @IsString()
  @Transform(trimTransformer)
  @IsNotEmpty()
  content: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  upVotes?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  downVotes?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  questionScore?: number;
}

export class CreateAiWorkflowRunItemsDto {
  @ApiProperty({ type: [CreateAiWorkflowRunItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateAiWorkflowRunItemDto)
  items: CreateAiWorkflowRunItemDto[];
}

export class CommentDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty()
  @IsString()
  @Transform(trimTransformer)
  @IsNotEmpty()
  content: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  parentId?: string;
}

export class UpdateAiWorkflowRunItemDto extends PartialType(
  CreateAiWorkflowRunItemDto,
) {
  @ApiHideProperty()
  @IsEmpty({ message: 'scorecardQuestionId cannot be updated' })
  scorecardQuestionId?: never;
}

export class CreateRunItemCommentDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  parentId?: string;
}

export class UpdateRunItemCommentDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  content?: string;

  @ApiProperty({ required: false })
  @IsInt()
  @IsOptional()
  upVotes?: number;

  @ApiProperty({ required: false })
  @IsInt()
  @IsOptional()
  downVotes?: number;

  @ApiHideProperty()
  @IsEmpty({ message: 'parentId cannot be updated' })
  parentId?: never;

  @ApiHideProperty()
  @IsEmpty({ message: 'userId cannot be updated' })
  userId?: never;

  @ApiHideProperty()
  @IsEmpty({ message: 'workflowRunItemId cannot be updated' })
  workflowRunItemId?: never;
}
