/*
  Warnings:

  - You are about to drop the column `downVotes` on the `aiWorkflowRunItem` table. All the data in the column will be lost.
  - You are about to drop the column `upVotes` on the `aiWorkflowRunItem` table. All the data in the column will be lost.
  - You are about to drop the column `downVotes` on the `aiWorkflowRunItemComment` table. All the data in the column will be lost.
  - You are about to drop the column `upVotes` on the `aiWorkflowRunItemComment` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "VoteType" AS ENUM ('UPVOTE', 'DOWNVOTE');

-- AlterTable
ALTER TABLE "aiWorkflowRunItem" DROP COLUMN "downVotes",
DROP COLUMN "upVotes";

-- AlterTable
ALTER TABLE "aiWorkflowRunItemComment" DROP COLUMN "downVotes",
DROP COLUMN "upVotes";

-- CreateTable
CREATE TABLE "aiWorkflowRunItemVote" (
    "id" VARCHAR(14) NOT NULL DEFAULT nanoid(),
    "workflowRunItemId" VARCHAR(14) NOT NULL,
    "voteType" "VoteType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "aiWorkflowRunItemVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aiWorkflowRunItemCommentVote" (
    "id" VARCHAR(14) NOT NULL DEFAULT nanoid(),
    "workflowRunItemCommentId" VARCHAR(14) NOT NULL,
    "voteType" "VoteType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "aiWorkflowRunItemCommentVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "aiWorkflowRunItemVote_workflowRunItemId_idx" ON "aiWorkflowRunItemVote"("workflowRunItemId");

-- CreateIndex
CREATE INDEX "aiWorkflowRunItemCommentVote_workflowRunItemCommentId_idx" ON "aiWorkflowRunItemCommentVote"("workflowRunItemCommentId");

-- AddForeignKey
ALTER TABLE "aiWorkflowRunItemVote" ADD CONSTRAINT "aiWorkflowRunItemVote_workflowRunItemId_fkey" FOREIGN KEY ("workflowRunItemId") REFERENCES "aiWorkflowRunItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aiWorkflowRunItemCommentVote" ADD CONSTRAINT "aiWorkflowRunItemCommentVote_workflowRunItemCommentId_fkey" FOREIGN KEY ("workflowRunItemCommentId") REFERENCES "aiWorkflowRunItemComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
