-- Add reviewMethod enum and column to aiWorkflow.
CREATE TYPE "ReviewMethod" AS ENUM ('AI_ASSISTED', 'DETERMINISTIC');

ALTER TABLE "aiWorkflow"
  ADD COLUMN "reviewMethod" "ReviewMethod" NOT NULL DEFAULT 'AI_ASSISTED';
