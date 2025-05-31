import { ApiProperty } from '@nestjs/swagger';

export class ResultDto<T> {
  @ApiProperty({
    description: 'success or fail',
    example: true,
  })
  success: boolean;

  @ApiProperty({
    description: 'status code',
    example: 200,
  })
  status: number;

  @ApiProperty({
    description: 'returned data',
  })
  content: T | null;
}

export class ResponseDto<T> {
  @ApiProperty({
    description: 'Api Response',
  })
  result: ResultDto<T>;
}

/**
 * Build successful response
 * @param data return data
 * @param status response status
 * @returns Response to return from API
 */
export const OkResponse = function <T>(
  data: T,
  status?: number,
): ResponseDto<T> {
  const ret = new ResponseDto<T>();
  const result = new ResultDto<T>();
  result.success = true;
  result.status = status ?? 200;
  result.content = data;
  ret.result = result;
  return ret;
};

/**
 * Build error response
 * @param message error message if any
 * @param status status code if any
 * @returns Error response to return from API
 */
export const FailResponse = function (
  message?: string,
  status?: number,
): ResponseDto<string> {
  const ret = new ResponseDto<string>();
  const result = new ResultDto<string>();
  result.success = true;
  result.status = status ?? 500;
  result.content = message ?? 'Internal Error';
  ret.result = result;
  return ret;
};
