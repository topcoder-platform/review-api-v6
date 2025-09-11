import { ApiProperty, PartialType } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  IsOptional,
  IsInt,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

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
  @IsNotEmpty()
  description: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  defUrl: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  gitId: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  gitOwner: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  scorecardId: string;
}

export class UpdateAiWorkflowDto extends PartialType(CreateAiWorkflowDto) {}

export class CreateAiWorkflowRunItemDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  scorecardQuestionId: string;

  @ApiProperty()
  @IsString()
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
