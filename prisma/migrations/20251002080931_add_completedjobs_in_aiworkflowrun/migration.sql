-- AlterTable
ALTER TABLE "aiWorkflowRun" ADD COLUMN     "completedJobs" INTEGER DEFAULT 0,
ADD COLUMN     "jobsCount" INTEGER DEFAULT 0;
