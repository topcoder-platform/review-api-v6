-- CreateEnum
CREATE TYPE "SubmissionPreviewStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'MISSING', 'FAILED');

-- CreateTable
CREATE TABLE "submissionPreview" (
    "submissionId" VARCHAR(14) NOT NULL,
    "storageToken" UUID NOT NULL DEFAULT gen_random_uuid(),
    "status" "SubmissionPreviewStatus" NOT NULL DEFAULT 'PENDING',
    "objectKey" TEXT,
    "contentType" TEXT,
    "sizeBytes" INTEGER,
    "sourceETag" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "processingStartedAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "submissionPreview_pkey" PRIMARY KEY ("submissionId")
);

-- CreateIndex
CREATE INDEX "submissionPreview_retry_idx" ON "submissionPreview"("status", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "submissionPreview" ADD CONSTRAINT "submissionPreview_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
