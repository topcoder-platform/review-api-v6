import { AsyncLocalStorage } from 'async_hooks';
import { NextFunction } from 'express';
import { nanoid } from 'nanoid';

// Class for storing request specific metadata
export class RequestMetadata {
  requestId: string;
  userId?: string;

  constructor(params: { requestId?: string; userId?: string }) {
    this.requestId = params.requestId ?? nanoid(11);
    this.userId = params.userId;
  }
}

// Create a AsyncLocalStorage of type RequestMetaData for storing request specific data
const asyncStorage = new AsyncLocalStorage<RequestMetadata>();

// Gets the RequestMetadada object associated with the current request
export function getStore(): RequestMetadata {
  let store = asyncStorage.getStore();
  if (store === undefined) {
    store = new RequestMetadata({
      requestId: '',
    });
  }

  return store;
}

// For use in middleware
// Saves RequestMetadata for the current request
export function saveStore(
  requestMetaData: RequestMetadata,
  next: NextFunction,
) {
  asyncStorage.run(requestMetaData, () => {
    next();
  });
}
