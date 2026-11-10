# File uploads have moved

Upload signing and attachment downloads are owned by [files-api-v6](https://github.com/topcoder-platform/files-api-v6). The public base is `/v6/uploads/files` on the existing API domain. Review API continues to own review and submission records.

Clients create an upload session and sign S3 operations through Files API, then submit the resulting file URL through the existing review/submission APIs. Legacy `/v6/reviews/uploads/...` URLs are handled by compatibility routing outside this application.

Runtime `UPLOAD_*` parameters belong under `/config/files-api-v6/appvar/`. Preserve the upload signing secret during migration so saved attachment links remain valid. AWS secrets and infrastructure definitions must remain outside Git.
