-- DropForeignKey
ALTER TABLE "aiWorkflowRunItem" DROP CONSTRAINT "aiWorkflowRunItem_workflowRunId_fkey";

-- DropForeignKey
ALTER TABLE "aiWorkflowRunItemComment" DROP CONSTRAINT "aiWorkflowRunItemComment_workflowRunItemId_fkey";

-- AddForeignKey
ALTER TABLE "aiWorkflowRunItem" ADD CONSTRAINT "aiWorkflowRunItem_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "aiWorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aiWorkflowRunItemComment" ADD CONSTRAINT "aiWorkflowRunItemComment_workflowRunItemId_fkey" FOREIGN KEY ("workflowRunItemId") REFERENCES "aiWorkflowRunItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
