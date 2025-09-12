import { ApiProperty, PartialType } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsDateString,
  IsNumber,
  IsOptional,
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
  @IsDateString()
  @IsNotEmpty()
  startedAt: string;

  @ApiProperty()
  @IsDateString()
  @IsNotEmpty()
  @IsOptional()
  completedAt?: string;

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
