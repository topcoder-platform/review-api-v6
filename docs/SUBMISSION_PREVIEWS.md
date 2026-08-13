# Design submission previews

Review API extracts an optional root-level `preview.jpg` or `preview.png` from
a Design submission ZIP after the submission passes Screening. Checkpoint
submissions use a passing Checkpoint Screening result. Review completion
best-effort enqueues a candidate without depending on challenge-api; the
scheduled worker verifies the Design track and performs S3 and ZIP work. A
bounded state reconciler also discovers passing submissions with no queue row,
so a transient enqueue failure or pre-pipeline Screening result is recovered
without rolling back the completed review.

## Processing and idempotency

`submissionPreview` stores one job per submission, a random storage token,
attempt count, lease timestamps, source ETag, destination key, media metadata,
and the latest diagnostic. Repeated completed-review events are safe. Multiple
API replicas claim work through an atomic database update, and a stale
15-minute processing lease can be reclaimed after a worker terminates.

Transient failures use exponential backoff for up to
`SUBMISSION_PREVIEW_MAX_ATTEMPTS`. A ZIP without either supported root file is
recorded as `MISSING`; unsafe and structurally invalid archives become terminal
`FAILED` jobs. Each claimed batch is processed sequentially to cap temporary
disk, network, and decompression pressure. Operators can inspect `lastError`
for a stable code and detail.

Before each retry batch, the worker scans at most
`SUBMISSION_PREVIEW_RECONCILE_BATCH_SIZE` active file submissions whose matching
Screening review is completed and passing but whose preview job is absent. It
uses a duplicate-safe bulk insert, making continuous backfill safe across
multiple replicas. A reconciliation outage is logged but does not block retry
of already-durable jobs.

Run migration `20260813100000_add_submission_preview` before deploying workers.

## ZIP and image safety

The source URL must resolve to `SUBMISSION_CLEAN_S3_BUCKET`; DMZ, quarantine,
and arbitrary URLs are rejected. The worker writes the bounded source stream to
a private temporary file and never extracts a member-supplied path to disk. It
validates every central-directory entry before reading the preview:

- absolute, drive-prefixed, NUL, and parent-traversal paths are rejected;
- encrypted entries are rejected;
- entry count, total expanded bytes, per-entry compression ratio, archive size,
  and preview size are bounded;
- duplicate preview candidates are rejected;
- only a root `preview.jpg` or `preview.png` is accepted;
- JPEG/PNG magic bytes must match the extension.

Temporary files use mode `0600` and are removed after every outcome.

## Storage configuration

The worker writes directly into the existing Payload media namespace. It does
not create a Payload `Media` document because submission previews are owned and
authorized by Review API rather than editorial content.

Required variables:

- `SUBMISSION_CLEAN_S3_BUCKET`
- `PAYLOAD_S3_BUCKET`
- `PAYLOAD_S3_PUBLIC_URL` (credential-free HTTPS origin)

Common optional variables and defaults:

- `PAYLOAD_S3_PREFIX=media`
- `SUBMISSION_PREVIEW_S3_PREFIX=submission-previews`
- `PAYLOAD_S3_REGION`, falling back to `AWS_REGION`
- `SUBMISSION_PREVIEW_RECONCILE_BATCH_SIZE=25` (maximum 250)
- the bounded size/count/retry variables listed in `.env.sample`

The ECS/task role needs `s3:GetObject` and `s3:HeadObject` on the clean
submission bucket, plus `s3:PutObject` on only the configured preview prefix in
the Payload bucket. The bucket policy should deny object listing to the public.
Uploaded keys contain a database-generated UUID that is not exposed before the
release gate.

## Public endpoint and release gate

`GET /v6/submissions/previews?challengeId={uuid}&page=1&perPage=20` is the
public-safe gallery endpoint used by Opportunities. It returns only released
preview cards as `{ data, meta: { page, perPage, totalCount, totalPages } }`;
each card includes the submission `id`, `type`, `submittedDate`, immutable
`previewUrl`, and a best-effort `submitterHandle`. It never exposes ZIP URLs,
scores, member email, queued jobs, missing preview state, or pre-release
screening outcomes. The protected general submission list remains unchanged.

`GET /v6/submissions/{submissionId}/preview` returns `302 Found` to the
immutable Payload asset URL only when all checks pass:

- the preview job is `READY`;
- the submission still has a completed, passing matching Screening review;
- the challenge is Design and visible to the caller under both the challenge
  user whitelist and challenge group membership rules;
- a contest submission's `Review` phase has an `actualEndTime` in the past, or
  a checkpoint submission's `Checkpoint Review` phase does.

Scheduled dates and `isOpen=false` alone do not release an image. Missing,
failed, unsupported, and not-yet-released states all return the same `404`
response with code `SUBMISSION_PREVIEW_NOT_AVAILABLE`, avoiding disclosure of
screening results. Whitelist denial returns `403`. The authorization redirect
is `private, no-store`; only the released asset URL uses immutable public
caching.
