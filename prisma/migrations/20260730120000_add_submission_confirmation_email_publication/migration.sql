-- Persist one recoverable confirmation request for each new member submission.
-- The table is intentionally empty after migration; historical submissions are
-- not backfilled or emailed without an explicit operational replay.
CREATE TABLE "submissionConfirmationEmail" (
    "submissionId" VARCHAR(14) NOT NULL,
    "processingStartedAt" TIMESTAMP(3),
    "processingToken" VARCHAR(36),
    "publishedAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "submissionConfirmationEmail_pkey" PRIMARY KEY ("submissionId")
);

CREATE INDEX "submissionConfirmationEmail_pending_idx"
ON "submissionConfirmationEmail"("publishedAt", "nextAttemptAt", "processingStartedAt", "createdAt");

ALTER TABLE "submissionConfirmationEmail"
ADD CONSTRAINT "submissionConfirmationEmail_submissionId_fkey"
FOREIGN KEY ("submissionId") REFERENCES "submission"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
