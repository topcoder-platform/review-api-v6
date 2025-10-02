-- AlterTable
ALTER TABLE "aiWorkflowRun" ADD COLUMN     "error" TEXT,
ADD COLUMN     "usage" JSONB;
