import { ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsDate,
} from 'class-validator';
import { Transform } from 'class-transformer';

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
  @IsDate()
  @IsNotEmpty()
  @Transform(({ value }) => new Date(value))
  startedAt: Date;

  @ApiProperty()
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
  @IsOptional()
  score?: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  status: string;
}

export class UpdateAiWorkflowRunDto extends OmitType(
  PartialType(CreateAiWorkflowRunDto),
  ['submissionId'],
) {}
