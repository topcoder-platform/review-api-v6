import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsBooleanString,
} from 'class-validator';

export class ReviewTypeQueryDto {
  @ApiProperty({
    name: 'name',
    description: 'The review type name to filter by',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiProperty({
    name: 'isActive',
    description: 'The review type active flag to filter by',
    required: false,
  })
  @IsOptional()
  @IsBooleanString()
  isActive?: string;
}

export class ReviewTypeRequestDto {
  @ApiProperty({
    description: 'The review type name',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'The active flag for review type',
  })
  @IsBoolean()
  isActive: boolean;
}

export class ReviewTypeUpdateRequestDto {
  @ApiProperty({
    description: 'The review type name',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiProperty({
    description: 'The active flag for review type',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ReviewTypeResponseDto {
  @ApiProperty({
    description: 'The ID of the review type',
    example: 'c56a4180-65aa-42ec-a945-5fd21dec0501',
  })
  id: string;

  @ApiProperty({
    description: 'The review type name',
    example: 'Screening',
  })
  name: string;

  @ApiProperty({
    description: 'The active flag for review type',
    example: 'true',
  })
  isActive: boolean;
}
