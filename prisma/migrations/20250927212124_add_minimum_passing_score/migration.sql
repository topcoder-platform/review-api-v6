-- AlterTable
ALTER TABLE "scorecard" ADD COLUMN "minimumPassingScore" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Backfill existing scorecards to use their minimum score as the passing threshold by default
UPDATE "scorecard" SET "minimumPassingScore" = "minScore";
