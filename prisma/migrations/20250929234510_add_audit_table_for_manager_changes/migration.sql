-- CreateTable
CREATE TABLE "reviewAudit" (
    "id" VARCHAR(36) NOT NULL DEFAULT gen_random_uuid(),
    "reviewId" VARCHAR(36) NOT NULL,
    "submissionId" VARCHAR(14),
    "challengeId" TEXT,
    "actorId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviewAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reviewAudit_reviewId_idx" ON "reviewAudit"("reviewId");

-- CreateIndex
CREATE INDEX "reviewAudit_submissionId_idx" ON "reviewAudit"("submissionId");

-- AddForeignKey
ALTER TABLE "reviewAudit" ADD CONSTRAINT "reviewAudit_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviewAudit" ADD CONSTRAINT "reviewAudit_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
