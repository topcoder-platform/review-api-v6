-- Add configurable workflow timeout and retry tracking fields.
ALTER TABLE "aiWorkflow"
ADD COLUMN "timeoutSeconds" INTEGER DEFAULT 1800;

ALTER TABLE "aiWorkflowRun"
ADD COLUMN "lastDispatchedAt" TIMESTAMP(3),
ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0;
