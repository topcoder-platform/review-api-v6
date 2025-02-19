import { ApiProperty } from '@nestjs/swagger';

export class ContactRequestBaseDto {
  @ApiProperty({ description: 'The ID of the resource', example: 'user123' })
  resourceId: string;

  @ApiProperty({
    description: 'The associated challenge ID',
    example: 'challenge456',
  })
  challengeId: string;

  @ApiProperty({
    description: 'The message content',
    example: 'I have a question regarding the challenge rules.',
  })
  message: string;
}

export class ContactRequestDto extends ContactRequestBaseDto {}

export class ContactRequestResponseDto extends ContactRequestBaseDto {
  @ApiProperty({
    description: 'The ID of the contact request',
    example: 'abc123',
  })
  id: string;

  @ApiProperty({
    description: 'The user who created the request',
    example: 'user123',
  })
  createdBy: string;

  @ApiProperty({
    description: 'The timestamp when the request was created',
    example: '2023-02-10T00:00:00Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'The timestamp when the request was last updated',
    example: '2023-02-10T00:00:00Z',
  })
  updatedAt: Date;

  @ApiProperty({
    description: 'The user who last updated the request',
    example: 'user456',
  })
  updatedBy: string;
}

export const mockContactRequestResponse: ContactRequestResponseDto = {
  id: 'contact123',
  resourceId: 'resourceId',
  challengeId: 'challengeId',
  message: 'I have a question regarding the challenge rules.',
  createdBy: 'user123',
  createdAt: new Date(),
  updatedBy: 'user456',
  updatedAt: new Date(),
};
