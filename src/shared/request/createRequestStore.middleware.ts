import { Injectable, NestMiddleware } from '@nestjs/common';
import { Response, NextFunction } from 'express';
import { RequestMetadata, saveStore } from './requestStore';

@Injectable()
export class CreateRequestStoreMiddleware implements NestMiddleware {
  constructor() {}

  use(req: any, res: Response, next: NextFunction) {
    const requestUserId = req['user']
      ? req['user'].isMachine
        ? 'System'
        : `${req['user'].userId}`
      : undefined;
    const requestMetaData = new RequestMetadata({ userId: requestUserId });

    saveStore(requestMetaData, next);
  }
}
