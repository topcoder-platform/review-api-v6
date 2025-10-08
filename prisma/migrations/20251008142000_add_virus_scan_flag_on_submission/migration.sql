-- Add virusScan flag to submission model
ALTER TABLE "submission" ADD COLUMN "virusScan" BOOLEAN NOT NULL DEFAULT false;
