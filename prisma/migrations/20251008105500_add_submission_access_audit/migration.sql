-- CreateTable
CREATE TABLE "submissionAccessAudit" (
    "id" VARCHAR(36) NOT NULL DEFAULT gen_random_uuid(),
    "submissionId" VARCHAR(14) NOT NULL,
    "downloadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handle" TEXT NOT NULL,

    CONSTRAINT "submissionAccessAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "submissionAccessAudit_submissionId_idx" ON "submissionAccessAudit"("submissionId");

-- CreateIndex
CREATE INDEX "submissionAccessAudit_downloadedAt_idx" ON "submissionAccessAudit"("downloadedAt");

-- CreateIndex for efficient ordering within a submission
CREATE INDEX "submissionAccessAudit_submissionId_downloadedAt_idx" ON "submissionAccessAudit"("submissionId", "downloadedAt" DESC);

-- AddForeignKey
ALTER TABLE "submissionAccessAudit"
  ADD CONSTRAINT "submissionAccessAudit_submissionId_fkey"
  FOREIGN KEY ("submissionId") REFERENCES "submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

