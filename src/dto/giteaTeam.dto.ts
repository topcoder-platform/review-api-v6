import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class GiteaTeamSearchQueryDto {
  @ApiProperty({
    description: 'Free text matched against Gitea team names',
    example: 'reviewers',
  })
  @IsString()
  @IsNotEmpty()
  q: string;

  @ApiProperty({
    description: 'Maximum number of teams to return',
    default: 20,
    required: false,
    type: Number,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 20;
}

export class GiteaTeamResponseDto {
  @ApiProperty({
    description: 'The Gitea team id, used when syncing challenge registrants',
    example: 42,
  })
  id: number;

  @ApiProperty({
    description: 'The Gitea team name',
    example: 'reviewers',
  })
  name: string;

  @ApiProperty({
    description: 'The Gitea organization owning the team',
    example: 'topcoder',
  })
  organization: string;

  @ApiProperty({
    description: 'The Gitea team description',
    required: false,
    example: 'Reviewers with write access',
  })
  description?: string;
}
