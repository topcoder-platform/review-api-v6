/*
  Warnings:

  - The primary key for the `review` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - Added the required column `typeId` to the `review` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "review"
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "typeId" TEXT NOT NULL,
ADD COLUMN     "status" TEXT NOT NULL,
ADD COLUMN     "reviewDate" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "id" SET DEFAULT gen_random_uuid(),
ALTER COLUMN "id" SET DATA TYPE VARCHAR(36);

-- CreateTable
CREATE TABLE "reviewType" (
    "id" VARCHAR(36) NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL,

    CONSTRAINT "reviewType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviewSummation" (
    "id" VARCHAR(36) NOT NULL DEFAULT gen_random_uuid(),
    "submissionId" TEXT NOT NULL,
    "aggregateScore" DOUBLE PRECISION NOT NULL,
    "scorecardId" TEXT NOT NULL,
    "isPassing" BOOLEAN NOT NULL,
    "isFinal" BOOLEAN NOT NULL,
    "reviewedDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "reviewSummation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission" (
    "id" VARCHAR(36) NOT NULL DEFAULT gen_random_uuid(),
    "type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "legacySubmissionId" TEXT,
    "legacyUploadId" TEXT,
    "submissionPhaseId" TEXT,
    "submittedDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "submission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reviewType_id_idx" ON "reviewType"("id");

-- CreateIndex
CREATE INDEX "reviewType_name_idx" ON "reviewType"("name");

-- CreateIndex
CREATE INDEX "reviewType_isActive_idx" ON "reviewType"("isActive");

-- CreateIndex
CREATE INDEX "reviewSummation_id_idx" ON "reviewSummation"("id");

-- CreateIndex
CREATE INDEX "reviewSummation_submissionId_idx" ON "reviewSummation"("submissionId");

-- CreateIndex
CREATE INDEX "reviewSummation_scorecardId_idx" ON "reviewSummation"("scorecardId");

-- CreateIndex
CREATE INDEX "submission_id_idx" ON "submission"("id");

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviewSummation" ADD CONSTRAINT "reviewSummation_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
