# Keycloak M2M migration branch

This code is isolated on `keycloak_m2M`. Do not deploy this branch until the
workload and its callers are ready. Existing DEV services continue using Auth0.
The core dependency is pinned to a reviewed Keycloak prerelease commit, including
transitive wrapper uses through the pnpm override. No npm latest dependency is used.
`pnpm-lock.yaml` resolves a single 4.0.0-keycloak.1 (core commit `e844764`).

## Provider switch: `USE_KEYCLOAK`

`USE_KEYCLOAK=true` makes this service get its M2M tokens from Keycloak, using
`KEYCLOAK_TOKEN_URL`, `KEYCLOAK_AUDIENCE`, `KEYCLOAK_CLIENT_ID` and
`KEYCLOAK_CLIENT_SECRET` (optional `KEYCLOAK_SCOPE` narrows the client's defaults).
`KEYCLOAK_ISSUER` is also required. Unset or `false` restores the Auth0 behaviour from
before the migration: `M2MService` (bus events, resource and group lookups) uses
`M2M_AUTH_URL` (default `http://localhost:4000/oauth/token`), `M2M_AUTH_AUDIENCE`
(default `https://m2m.topcoder-dev.com/`), `M2M_AUTH_PROXY_SERVER_URL` (default
`M2M_AUTH_URL`), `M2M_AUTH_CLIENT_ID` and `M2M_AUTH_CLIENT_SECRET`.

`tc-core-library-js` reads the flag (`auth.useKeycloak`) and `M2MService` passes the
Auth0 settings to `auth.m2m`, so the service and the core always agree. Any value other
than `true`/`false` fails at startup. The Swagger M2M token example follows the flag
too. In DEV the flag is `/config/common/global-appvar/USE_KEYCLOAK`; the CircleCI deploy
already loads `/config/review-api-v6/appvar` and `/config/common/global-appvar`.

Incoming machine tokens: with `true`, Keycloak tokens are accepted, plus Auth0 tokens
while `LEGACY_M2M_ISSUERS`/`LEGACY_M2M_AUDIENCE` are set. With `false`, Auth0 tokens
are accepted through `LEGACY_M2M_*`, plus Keycloak tokens while `KEYCLOAK_ISSUER` and
`KEYCLOAK_AUDIENCE` are set, so callers that have not switched yet keep working.

**Rollback:** set `USE_KEYCLOAK=false` and force a new deployment so tasks re-read SSM.
No code or dependency change is needed. Keep the Auth0 settings above in SSM until
Keycloak has been accepted.

The DEV issuer is `https://keycloak.topcoder-dev.com/realms/topcoder-m2m-dev`,
audience `https://api.topcoder-dev.com`, and managed endpoint
`https://keycloak.topcoder-dev.com/m2m/token`.

Member sessions remain Auth0. Keep `VALID_ISSUERS` and `AUTH_SECRET` where legacy
member HMAC tokens are supported. Set `AUTH_USER_AUDIENCES` to a JSON array, or
explicitly retain existing user-token audience behavior with
`ALLOW_LEGACY_USER_AUDIENCE=true`. Never apply that exception to M2M tokens.
`LEGACY_M2M_ISSUERS` and `LEGACY_M2M_AUDIENCE` let Auth0 machine tokens pass the same
normalizer (see the provider switch above).

Outbound calls that use this service's M2M token need these client scopes (on the
Keycloak client, or the Auth0 client when `USE_KEYCLOAK` is not `true`):
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
scopes. Switch only after every downstream receiver accepts the issuer. The core never
retries a failed Keycloak request against Auth0; rolling back is the explicit
`USE_KEYCLOAK=false` change above.


The validator retains exact scopes; `ALL_SCOPE_MAPPINGS` remains explicit route policy.
Domain checks retain documented read/all and delete/all alternatives. Machine tokens
never acquire member roles or IDs. Existing domain machine privileges apply only
after route scopes authorize the request. Run `pnpm test:keycloak` after building.

Validation on 21 October 2026: Lint/build and four compiled authentication/scope checks pass. Full suite: 687 passed, five failed; the same five submission visibility/AI-phase query failures reproduce on unchanged baseline 196af5f0. The compiled adapter accepted a real DEV Keycloak token.

Validation on 23 October 2026 (USE_KEYCLOAK switch): lint/build and the four compiled checks pass; `m2m.service.spec.ts` proves `false`/unset selects the Auth0 `M2M_AUTH_*` settings and `true` the Keycloak provider. Full suite: 692 passed, the same five failures as the unchanged baseline a7feb62.
