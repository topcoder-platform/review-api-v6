# Gitea Challenge Team Sync

Challenge participants are automatically added to and removed from Gitea teams as
they register for and unregister from a challenge.

## Challenge configuration

Work Manager writes the configuration into challenge metadata under the `gitea`
key. The value is a JSON object holding a list of unique Gitea team ids:

```json
{ "teams": ["12", "34"] }
```

Team ids are not validated when the challenge is saved. Values that are not
positive integers, or that point at teams which no longer exist, are logged and
skipped here.

## Kafka topics

| Topic | Handler | Effect |
| --- | --- | --- |
| `challenge.action.resource.create` | `ChallengeResourceCreateHandler` | Adds the registrant to every configured team |
| `challenge.action.resource.delete` | `ChallengeResourceDeleteHandler` | Removes the registrant from every configured team |

Both topics are emitted by resource-api for every resource role. Only submitter
resources (`SUBMITTER_ROLE_ID`) trigger a Gitea sync; every other role is logged
and ignored. The topic names can be overridden with `RESOURCE_CREATE_TOPIC` and
`RESOURCE_DELETE_TOPIC`.

## Registration flow

1. Look up the registrant's handle in Gitea.
2. When the account is missing, create it with the member's email, a login name
   of `auth0|<userId>`, and the `Topcoder` authentication source
   (`GITEA_AUTH_SOURCE_ID`).
3. Add the handle to each configured team via `PUT /teams/{id}/members/{username}`.

Unregistration skips steps 1 and 2 and calls
`DELETE /teams/{id}/members/{username}` for each configured team.

## Error handling

Every team call is isolated: a failure on one team is logged with its HTTP status
and response body, and the remaining teams are still processed. Challenge lookup,
member email lookup and account provisioning failures are logged and end the sync
without throwing, so a misconfigured challenge never stalls the Kafka consumer.
Each run also logs a `<succeeded>/<total> teams updated` summary.
