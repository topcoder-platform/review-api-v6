# Review opportunities API

The opportunities UI can filter and page review work without downloading a
large client-side bucket. All routes below use the production `/v6` prefix.

## Search

`GET /review-opportunities/search` returns the standard response envelope:

```json
{
  "result": {
    "success": true,
    "status": 200,
    "content": [],
    "metadata": {
      "total": 0,
      "offset": 0,
      "limit": 10,
      "page": 1,
      "totalPages": 0
    }
  }
}
```

Supported query parameters are:

- `search`, repeated `challengeIds`;
- `paymentFrom`, `paymentTo`, `durationFrom`, `durationTo`, `startDateFrom`,
  `startDateTo`, `numSubmissionsFrom`, and `numSubmissionsTo`;
- repeated challenge `tracks`/`track` and `types`/`type`, by UUID or catalog
  name;
- repeated `opportunityTypes` values;
- repeated `status`/`statuses`; omission keeps the legacy `OPEN` default;
- `appliedByMe` and repeated `applicationStatuses`, which require a caller;
- `sortBy=basePayment|duration|startDate|openPositions`, `sortOrder`, `limit`
  (maximum 100), and zero-based `offset`.

Challenge-backed filters run in the challenge database; pagination and totals
run in the review database after active-challenge visibility filtering. That
visibility boundary enforces both `ChallengeUserWhitelist` and challenge group
membership. Anonymous users receive only ungrouped challenges, ordinary
members receive public challenges plus their complete groups-api ancestor tree,
and a groups-api failure hides restricted records rather than exposing them.
Task challenges are hidden from anonymous callers and require the member to
have a `MemberChallengeAccess` resource; Admin and M2M callers retain their
operational access. A resource holder also retains access to an assigned
group-restricted challenge, matching challenge-api-v6 self-resource searches.

An `OPEN` review opportunity is returned only while its linked challenge is
`ACTIVE`. `CLOSED` and `CANCELLED` filters preserve historical opportunities
after the linked challenge completes.

`GET /review-opportunities` accepts the same query but preserves its historical
bare-array response. Pagination is returned in CORS-exposed `X-Total-Count`,
`X-Page`, `X-Per-Page`, and `X-Total-Pages` headers.

## Caller eligibility and applications

Every opportunity item adds:

- `canApply`;
- `canApplyReason`: `CAN_APPLY`, `NOT_AUTHENTICATED`, `NOT_REVIEWER`,
  `OPPORTUNITY_CLOSED`, `CHALLENGE_NOT_ACTIVE`, `ALREADY_APPLIED`, or
  `NO_OPEN_POSITIONS`;
- `myApplications`, containing only the caller's applications;
- `approvedApplicationCount` and `remainingPositions`.
- `applicationRoles` and `defaultApplicationRole`, which let a one-click UI
  submit the correct specialized role for regular, scenarios, iterative,
  specification, or component-development review work.

Search/list responses include only the caller's application rows (or none for
anonymous callers), while `approvedApplicationCount` is calculated in the
database. This avoids downloading every applicant for every list card. The
single-opportunity detail route retains the complete application panel for the
explicit detail click.

Challenge card data for a result page is hydrated with one batch projection;
detail-only phases, workflows, metadata, and winners are loaded only when a
specific opportunity is opened.

The embedded `challengeData` object includes `name`, the legacy `title` alias,
and the challenge's Markdown `description`. Its `overview` alias contains the
same Markdown so the opportunities detail page can render the full brief with
one review-api request.

Only the exact `Reviewer` role produces `CAN_APPLY`. This supports the UI rule
that non-reviewers receive a disabled action and the “How to become a reviewer”
content.

`GET /review-opportunities/me` is authenticated, forces `appliedByMe=true`, and
returns the metadata envelope. `GET /review-applications/me` supports repeated
`statuses`, repeated `roles`, `opportunityId`, `page`, `perPage` (maximum 100),
and `sortOrder`; its metadata is `total`, `page`, `perPage`, and `totalPages`.

`POST /review-applications` remains compatible with
`{ "opportunityId": "...", "role": "REVIEWER" }`, while now failing closed
for a closed opportunity, inactive or inaccessible challenge, duplicate
application, or filled approved capacity. The database composite uniqueness
constraint on opportunity, member, and role is authoritative for concurrent
duplicate requests; the losing request receives the same HTTP 409 conflict as
a duplicate found by the pre-check. Applications are created as `PENDING`, so
they do not consume or overfill the approved-position capacity.
