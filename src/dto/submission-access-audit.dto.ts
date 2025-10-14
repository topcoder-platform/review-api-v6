import { ApiProperty } from '@nestjs/swagger';

export class SubmissionAccessAuditResponseDto {
  @ApiProperty({ description: 'The ID of the submission' })
  submissionId: string;

  @ApiProperty({ description: 'When the submission was downloaded' })
  downloadedAt: Date;

  @ApiProperty({
    description: 'Handle of the user (or M2M client) who downloaded',
  })
  handle: string;
}
