-- Add composite indexes to improve My Reviews query performance

CREATE INDEX IF NOT EXISTS "review_resource_status_phase_idx"
  ON "reviews"."review"("resourceId", "status", "phaseId");

CREATE INDEX IF NOT EXISTS "appeal_response_appeal_resource_idx"
  ON "reviews"."appealResponse"("appealId", "resourceId");

CREATE INDEX IF NOT EXISTS "appeal_comment_resource_idx"
  ON "reviews"."appeal"("reviewItemCommentId", "resourceId");
