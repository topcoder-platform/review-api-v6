-- CreateEnum
CREATE TYPE "AiReviewDecisionEscalationStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "AiReviewDecisionStatus" ADD VALUE 'HUMAN_OVERRIDE';

-- CreateTable
CREATE TABLE "aiReviewDecisionEscalation" (
    "id" VARCHAR(14) NOT NULL DEFAULT nanoid(),
    "aiReviewDecisionId" VARCHAR(14) NOT NULL,
    "escalationNotes" TEXT,
    "approverNotes" TEXT,
    "status" "AiReviewDecisionEscalationStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "aiReviewDecisionEscalation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "aiReviewDecisionEscalation_aiReviewDecisionId_idx" ON "aiReviewDecisionEscalation"("aiReviewDecisionId");

-- AddForeignKey
ALTER TABLE "aiReviewDecisionEscalation" ADD CONSTRAINT "aiReviewDecisionEscalation_aiReviewDecisionId_fkey" FOREIGN KEY ("aiReviewDecisionId") REFERENCES "aiReviewDecision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
