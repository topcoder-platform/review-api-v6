-- Add eventRaised flag to submission to prevent duplicate event publishing
ALTER TABLE "submission" ADD COLUMN "eventRaised" BOOLEAN NOT NULL DEFAULT false;
