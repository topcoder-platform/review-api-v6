import { UnauthorizedException } from '@nestjs/common';
import { generateKeyPairSync } from 'node:crypto';
import { createRequire } from 'node:module';
import * as jwt from 'jsonwebtoken';
import { AuthConfig } from '../../config/auth.config';
import { JwtService } from './jwt.service';

jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn().mockResolvedValue({ status: 200 }) } }));

const secret = 'shared-service-test-secret-at-least-32-bytes';
const issuer = 'https://auth.topcoder-dev.com/';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const sharedRequire = createRequire(require.resolve('tc-core-library-js'));
const { JwksClient } = sharedRequire('jwks-rsa') as {
  JwksClient: { prototype: { getSigningKey(kid: string): Promise<{ getPublicKey(): string }> } };
};

describe('shared JWT audience configuration', () => {
  const originalEnv = process.env;
  const originalSecret = AuthConfig.authSecret;
  const originalIssuers = AuthConfig.validIssuers;
  beforeEach(() => {
    process.env = { ...originalEnv, JWT_AUDIENCE: 'browser-client', AUTH0_AUDIENCE: 'machine-api' };
    AuthConfig.authSecret = secret;
    AuthConfig.validIssuers = JSON.stringify([issuer]);
    // Keep real JWT verification; substitute only the trusted public-key lookup.
    jest.spyOn(JwksClient.prototype, 'getSigningKey').mockResolvedValue({
      getPublicKey: () => publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    });
  });
  afterEach(() => {
    process.env = originalEnv;
    AuthConfig.authSecret = originalSecret;
    AuthConfig.validIssuers = originalIssuers;
    jest.restoreAllMocks();
  });

  /** Runs a signed JWT through the actual service adapter and released core.
   * @param token Compact JWT. @returns Verified service identity or a rejected authentication promise.
   */
  function validate(token: string) {
    const service = new JwtService();
    service.onModuleInit();
    return service.validateToken(token);
  }

  it('accepts the separate browser audience', async () => {
    const token = jwt.sign({ sub: 'user', userId: '42', roles: ['User'], handle: 'tester' }, privateKey, { algorithm: 'RS256', keyid: 'test-key', issuer, audience: 'browser-client', expiresIn: 300 });
    await expect(validate(token)).resolves.toMatchObject({ isMachine: false });
  });

  it('accepts an M2M token with the API audience', async () => {
    const token = jwt.sign({ sub: 'client@clients', gty: 'client-credentials', scope: 'read:challenges' }, privateKey, { algorithm: 'RS256', keyid: 'test-key', issuer, audience: 'machine-api', expiresIn: 300 });
    await expect(validate(token)).resolves.toMatchObject({ isMachine: true });
  });

  it.each(['untrusted-api', 'browser-client'])('rejects an M2M token addressed to %s', async (audience) => {
    const token = jwt.sign({ sub: 'client@clients', gty: 'client-credentials' }, privateKey, { algorithm: 'RS256', keyid: 'test-key', issuer, audience, expiresIn: 300 });
    await expect(validate(token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a human token with an untrusted audience', async () => {
    const token = jwt.sign({ userId: '42', roles: ['User'] }, privateKey, { algorithm: 'RS256', keyid: 'test-key', issuer, audience: 'untrusted-api', expiresIn: 300 });
    await expect(validate(token)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
