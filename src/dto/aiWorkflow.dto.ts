import { ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, IsNotEmpty, IsDate, IsNumber } from 'class-validator';

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

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  createdBy: string;
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
  @Transform(({ value }) => new Date(value))
  completedAt: Date;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  gitRunId: string;

  @ApiProperty()
  @IsNumber()
  @IsNotEmpty()
  score: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  status: string;
}

export class UpdateAiWorkflowRunDto extends OmitType(PartialType(
  CreateAiWorkflowRunDto,
), ['submissionId']) {}
