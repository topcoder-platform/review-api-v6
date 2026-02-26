-- CreateEnum
CREATE TYPE "ChallengeReviewContextStatus" AS ENUM ('AI_GENERATED', 'HUMAN_APPROVED', 'HUMAN_REJECTED');

-- CreateTable
CREATE TABLE "challengeReviewContext" (
    "id" VARCHAR(14) NOT NULL DEFAULT nanoid(),
    "challengeId" TEXT NOT NULL,
    "context" JSONB NOT NULL,
    "status" "ChallengeReviewContextStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "challengeReviewContext_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "challengeReviewContext_challengeId_key" ON "challengeReviewContext"("challengeId");

-- CreateIndex
CREATE INDEX "challengeReviewContext_challengeId_idx" ON "challengeReviewContext"("challengeId");
