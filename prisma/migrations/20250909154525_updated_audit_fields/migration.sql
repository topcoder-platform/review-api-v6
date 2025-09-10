-- AlterTable
ALTER TABLE "aiWorkflow" ALTER COLUMN "updatedAt" DROP NOT NULL,
ALTER COLUMN "updatedBy" DROP NOT NULL;

-- AlterTable
ALTER TABLE "aiWorkflowRunItem" ALTER COLUMN "createdAt" DROP NOT NULL,
ALTER COLUMN "createdBy" DROP NOT NULL;

-- AlterTable
ALTER TABLE "aiWorkflowRunItemComment" ALTER COLUMN "updatedAt" DROP NOT NULL,
ALTER COLUMN "updatedBy" DROP NOT NULL;
