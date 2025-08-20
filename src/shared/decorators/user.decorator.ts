import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtUser } from '../modules/global/jwt.service';

export const User = createParamDecorator(
  (data: string, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;

    return (data ? user?.[data] : user) as JwtUser;
  },
);
