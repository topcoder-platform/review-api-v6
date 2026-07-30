-- Add instantReview flag on aiReviewConfig.
ALTER TABLE "aiReviewConfig"
ADD COLUMN "instantReview" BOOLEAN NOT NULL DEFAULT FALSE;
