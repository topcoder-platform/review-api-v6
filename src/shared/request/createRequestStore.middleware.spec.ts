import { CreateRequestStoreMiddleware } from './createRequestStore.middleware';
import { getStore, RequestMetadata } from './requestStore';

describe('CreateRequestStoreMiddleware', () => {
  /** Runs the middleware and returns the store visible to downstream handlers. */
  const storeFor = (user?: Record<string, unknown>): RequestMetadata => {
    let captured: RequestMetadata | undefined;
    new CreateRequestStoreMiddleware().use({ user }, {} as any, () => {
      captured = getStore();
    });
    return captured as RequestMetadata;
  };

  it('stores the client identity for machine callers', () => {
    const store = storeFor({
      isMachine: true,
      userId: 'client-app-id@clients',
      clientId: 'client-app-id',
    });

    expect(store.userId).toBe('client-app-id@clients');
  });

  it('falls back to System for a machine token without any identity', () => {
    expect(storeFor({ isMachine: true }).userId).toBe('System');
  });

  it('stores the member ID for human callers', () => {
    const store = storeFor({
      isMachine: false,
      userId: '42',
      clientId: 'browser-app-id',
    });

    expect(store.userId).toBe('42');
  });

  it('stores no actor for anonymous requests', () => {
    expect(storeFor(undefined).userId).toBeUndefined();
  });
});
