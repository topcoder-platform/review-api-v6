-- CreateIndex
CREATE INDEX "appeal_response_appeal_resource_idx" ON "appealResponse"("appealId", "resourceId");

-- CreateIndex
CREATE INDEX "review_resource_status_phase_idx" ON "review"("resourceId", "status", "phaseId");

-- Clean up orphaned reviewSummations before enforcing FK
UPDATE "reviewSummation" rs
SET "scorecardId" = NULL
WHERE "scorecardId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "scorecard" sc
    WHERE sc."id" = rs."scorecardId"
  );

-- AddForeignKey
ALTER TABLE "reviewSummation" ADD CONSTRAINT "reviewSummation_scorecardId_fkey" FOREIGN KEY ("scorecardId") REFERENCES "scorecard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
