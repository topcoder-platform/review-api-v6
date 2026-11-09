import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const UPLOAD_PURPOSES = [
  'submission',
  'cv',
  'engagement',
  'review',
  'forum',
  'project',
  'showcase',
] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

export class CreateUploadDto {
  @IsIn(UPLOAD_PURPOSES)
  purpose: UploadPurpose;

  @IsString()
  @MaxLength(255)
  // Reject control characters in filenames before generating S3 keys and headers.
  // eslint-disable-next-line no-control-regex
  @Matches(/^[^\x00-\x1f\x7f/\\]+$/)
  filename: string;

  @IsString()
  @MaxLength(150)
  @Matches(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/)
  contentType: string;

  @IsInt()
  @Min(1)
  @Max(500 * 1024 * 1024)
  size: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-zA-Z0-9_-]+$/)
  contextId?: string;
}

export class SignUploadDto {
  @IsString()
  @MaxLength(4096)
  token: string;

  @IsIn(['PUT', 'POST', 'GET', 'DELETE'])
  method: 'PUT' | 'POST' | 'GET' | 'DELETE';

  @IsString()
  @MaxLength(1024)
  key: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  uploadId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  partNumber?: number;
}
