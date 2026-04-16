-- Support faster joins when filtering appeals by reviewId through reviewItemComment -> reviewItem
CREATE INDEX IF NOT EXISTS "reviewItem_reviewId_id_idx"
  ON "reviewItem"("reviewId", "id");

-- Support deterministic createdAt-ordered pagination for appeals
CREATE INDEX IF NOT EXISTS "appeal_createdAt_idx"
  ON "appeal"("createdAt");

-- Support resource-filtered appeals with createdAt ordering
CREATE INDEX IF NOT EXISTS "appeal_resourceId_createdAt_idx"
  ON "appeal"("resourceId", "createdAt");
