import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsDateString, IsNumber } from 'class-validator';

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

  @ApiProperty({ required: false })
  updatedBy?: string;

  @ApiProperty({ required: false })
  updatedAt?: Date;
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
  startedAt: Date;

  @ApiProperty()
  @IsDateString()
  @IsNotEmpty()
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
