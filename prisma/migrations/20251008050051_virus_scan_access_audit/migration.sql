-- DropIndex
DROP INDEX "submissionAccessAudit_submissionId_downloadedAt_idx";

-- CreateIndex
CREATE INDEX "submissionAccessAudit_submissionId_downloadedAt_idx" ON "submissionAccessAudit"("submissionId", "downloadedAt");
