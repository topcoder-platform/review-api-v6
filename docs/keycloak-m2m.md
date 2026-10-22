# Keycloak M2M migration branch

This code is isolated on `keycloak_m2M`. Do not deploy this branch until the
workload and its callers are ready. Existing DEV services continue using Auth0.
The core dependency is pinned to a reviewed Keycloak prerelease commit, including
transitive wrapper uses through the pnpm override. No npm latest dependency is used.

Required settings are `M2M_PROVIDER=keycloak`, `KEYCLOAK_ISSUER`,
`KEYCLOAK_AUDIENCE`, and `KEYCLOAK_TOKEN_URL`; issuing workloads additionally need
`KEYCLOAK_CLIENT_ID` and `KEYCLOAK_CLIENT_SECRET` from their own encrypted secret
references. Optional `KEYCLOAK_SCOPE` narrows the client's approved defaults.
The DEV issuer is `https://keycloak.topcoder-dev.com/realms/topcoder-m2m-dev`,
audience `https://api.topcoder-dev.com`, and managed endpoint
`https://keycloak.topcoder-dev.com/m2m/token`. Wait for the managed endpoint's
recorded deployment acceptance before enabling this configuration.

Member sessions remain Auth0. Keep `VALID_ISSUERS` and `AUTH_SECRET` where legacy
member HMAC tokens are supported. Set `AUTH_USER_AUDIENCES` to a JSON array, or
explicitly retain existing user-token audience behavior with
`ALLOW_LEGACY_USER_AUDIENCE=true`. Never apply that exception to M2M tokens.
During an approved overlap, `LEGACY_M2M_ISSUERS` and `LEGACY_M2M_AUDIENCE` allow
old Auth0 machine tokens to pass the same normalizer. Issuance remains Keycloak-only.

Outbound calls that use this service's M2M token need these client scopes:
- `write:bus_api` for bus events.
- `read:resources` for resource lookups.
- `read:groups` for member group lookups.

`ChallengeCatalogService` loads the public `/v6/challenge-types` and
`/v6/challenge-tracks` catalogs without a token, because Challenge API rejects machine
tokens on public routes that declare no scopes.

`tc-core-library-js` owns signature, issuer, audience, lifetime, and machine/user
classification. Service adapters must use its verified `kind`, `isMachine`, and
`scopes` rather than decode/reclassify claims. Scope guards delegate exact matching
to the library with explicit all/any policy. Existing business roles and documented
scope aliases remain endpoint policy; adding OAuth scopes to a user token never
grants machine access. No permissive fallback or synthetic token path is available.

Before rollout run this project's `nvm use`, `pnpm lint`, `pnpm build`, and targeted
authentication tests. Validate real authorized/unauthorized routes with both a
Keycloak service token and a member token, including wrong audiences and insufficient
scopes. Switch only after every downstream receiver accepts the issuer. Rollback
requires the prior application/dependency and credentials with equivalent grants;
never automatically retry issuance against Auth0.


The validator retains exact scopes; `ALL_SCOPE_MAPPINGS` remains explicit route policy.
Domain checks retain documented read/all and delete/all alternatives. Machine tokens
never acquire member roles or IDs. Existing domain machine privileges apply only
after route scopes authorize the request. Run `pnpm test:keycloak` after building.

Validation on 21 October 2026: Lint/build and four compiled authentication/scope checks pass. Full suite: 687 passed, five failed; the same five submission visibility/AI-phase query failures reproduce on unchanged baseline 196af5f0. The compiled adapter accepted a real DEV Keycloak token.
