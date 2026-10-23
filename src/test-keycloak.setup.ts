// Unit tests use synthetic settings only; runtime deployment must opt in separately.
Object.assign(process.env, {
  USE_KEYCLOAK: 'true',
  KEYCLOAK_ISSUER: 'https://keycloak.example.test/realms/test',
  KEYCLOAK_AUDIENCE: 'https://api.example.test',
  KEYCLOAK_TOKEN_URL: 'https://keycloak.example.test/m2m/token',
  KEYCLOAK_CLIENT_ID: 'm2m-test',
  KEYCLOAK_CLIENT_SECRET: 'synthetic-test-secret',
  ALLOW_LEGACY_USER_AUDIENCE: 'true',
});
