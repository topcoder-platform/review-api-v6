-- Add runtime enable/disable flags for AI configuration entities.
ALTER TABLE "aiWorkflow"
ADD COLUMN "disabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "aiReviewTemplateConfig"
ADD COLUMN "disabled" BOOLEAN NOT NULL DEFAULT false;
