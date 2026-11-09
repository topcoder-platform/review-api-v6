import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Redirect,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtUser } from '../../shared/modules/global/jwt.service';
import { CreateUploadDto, SignUploadDto } from './uploads.dto';
import { UploadsService } from './uploads.service';

@ApiTags('Uploads')
@Controller('/reviews/uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('/sessions')
  @ApiBearerAuth()
  create(
    @Body() input: CreateUploadDto,
    @Req() req: Request & { user: JwtUser },
  ) {
    return this.uploads.create(input, req.user);
  }

  @Post('/sign')
  @ApiBearerAuth()
  sign(@Body() input: SignUploadDto, @Req() req: Request & { user: JwtUser }) {
    return this.uploads.sign(input, req.user);
  }

  @Get('/files/:token')
  @Header('Cache-Control', 'private, no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @Redirect()
  async download(@Param('token') token: string) {
    return { url: await this.uploads.download(token), statusCode: 302 };
  }
}
