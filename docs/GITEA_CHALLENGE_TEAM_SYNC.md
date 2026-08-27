# Gitea Challenge Team Sync

Challenge participants are automatically added to and removed from Gitea teams as
they register for and unregister from a challenge.

## Challenge configuration

Work Manager writes the configuration into challenge metadata under the `gitea`
key. The value is a JSON object holding a list of Gitea team references:

```json
{ "teams": [{"id": "string", "name": "string", "organization": "string"}] }
```

## Kafka topics

| Topic | Handler | Effect |
| --- | --- | --- |
| `challenge.action.resource.create` | `ChallengeResourceCreateHandler` | Adds the member to every configured team |
| `challenge.action.resource.delete` | `ChallengeResourceDeleteHandler` | Removes the member from every configured team |

Both topics are emitted by resource-api for every resource role. Only the roles
that take part in the challenge repositories trigger a Gitea sync:

- **Submitters**, recognized by the configured `SUBMITTER_ROLE_ID` so the common
  case needs no database lookup.
- **Reviewers**, recognized by resource role name. Reviewers are spread over
  several roles (reviewer, iterative reviewer, specification reviewer, failure
  reviewer, ...) whose ids differ per environment, so the role name is resolved
  from the resource database and matched against the fragments in
  `GITEA_TEAM_SYNC_ROLE_NAMES` (default `submitter,reviewer`). Resolved names are
  memoized, since resource roles are a static lookup table.

Every other role — copilots, managers, observers — is logged and ignored. The
topic names can be overridden with `RESOURCE_CREATE_TOPIC` and
`RESOURCE_DELETE_TOPIC`.

## Registration flow

The same flow runs whether the resource is a submitter registering for the
challenge or a reviewer being assigned to it.

1. Look up the registrant's handle in Gitea.
2. When the account is missing, create it with the member's email, a login name
   of `auth0|<userId>`, and the `Topcoder` authentication source
   (`GITEA_AUTH_SOURCE_ID`).
3. Add the handle to each configured team via `PUT /teams/{id}/members/{username}`.

Removing the resource — a member unregistering, or a reviewer being unassigned —
skips steps 1 and 2 and calls
`DELETE /teams/{id}/members/{username}` for each configured team.

## Error handling

Every team call is isolated: a failure on one team is logged with its HTTP status
and response body, and the remaining teams are still processed. Challenge lookup,
member email lookup and account provisioning failures are logged and end the sync
without throwing, so a misconfigured challenge never stalls the Kafka consumer.
Each run also logs a `<succeeded>/<total> teams updated` summary.
