-- CreateTable
CREATE TABLE "review_pending_summary" (
    "resourceId" TEXT NOT NULL,
    "pendingAppealCount" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_pending_summary_pkey" PRIMARY KEY ("resourceId")
);

-- CreateIndex
CREATE INDEX "review_pending_summary_updated_at_idx" ON "review_pending_summary"("updatedAt");

BEGIN;

-- Prime the summary table
INSERT INTO reviews.review_pending_summary ("resourceId", "pendingAppealCount", "updatedAt")
SELECT
  rv."resourceId",
  COUNT(*) AS "pendingAppealCount",
  now()
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
WHERE apr.id IS NULL
GROUP BY rv."resourceId"
ON CONFLICT ("resourceId")
DO UPDATE SET
  "pendingAppealCount" = EXCLUDED."pendingAppealCount",
  "updatedAt"          = now();

-- Helper to recompute a single resource
CREATE OR REPLACE FUNCTION reviews.update_review_pending_summary_for_resource(p_resource_id text)
RETURNS void
LANGUAGE plpgsql
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

-- Triggers for the appeals table
CREATE OR REPLACE FUNCTION reviews.handle_appeal_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM reviews.update_review_pending_summary_for_resource(NEW."resourceId");
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS appeal_pending_maintainer
ON reviews.appeal;

CREATE TRIGGER appeal_pending_maintainer
AFTER INSERT OR UPDATE OR DELETE ON reviews.appeal
FOR EACH ROW
EXECUTE FUNCTION reviews.handle_appeal_change();

-- Triggers for appeal responses
CREATE OR REPLACE FUNCTION reviews.handle_appeal_response_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_resource text;
BEGIN
  IF TG_OP IN ('INSERT','UPDATE') THEN
    target_resource := NEW."resourceId";
  ELSE
    target_resource := OLD."resourceId";
  END IF;

  PERFORM reviews.update_review_pending_summary_for_resource(target_resource);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS appeal_response_pending_maintainer
ON reviews."appealResponse";

CREATE TRIGGER appeal_response_pending_maintainer
AFTER INSERT OR UPDATE OR DELETE ON reviews."appealResponse"
FOR EACH ROW
EXECUTE FUNCTION reviews.handle_appeal_response_change();

COMMIT;