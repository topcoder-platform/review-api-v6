import { ApiProperty } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsEnum,
  IsIn,
  IsNotEmpty,
} from 'class-validator';
import { Transform } from 'class-transformer';

const trimTransformer = ({ value }: { value: unknown }): string | undefined =>
  typeof value === 'string' ? value.trim() : undefined;

export enum AiReviewDecisionEscalationStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export class CreateAiReviewEscalationDto {
  @ApiProperty({
    description:
      'Escalation notes / reason (required when creating as Reviewer)',
    required: false,
    example: 'Evidence suggests the submission meets the bar; see comment thread.',
  })
  @IsOptional()
  @IsString()
  @Transform(trimTransformer)
  escalationNotes?: string;

  @ApiProperty({
    description:
      'Approver notes (required when creating as Admin/Copilot or when updating)',
    required: false,
    example: 'Approved after manual review.',
  })
  @IsOptional()
  @IsString()
  @Transform(trimTransformer)
  approverNotes?: string;
}

export class UpdateAiReviewEscalationDto {
  @ApiProperty({
    description: 'Approver notes (required for Admin/Copilot when reacting to escalation)',
    example: 'Approved after manual review.',
  })
  @IsString()
  @Transform(trimTransformer)
  @IsNotEmpty({ message: 'approverNotes is required' })
  approverNotes: string;

  @ApiProperty({
    description: 'New escalation status',
    enum: [AiReviewDecisionEscalationStatus.APPROVED, AiReviewDecisionEscalationStatus.REJECTED],
  })
  @IsIn([AiReviewDecisionEscalationStatus.APPROVED, AiReviewDecisionEscalationStatus.REJECTED], {
    message: 'status must be APPROVED or REJECTED',
  })
  status: AiReviewDecisionEscalationStatus.APPROVED | AiReviewDecisionEscalationStatus.REJECTED;
}

export class AiReviewDecisionEscalationResponseDto {
  @ApiProperty({ description: 'Escalation ID' })
  id: string;

  @ApiProperty({ description: 'AI review decision ID' })
  aiReviewDecisionId: string;

  @ApiProperty({
    description: 'Escalation notes from reviewer',
    required: false,
    nullable: true,
  })
  escalationNotes: string | null;

  @ApiProperty({
    description: 'Approver notes',
    required: false,
    nullable: true,
  })
  approverNotes: string | null;

  @ApiProperty({
    description: 'Escalation status',
    enum: AiReviewDecisionEscalationStatus,
  })
  status: AiReviewDecisionEscalationStatus;

  @ApiProperty({ description: 'Created at' })
  createdAt: Date;

  @ApiProperty({
    description: 'User ID that created the record',
    required: false,
    nullable: true,
  })
  createdBy: string | null;

  @ApiProperty({ description: 'Updated at' })
  updatedAt: Date;

  @ApiProperty({
    description: 'User ID that last updated the record',
    required: false,
    nullable: true,
  })
  updatedBy: string | null;
}
