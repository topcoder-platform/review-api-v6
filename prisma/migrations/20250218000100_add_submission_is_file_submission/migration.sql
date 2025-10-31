-- Add isFileSubmission flag to submissions to differentiate file vs URL entries
ALTER TABLE "submission"
ADD COLUMN IF NOT EXISTS "isFileSubmission" BOOLEAN NOT NULL DEFAULT false;
