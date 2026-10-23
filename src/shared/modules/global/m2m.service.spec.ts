/* eslint-disable @typescript-eslint/no-require-imports */
const saved = { ...process.env };

const auth0Env = {
  M2M_AUTH_URL: 'https://tenant.example/oauth/token',
  M2M_AUTH_AUDIENCE: 'https://m2m.example/',
  M2M_AUTH_PROXY_SERVER_URL: 'https://proxy.example/token',
  M2M_AUTH_CLIENT_ID: 'auth0-review',
  M2M_AUTH_CLIENT_SECRET: 'auth0-secret',
};
const auth0Options = {
  AUTH0_URL: auth0Env.M2M_AUTH_URL,
  AUTH0_AUDIENCE: auth0Env.M2M_AUTH_AUDIENCE,
  AUTH0_PROXY_SERVER_URL: auth0Env.M2M_AUTH_PROXY_SERVER_URL,
  AUTH0_CLIENT_ID: 'auth0-review',
  AUTH0_CLIENT_SECRET: 'auth0-secret',
};

/**
 * Load M2MService fresh with the given environment, replacing the core's Keycloak and
 * Auth0 token factories with fakes so the real `USE_KEYCLOAK` selection is observed.
 * Returns the service and both factory mocks.
 */
function load(env: Record<string, string | undefined>) {
  process.env = { ...saved, ...auth0Env, ...env };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
  }
  const keycloak = jest.fn(() => ({
    getMachineToken: jest.fn().mockResolvedValue('keycloak-token'),
  }));
  const auth0 = jest.fn(() => ({
    getMachineToken: jest.fn().mockResolvedValue('auth0-token'),
  }));
  let service: any;
  jest.isolateModules(() => {
    jest.doMock('tc-core-library-js/lib/keycloak/m2m', () => keycloak);
    jest.doMock('tc-core-library-js/lib/keycloak/auth0-m2m', () => auth0);
    const { M2MService } = require('./m2m.service');
    service = new M2MService();
  });
  return { service, keycloak, auth0 };
}

describe('M2MService USE_KEYCLOAK provider selection', () => {
  afterEach(() => {
    process.env = { ...saved };
    jest.dontMock('tc-core-library-js/lib/keycloak/m2m');
    jest.dontMock('tc-core-library-js/lib/keycloak/auth0-m2m');
  });

  it('uses the M2M_AUTH_* Auth0 settings when USE_KEYCLOAK=false', async () => {
    const { service, keycloak, auth0 } = load({ USE_KEYCLOAK: 'false' });

    expect(keycloak).not.toHaveBeenCalled();
    expect(auth0).toHaveBeenCalledWith(auth0Options);
    await expect(service.getM2MToken()).resolves.toBe('auth0-token');
    const provider = auth0.mock.results[0].value;
    expect(provider.getMachineToken).toHaveBeenCalledWith();
  });

  it('defaults to Auth0 with the pre-migration defaults when USE_KEYCLOAK and M2M_AUTH_* are unset', () => {
    const { auth0, keycloak } = load({
      USE_KEYCLOAK: undefined,
      M2M_AUTH_URL: undefined,
      M2M_AUTH_AUDIENCE: undefined,
      M2M_AUTH_PROXY_SERVER_URL: undefined,
    });

    expect(keycloak).not.toHaveBeenCalled();
    expect(auth0).toHaveBeenCalledWith({
      ...auth0Options,
      AUTH0_URL: 'http://localhost:4000/oauth/token',
      AUTH0_AUDIENCE: 'https://m2m.topcoder-dev.com/',
      AUTH0_PROXY_SERVER_URL: undefined,
    });
  });

  it('uses the Keycloak provider and its KEYCLOAK_* defaults when USE_KEYCLOAK=true', async () => {
    const { service, keycloak, auth0 } = load({ USE_KEYCLOAK: 'true' });

    expect(auth0).not.toHaveBeenCalled();
    expect(keycloak).toHaveBeenCalledTimes(1);
    const [options] = keycloak.mock.calls[0] as unknown as [object];
    expect(
      Object.keys(options).some((key) => key.startsWith('KEYCLOAK_')),
    ).toBe(false);
    await expect(service.getM2MToken()).resolves.toBe('keycloak-token');
    const provider = keycloak.mock.results[0].value;
    expect(provider.getMachineToken).toHaveBeenCalledWith();
  });

  it('fails fast for an invalid USE_KEYCLOAK value', () => {
    expect(() => load({ USE_KEYCLOAK: 'yes' })).toThrow(TypeError);
  });
});
