/*
  Warnings:

  - A unique constraint covering the columns `[workflowId,submissionId]` on the table `aiWorkflowRun` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "aiWorkflowRunItem" DROP CONSTRAINT "aiWorkflowRunItem_workflowRunId_fkey";

-- DropForeignKey
ALTER TABLE "aiWorkflowRunItemComment" DROP CONSTRAINT "aiWorkflowRunItemComment_workflowRunItemId_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "ai_workflow_run_workflow_submission_unique" ON "aiWorkflowRun"("workflowId", "submissionId");

-- AddForeignKey
ALTER TABLE "aiWorkflowRunItem" ADD CONSTRAINT "aiWorkflowRunItem_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "aiWorkflowRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aiWorkflowRunItemComment" ADD CONSTRAINT "aiWorkflowRunItemComment_workflowRunItemId_fkey" FOREIGN KEY ("workflowRunItemId") REFERENCES "aiWorkflowRunItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
