import { Injectable, NestMiddleware } from '@nestjs/common';
import { Response, NextFunction } from 'express';
import { resolveAuditActor } from '../modules/global/jwt.service';
import { RequestMetadata, saveStore } from './requestStore';

@Injectable()
export class CreateRequestStoreMiddleware implements NestMiddleware {
  constructor() {}

  use(req: any, res: Response, next: NextFunction) {
    const user = req['user'];
    // Machine callers are audited as `<clientId>@clients`; `System` remains
    // only for a machine token that carries no client identity at all.
    const requestUserId = user
      ? user.isMachine
        ? (resolveAuditActor(user) ?? 'System')
        : `${user.userId}`
      : undefined;
    const requestMetaData = new RequestMetadata({ userId: requestUserId });

    saveStore(requestMetaData, next);
  }
}
