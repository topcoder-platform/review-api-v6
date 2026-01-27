/*
  Warnings:

  - A unique constraint covering the columns `[workflowId,submissionId]` on the table `aiWorkflowRun` will be added.
*/

-- Remove duplicate aiWorkflowRun rows (keep the row with the smallest id for each (workflowId, submissionId)).
-- Excludes rows where submissionId IS NULL. Remove the WHERE clause if you want to dedupe NULLs as well.
-- This ensures the unique index creation below will succeed even when duplicates exist.
DELETE FROM "aiWorkflowRun"
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY "workflowId","submissionId" ORDER BY id) AS rn
    FROM "aiWorkflowRun"
    WHERE "submissionId" IS NOT NULL
  ) t
  WHERE t.rn > 1
);

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
