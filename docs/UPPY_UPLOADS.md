# Uppy 6 uploads

Both web applications upload directly to the existing S3 buckets using `@uppy/aws-s3` 6.0.0. Review API signs the six S3 operations through `/v6/reviews/uploads`. AWS credentials never go to the browser.

1. Authenticated `POST /reviews/uploads/sessions` accepts `purpose`, `filename`, `contentType`, `size` and optional `contextId`. The server selects the bucket and a unique key, returning an upload grant, key, bucket, canonical URL and 10 MiB part size.
2. Authenticated `POST /reviews/uploads/sign` accepts that grant and Uppy's `{method, key, uploadId?, partNumber?}`. Grants expire after 24 hours, belong to one member and key, and cannot authorize arbitrary object reads or deletes. Each presigned operation expires after 15 minutes. PUTs sign the expected content length, including each multipart part.
3. Submission URLs stay canonical S3 URLs. The existing submission endpoint, authorization, hashing and virus scan pipeline remain responsible for submission records.
4. Other attachments receive a durable read-capability URL at `/reviews/uploads/files/:token`, which redirects to a five-minute S3 GET. Like the previous Filestack CDN handles, anyone given this URL can read that one file. This preserves existing Markdown, CV links and previews without making the bucket public. Treat these URLs as private when the containing resource is private. Upload grants cannot be used as read capabilities and submission files cannot receive these read capabilities. Active content is served as a download. Showcase files keep the existing CDN URL and project files keep their existing API-mediated download flow.

## Configuration

| Setting | Dev value / purpose |
| --- | --- |
| `SUBMISSION_DMZ_S3_BUCKET` | Existing `topcoder-dev-submissions-dmz` |
| `UPLOAD_ATTACHMENT_BUCKET` | `tc-challenge-v5-dev` for review, engagement and CV files |
| `UPLOAD_FORUM_BUCKET` | `tc-challenge-v5-dev` |
| `UPLOAD_PROJECT_BUCKET` | `submission-staging-dev` |
| `UPLOAD_SHOWCASE_BUCKET` | `topcoder-dev-showcase-media` |
| `UPLOAD_SHOWCASE_CDN_URL` | `https://showcase-media.topcoder-dev.com` |
| `UPLOAD_PUBLIC_API_URL` | `https://api.topcoder-dev.com/v6/reviews/uploads` |
| `UPLOAD_SIGNING_SECRET` | Persistent random secret, at least 32 bytes; retain across deploys |
| `AWS_REGION` | `us-east-1` |

Run `python3 deploy/configure-uploads-dev.py` with authorized dev AWS credentials to install the settings in SSM, append the required CORS rule and grant the existing task role access only to the new upload prefixes. The script refuses any other AWS account and preserves an existing signing secret. Inject the new SSM parameters into the ECS container's `secrets` list when deploying. Changing or losing the signing secret invalidates existing attachment links, so do not generate it at process startup or rotate it without a link migration.

CORS must allow PUT, POST, GET and DELETE and expose ETag for multipart uploads. Bucket public-access blocks remain enabled. Production must supply its own bucket settings and persistent signing secret; this dev helper does not change production.

CVs accept PDF/DOCX up to 8 MiB; submissions accept ZIPs up to 500 MiB; forums allow up to 25 MiB; other attachments allow up to 500 MiB. Validation of file contents and submission eligibility remains with the consuming API.

## Verification

`pnpm test -- --runInBand src/api/uploads/uploads.service.spec.ts` covers member authentication, grant tampering/expiry/ownership, bounded multipart signing, purpose-specific restrictions and download-capability separation. Browser verification must also exercise real S3 PUT, multipart completion, cancellation, and reads through the configured endpoint; mocked signing tests alone do not establish browser CORS compatibility.
