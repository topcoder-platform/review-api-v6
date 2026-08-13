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
run in the review database after active-challenge and whitelist filtering.

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
application, or filled approved capacity.
