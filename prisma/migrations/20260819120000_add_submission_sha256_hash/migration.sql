-- Add SHA-256 content hash on submission for uploaded file identification.
ALTER TABLE "submission"
ADD COLUMN "sha256Hash" VARCHAR(64);

CREATE INDEX "submission_sha256Hash_idx" ON "submission"("sha256Hash");
