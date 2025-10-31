-- Improve review lookups that combine submission/phase filters with ordering
CREATE INDEX "review_submissionId_id_idx" ON "review"("submissionId", "id");
CREATE INDEX "review_phaseId_id_idx" ON "review"("phaseId", "id");
