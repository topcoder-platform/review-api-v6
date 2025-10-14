import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional } from 'class-validator';

const ORDER_STRINGS = ['asc', 'desc', 'ASC', 'DESC'];

export class SortDto {
  @ApiProperty({
    description: 'orderBy parameter',
    required: false,
    type: String,
  })
  @IsOptional()
  @IsIn(ORDER_STRINGS)
  orderBy?: 'asc' | 'desc' | 'ASC' | 'DESC';

  @ApiProperty({
    description: 'sortBy parameter',
    required: false,
    type: String,
  })
  @IsOptional()
  @IsNotEmpty()
  sortBy?: string;
}
