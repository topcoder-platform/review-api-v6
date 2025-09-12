import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class ContactRequestBaseDto {
  @ApiProperty({ description: 'The ID of the resource', example: 'user123' })
  @IsString()
  resourceId: string;

  @ApiProperty({
    description: 'The associated challenge ID',
    example: 'challenge456',
  })
  @IsString()
  challengeId: string;

  @ApiProperty({
    description: 'The message content',
    example: 'I have a question regarding the challenge rules.',
  })
  @IsString()
  message: string;
}

export class ContactRequestDto extends ContactRequestBaseDto {}

export class ContactRequestResponseDto extends ContactRequestBaseDto {
  @ApiProperty({
    description: 'The ID of the contact request',
    example: 'abc123',
  })
  id: string;
}
