import { ApiProperty } from '@nestjs/swagger';

export class AppealResponseBaseDto {
  @ApiProperty({
    description: 'The resource ID associated with the appeal response',
    example: 'resource456',
  })
  resourceId: string;

  @ApiProperty({
    description: 'The content of the appeal response',
    example: 'This is the content of the appeal response.',
  })
  content: string;

  @ApiProperty({
    description: 'Whether the appeal was successful or not',
    example: true,
  })
  success: boolean;
}

export class AppealResponseRequestDto extends AppealResponseBaseDto {}

export class AppealResponseResponseDto extends AppealResponseBaseDto {
  @ApiProperty({
    description: 'The appeal ID associated with the response',
    example: 'appeal123',
  })
  appealId: string;

  @ApiProperty({
    description: 'The appeal response ID',
    example: 'appeal456',
    required: false,
  })
  id: string;

  @ApiProperty({
    description: 'The username of the person who created the appeal response',
    example: 'admin_user',
  })
  createdBy: string;

  @ApiProperty({
    description: 'The creation timestamp',
    example: '2023-10-01T00:00:00Z',
  })
  createdAt: Date;

  @ApiProperty({
    description:
      'The username of the person who last updated the appeal response (optional)',
    example: 'manager_user',
    required: false,
  })
  updatedBy?: string;

  @ApiProperty({
    description: 'The last update timestamp',
    example: '2023-10-01T00:00:00Z',
  })
  updatedAt?: Date;
}

export class AppealBaseDto {
  @ApiProperty({
    description: 'The resource ID associated with the appeal',
    example: 'resource123',
  })
  resourceId: string;

  @ApiProperty({
    description: 'The review item comment ID associated with the appeal',
    example: 'comment123',
  })
  reviewItemCommentId: string;

  @ApiProperty({
    description: 'The content of the appeal',
    example: 'This is the content of the appeal.',
  })
  content: string;
}

export class AppealRequestDto extends AppealBaseDto {}

export class AppealResponseDto extends AppealBaseDto {
  @ApiProperty({
    description: 'The appeal ID',
    example: 'appeal456',
    required: false,
  })
  id: string;

  @ApiProperty({
    description: 'The associated appeal response (optional)',
    type: AppealResponseResponseDto,
    required: false,
    example: null,
  })
  appealResponse?: AppealResponseResponseDto; // Optional appeal response for this appeal

  @ApiProperty({
    description: 'The username of the person who created the appeal',
    example: 'john_doe',
  })
  createdBy: string;

  @ApiProperty({
    description: 'The creation timestamp',
    example: '2023-10-01T00:00:00Z',
  })
  createdAt: Date;

  @ApiProperty({
    description:
      'The username of the person who last updated the appeal (optional)',
    example: 'jane_doe',
    required: false,
  })
  updatedBy?: string;

  @ApiProperty({
    description: 'The last update timestamp',
    example: '2023-10-01T00:00:00Z',
  })
  updatedAt?: Date;
}

export function mapAppealResponseRequestToDto(
  request: AppealResponseRequestDto,
) {
  // Only forward allowed fields; relation ID is set by Prisma in nested create
  return {
    resourceId: request.resourceId,
    content: request.content,
    success: request.success,
  };
}
