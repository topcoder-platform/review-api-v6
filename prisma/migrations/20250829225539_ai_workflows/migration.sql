-- CreateTable
CREATE TABLE "llmProvider" (
    "id" VARCHAR(14) NOT NULL DEFAULT nanoid(),
    "name" VARCHAR NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "llmProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llmModel" (
    "id" VARCHAR(14) NOT NULL DEFAULT nanoid(),
    "providerId" VARCHAR(14) NOT NULL,
    "name" VARCHAR NOT NULL,
    "description" TEXT NOT NULL,
    "icon" VARCHAR,
    "url" VARCHAR,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "llmModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aiWorkflow" (
    "id" VARCHAR(14) NOT NULL DEFAULT nanoid(),
    "name" VARCHAR NOT NULL,
    "llmId" VARCHAR(14) NOT NULL,
    "description" TEXT NOT NULL,
    "defUrl" VARCHAR NOT NULL,
    "gitId" VARCHAR NOT NULL,
    "gitOwner" VARCHAR NOT NULL,
    "scorecardId" VARCHAR(14) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "aiWorkflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aiWorkflowRun" (
    "id" VARCHAR(14) NOT NULL DEFAULT nanoid(),
    "workflowId" VARCHAR(14) NOT NULL,
    "submissionId" VARCHAR(14) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "gitRunId" VARCHAR NOT NULL,
    "score" DOUBLE PRECISION,
    "status" VARCHAR NOT NULL,

    CONSTRAINT "aiWorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aiWorkflowRunItem" (
    "id" VARCHAR(14) NOT NULL DEFAULT nanoid(),
    "workflowRunId" VARCHAR(14) NOT NULL,
    "scorecardQuestionId" VARCHAR(14) NOT NULL,
    "content" TEXT NOT NULL,
    "upVotes" INTEGER NOT NULL DEFAULT 0,
    "downVotes" INTEGER NOT NULL DEFAULT 0,
    "questionScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "aiWorkflowRunItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aiWorkflowRunItemComment" (
    "id" VARCHAR(14) NOT NULL DEFAULT nanoid(),
    "workflowRunItemId" VARCHAR(14) NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "parentId" VARCHAR(14),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "aiWorkflowRunItemComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "llmProvider_name_key" ON "llmProvider"("name");

-- CreateIndex
CREATE UNIQUE INDEX "llmModel_name_key" ON "llmModel"("name");

-- CreateIndex
CREATE UNIQUE INDEX "aiWorkflow_name_key" ON "aiWorkflow"("name");

-- AddForeignKey
ALTER TABLE "llmModel" ADD CONSTRAINT "llmModel_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "llmProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aiWorkflow" ADD CONSTRAINT "aiWorkflow_llmId_fkey" FOREIGN KEY ("llmId") REFERENCES "llmModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aiWorkflow" ADD CONSTRAINT "aiWorkflow_scorecardId_fkey" FOREIGN KEY ("scorecardId") REFERENCES "scorecard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aiWorkflowRun" ADD CONSTRAINT "aiWorkflowRun_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "aiWorkflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aiWorkflowRun" ADD CONSTRAINT "aiWorkflowRun_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aiWorkflowRunItem" ADD CONSTRAINT "aiWorkflowRunItem_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "aiWorkflowRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aiWorkflowRunItem" ADD CONSTRAINT "aiWorkflowRunItem_scorecardQuestionId_fkey" FOREIGN KEY ("scorecardQuestionId") REFERENCES "scorecardQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aiWorkflowRunItemComment" ADD CONSTRAINT "aiWorkflowRunItemComment_workflowRunItemId_fkey" FOREIGN KEY ("workflowRunItemId") REFERENCES "aiWorkflowRunItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aiWorkflowRunItemComment" ADD CONSTRAINT "aiWorkflowRunItemComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "aiWorkflowRunItemComment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
