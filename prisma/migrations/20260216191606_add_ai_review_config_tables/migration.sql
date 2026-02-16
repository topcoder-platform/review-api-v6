-- CreateEnum
CREATE TYPE "AiReviewMode" AS ENUM ('AI_GATING', 'AI_ONLY');

-- CreateEnum
CREATE TYPE "AiReviewDecisionStatus" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'ERROR');

-- AlterEnum
ALTER TYPE "SubmissionStatus" ADD VALUE 'AI_FAILED_REVIEW';

-- DropForeignKey
ALTER TABLE "aiWorkflowRunItem" DROP CONSTRAINT "aiWorkflowRunItem_workflowRunId_fkey";

-- DropForeignKey
ALTER TABLE "aiWorkflowRunItemComment" DROP CONSTRAINT "aiWorkflowRunItemComment_workflowRunItemId_fkey";

-- CreateTable
CREATE TABLE "aiReviewConfig" (
    "id" VARCHAR(14) NOT NULL DEFAULT nanoid(),
    "challengeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "minPassingThreshold" DECIMAL(5,2) NOT NULL,
    "autoFinalize" BOOLEAN NOT NULL DEFAULT false,
    "mode" "AiReviewMode" NOT NULL DEFAULT 'AI_GATING',
    "formula" JSONB,
    "templateId" VARCHAR(14),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "aiReviewConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aiReviewTemplateConfig" (
    "id" VARCHAR(14) NOT NULL DEFAULT nanoid(),
    "challengeTrack" TEXT NOT NULL,
    "challengeType" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "minPassingThreshold" DECIMAL(5,2) NOT NULL,
    "mode" "AiReviewMode" NOT NULL DEFAULT 'AI_GATING',
    "autoFinalize" BOOLEAN NOT NULL DEFAULT false,
    "formula" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "aiReviewTemplateConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aiReviewTemplateConfigWorkflow" (
    "id" VARCHAR(14) NOT NULL DEFAULT nanoid(),
    "configId" VARCHAR(14) NOT NULL,
    "workflowId" VARCHAR(14) NOT NULL,
    "weightPercent" DECIMAL(5,2) NOT NULL,
    "isGating" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "aiReviewTemplateConfigWorkflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aiReviewConfigWorkflow" (
    "id" VARCHAR(14) NOT NULL DEFAULT nanoid(),
    "configId" VARCHAR(14) NOT NULL,
    "workflowId" VARCHAR(14) NOT NULL,
    "weightPercent" DECIMAL(5,2) NOT NULL,
    "isGating" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "aiReviewConfigWorkflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aiReviewDecision" (
    "id" VARCHAR(14) NOT NULL DEFAULT nanoid(),
    "submissionId" VARCHAR(14) NOT NULL,
    "configId" VARCHAR(14) NOT NULL,
    "status" "AiReviewDecisionStatus" NOT NULL,
    "totalScore" DECIMAL(5,2),
    "submissionLocked" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "breakdown" JSONB,
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aiReviewDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "aiReviewConfig_challengeId_idx" ON "aiReviewConfig"("challengeId");

-- CreateIndex
CREATE INDEX "aiReviewConfig_templateId_idx" ON "aiReviewConfig"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "aiReviewConfig_challengeId_version_key" ON "aiReviewConfig"("challengeId", "version");

-- CreateIndex
CREATE INDEX "aiReviewTemplateConfig_challengeTrack_challengeType_idx" ON "aiReviewTemplateConfig"("challengeTrack", "challengeType");

-- CreateIndex
CREATE UNIQUE INDEX "aiReviewTemplateConfig_challengeTrack_challengeType_version_key" ON "aiReviewTemplateConfig"("challengeTrack", "challengeType", "version");

-- CreateIndex
CREATE INDEX "aiReviewTemplateConfigWorkflow_configId_idx" ON "aiReviewTemplateConfigWorkflow"("configId");

-- CreateIndex
CREATE INDEX "aiReviewTemplateConfigWorkflow_workflowId_idx" ON "aiReviewTemplateConfigWorkflow"("workflowId");

-- CreateIndex
CREATE UNIQUE INDEX "aiReviewTemplateConfigWorkflow_configId_workflowId_key" ON "aiReviewTemplateConfigWorkflow"("configId", "workflowId");

-- CreateIndex
CREATE INDEX "aiReviewConfigWorkflow_configId_idx" ON "aiReviewConfigWorkflow"("configId");

-- CreateIndex
CREATE INDEX "aiReviewConfigWorkflow_workflowId_idx" ON "aiReviewConfigWorkflow"("workflowId");

-- CreateIndex
CREATE UNIQUE INDEX "aiReviewConfigWorkflow_configId_workflowId_key" ON "aiReviewConfigWorkflow"("configId", "workflowId");

-- CreateIndex
CREATE INDEX "aiReviewDecision_configId_status_idx" ON "aiReviewDecision"("configId", "status");

-- CreateIndex
CREATE INDEX "aiReviewDecision_submissionId_idx" ON "aiReviewDecision"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "aiReviewDecision_submissionId_configId_key" ON "aiReviewDecision"("submissionId", "configId");

-- AddForeignKey
ALTER TABLE "aiWorkflowRunItem" ADD CONSTRAINT "aiWorkflowRunItem_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "aiWorkflowRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aiWorkflowRunItemComment" ADD CONSTRAINT "aiWorkflowRunItemComment_workflowRunItemId_fkey" FOREIGN KEY ("workflowRunItemId") REFERENCES "aiWorkflowRunItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aiReviewConfig" ADD CONSTRAINT "aiReviewConfig_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "aiReviewTemplateConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aiReviewTemplateConfigWorkflow" ADD CONSTRAINT "aiReviewTemplateConfigWorkflow_configId_fkey" FOREIGN KEY ("configId") REFERENCES "aiReviewTemplateConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aiReviewTemplateConfigWorkflow" ADD CONSTRAINT "aiReviewTemplateConfigWorkflow_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "aiWorkflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aiReviewConfigWorkflow" ADD CONSTRAINT "aiReviewConfigWorkflow_configId_fkey" FOREIGN KEY ("configId") REFERENCES "aiReviewConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aiReviewConfigWorkflow" ADD CONSTRAINT "aiReviewConfigWorkflow_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "aiWorkflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aiReviewDecision" ADD CONSTRAINT "aiReviewDecision_configId_fkey" FOREIGN KEY ("configId") REFERENCES "aiReviewConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aiReviewDecision" ADD CONSTRAINT "aiReviewDecision_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
