-- Add a composite index to speed up paginated lookups by review item
CREATE INDEX IF NOT EXISTS "reviewItemComment_reviewItemId_sortOrder_id_idx"
  ON "reviews"."reviewItemComment"("reviewItemId", "sortOrder", "id");
