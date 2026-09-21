# PM-6293: Public Marathon Match leaderboard

Marathon Match challenge details have always been readable without signing in,
but the scoreboard that makes them worth watching was not. `GET /submissions`
already served anonymous callers scoped to one challenge, while
`GET /reviewSummations` - the endpoint that carries every provisional and final
aggregate score - required a token and, for ordinary members, active
registration on the challenge. Marathon Match leaderboards and dashboards are
now public for the duration of the challenge.

## What changed

`TokenRolesGuard` keeps a small allowlist of `Controller.handler` names whose
challenge-scoped GET routes may run without a token:
`SubmissionController.listSubmissions` (already allowed) and
`ReviewSummationController.listReviewSummations`. The guard only confirms the
request is a GET carrying a non-empty `challengeId`; the service decides
whether that particular challenge may be read.

`ReviewSummationService.searchSummation` now routes every unprivileged caller -
anonymous visitors and signed-in members alike - through one gate,
`assertMarathonLeaderboardAccess`:

1. `challengeId` is required.
2. `ChallengeApiService.ensureChallengeWhitelistAccess` runs, so
   `ChallengeUserWhitelist` rows and challenge group restrictions are enforced
   before any score is disclosed. Anonymous callers fail this check for every
   private or group-restricted challenge.
3. The challenge must be a Marathon Match.

The previous registration requirement (`SUBMITTER_NOT_REGISTERED`, resolved
through the Resource API) is gone, which is the substance of this ticket: a
visitor who is merely curious about a running Marathon Match can now watch the
leaderboard progress. Because nothing else in this service used it,
`ResourceApiService` is no longer injected.

| Caller | Marathon Match | Other challenge types |
| --- | --- | --- |
| Anonymous, `challengeId` given | Summations for visible challenges | `SUBMITTER_NON_MARATHON_FORBIDDEN` |
| Anonymous, no `challengeId` | `SUBMITTER_CHALLENGE_ID_REQUIRED` | `SUBMITTER_CHALLENGE_ID_REQUIRED` |
| Signed-in member, unregistered | Summations for visible challenges | `SUBMITTER_NON_MARATHON_FORBIDDEN` |
| Admin, Copilot, machine token | Unchanged | Unchanged |

Error codes are unchanged so existing consumers keep matching on them; only the
messages were generalized away from submitter-specific wording.

`isAdmin` now accepts `null | undefined`. Its body already returned `false` for
a missing user; the type simply no longer forces a guard at every anonymous
call site.

## Scorer metadata stays private

`reviewSummation.metadata` carries per-seed test cases and per-test scores. A
contestant who could read it would be able to reverse engineer the test set, so
it is not member-facing and must never reach the new public audience.

Two layers enforce that, and neither depends on the caller being anonymous:

1. `metadata` is not selected from the database unless `includeMetadata` is
   true, so the seed never leaves Postgres.
2. `buildResponse` deletes `metadata` from every row unless the same flag is
   true, as a final guard on the way out.

`includeMetadata` requires `authUser.isMachine === true` **and** an explicit
`metadata=true` query parameter. `request['user']` is only ever populated by
`TokenValidatorMiddleware` from a cryptographically validated JWT, so
`isMachine` cannot be forged and an anonymous caller can never satisfy the
first condition. Anonymous visitors and signed-in members both get a response
with no `metadata` key whatever they pass.

The tab-delimited export derives its `score` and `testcase` columns from
`entry.metadata`, so for any caller without metadata those columns are blank.
Separately, the export walks every page of a challenge in a single request, so
it now requires an authenticated caller (`TSV_AUTHENTICATION_REQUIRED`) -
keeping it to the audience it had before Marathon Match leaderboards went
public, and keeping that unbounded work away from unauthenticated callers. This
applies to both ways of asking for it, the `text/tab-separated-values` Accept
header and `?format=tsv`.

## What did not change

Score rows themselves are unchanged. Anonymous `GET /submissions` responses
continue to have `review`, `reviewSummation`, and `url` stripped by
`applyReviewVisibilityFilters`, so the public leaderboard's score column is fed
by the challenge-level summations endpoint rather than by per-submission review
data. Private and group-restricted Marathon Matches remain invisible to
anonymous callers.

## Validation

- `src/api/review-summation/review-summation.service.spec.ts` covers anonymous
  reads, the missing-`challengeId` and non-Marathon rejections, a whitelist
  denial, and a signed-in member with no registration.
- `src/shared/guards/tokenRoles.guard.spec.ts` covers the allowlisted
  summation handler, the missing-`challengeId` rejection, and a controller
  outside the allowlist.
- The same service spec asserts that an anonymous visitor and a signed-in
  member each passing `metadata=true` get no `metadata` key, that `metadata` is
  never added to the Prisma `select`, and that the seed value appears nowhere
  in the serialized response.
- `src/api/review-summation/review-summation.controller.spec.ts` covers the
  anonymous TSV refusal through both the Accept header and `?format=tsv`, the
  anonymous JSON read still succeeding, blank `score`/`testcase` columns for a
  caller without metadata, and populated per-seed rows for a machine token.
