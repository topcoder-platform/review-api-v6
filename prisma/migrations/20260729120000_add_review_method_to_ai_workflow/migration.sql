-- Add reviewMethod enum and column to aiWorkflow.
CREATE TYPE "ReviewMethod" AS ENUM ('AI-Assisted', 'Deterministic');

ALTER TABLE "aiWorkflow"
  ADD COLUMN "reviewMethod" "ReviewMethod" NOT NULL DEFAULT 'AI-Assisted';
