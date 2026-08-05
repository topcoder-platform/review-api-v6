import { ApiProperty } from '@nestjs/swagger';

export class SubmissionAccessAuditResponseDto {
  @ApiProperty({ description: 'The ID of the submission' })
  submissionId: string;

  @ApiProperty({
    description:
      'When access was granted and a submission download URL was issued',
  })
  downloadedAt: Date;

  @ApiProperty({
    description:
      'Handle of the user (or M2M client) who requested the download',
  })
  handle: string;
}
