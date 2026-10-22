-- Keep the pending-appeal summary refresh proportional to one reviewer's rows.
-- appeal_pending_maintainer and appeal_response_pending_maintainer call this
-- function inside the INSERT/UPDATE/DELETE that fires them. When row estimates
-- for reviewItem/reviewItemComment are poor, the planner starts from the whole
-- appeal table, which made a single appeal response INSERT take 45+ seconds in
-- production and the Review app report a 504 after the response was saved.
--
-- The function-level settings apply only while this function runs:
--   join_collapse_limit = 1           keep the written review -> reviewItem ->
--                                     reviewItemComment -> appeal join order
--   enable_hashjoin/mergejoin = off   resolve each step with index lookups
--   max_parallel_workers_per_gather   avoid a parallel scan of review
-- The counting logic and summary upsert/delete are unchanged.
CREATE OR REPLACE FUNCTION reviews.update_review_pending_summary_for_resource(p_resource_id text)
RETURNS void
LANGUAGE plpgsql
SET join_collapse_limit = 1
SET enable_hashjoin = off
SET enable_mergejoin = off
SET max_parallel_workers_per_gather = 0
AS $$
DECLARE
  pending_count integer;
BEGIN
  SELECT COUNT(*)
  INTO pending_count
  FROM reviews.review rv
  JOIN reviews."reviewItem" ri
    ON ri."reviewId" = rv.id
  JOIN reviews."reviewItemComment" ric
    ON ric."reviewItemId" = ri.id
  JOIN reviews.appeal ap
    ON ap."reviewItemCommentId" = ric.id
  LEFT JOIN reviews."appealResponse" apr
    ON apr."appealId" = ap.id
   AND apr."resourceId" = rv."resourceId"
  WHERE rv."resourceId" = p_resource_id
    AND apr.id IS NULL;

  IF pending_count > 0 THEN
    INSERT INTO reviews.review_pending_summary ("resourceId", "pendingAppealCount", "updatedAt")
    VALUES (p_resource_id, pending_count, now())
    ON CONFLICT ("resourceId")
    DO UPDATE SET
      "pendingAppealCount" = EXCLUDED."pendingAppealCount",
      "updatedAt"          = now();
  ELSE
    DELETE FROM reviews.review_pending_summary
    WHERE "resourceId" = p_resource_id;
  END IF;
END;
$$;
