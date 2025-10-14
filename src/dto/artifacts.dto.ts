import { ApiProperty } from '@nestjs/swagger';

export class ArtifactsCreateResponseDto {
  @ApiProperty({
    description: 'The ID of artifact',
    example: 'c56a4180-65aa-42ec-a945-5fd21dec0501',
  })
  artifacts: string;
}

export class ArtifactsListResponseDto {
  @ApiProperty({
    description: 'The ID of artifacts',
    example: ['c56a4180-65aa-42ec-a945-5fd21dec0501'],
  })
  artifacts: string[];
}
