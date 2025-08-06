/*
  Warnings:

  - You are about to alter the column `submissionId` on the `review` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(14)`.
  - You are about to alter the column `submissionId` on the `reviewSummation` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(14)`.
  - The primary key for the `submission` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to alter the column `id` on the `submission` table. The data in that column could be lost. The data in that column will be cast from `VarChar(36)` to `VarChar(14)`.
  - Added the required column `status` to the `submission` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `type` on the `submission` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "UploadType" AS ENUM ('SUBMISSION', 'TEST_CASE', 'FINAL_FIX', 'REVIEW_DOCUMENT');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('ACTIVE', 'DELETED');

-- CreateEnum
CREATE TYPE "SubmissionType" AS ENUM ('CONTEST_SUBMISSION', 'SPECIFICATION_SUBMISSION', 'CHECKPOINT_SUBMISSION', 'STUDIO_FINAL_FIX_SUBMISSION');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('ACTIVE', 'FAILED_SCREENING', 'FAILED_REVIEW', 'COMPLETED_WITHOUT_WIN', 'DELETED', 'FAILED_CHECKPOINT_SCREENING', 'FAILED_CHECKPOINT_REVIEW');

-- DropForeignKey
ALTER TABLE "review" DROP CONSTRAINT "review_submissionId_fkey";

-- DropForeignKey
ALTER TABLE "reviewApplication" DROP CONSTRAINT "reviewApplication_opportunityId_fkey";

-- DropForeignKey
ALTER TABLE "reviewSummation" DROP CONSTRAINT "reviewSummation_submissionId_fkey";

-- DropIndex
DROP INDEX "review_id_idx";

-- DropIndex
DROP INDEX "reviewSummation_id_idx";

-- DropIndex
DROP INDEX "submission_id_idx";

-- AlterTable
ALTER TABLE "review" ADD COLUMN     "legacySubmissionId" TEXT,
ALTER COLUMN "submissionId" DROP NOT NULL,
ALTER COLUMN "submissionId" SET DATA TYPE VARCHAR(14),
ALTER COLUMN "finalScore" DROP NOT NULL,
ALTER COLUMN "initialScore" DROP NOT NULL,
ALTER COLUMN "typeId" DROP NOT NULL,
ALTER COLUMN "status" DROP NOT NULL,
ALTER COLUMN "reviewDate" DROP NOT NULL;

-- AlterTable
ALTER TABLE "reviewApplication" ALTER COLUMN "opportunityId" SET DATA TYPE TEXT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "reviewOpportunity" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "reviewSummation" ADD COLUMN     "legacySubmissionId" TEXT,
ADD COLUMN     "scorecardLegacyId" TEXT,
ALTER COLUMN "submissionId" SET DATA TYPE VARCHAR(14),
ALTER COLUMN "scorecardId" DROP NOT NULL,
ALTER COLUMN "isFinal" DROP NOT NULL,
ALTER COLUMN "reviewedDate" DROP NOT NULL;

-- AlterTable
ALTER TABLE "submission" DROP CONSTRAINT "submission_pkey",
ADD COLUMN     "esId" UUID,
ADD COLUMN     "fileSize" INTEGER,
ADD COLUMN     "fileType" TEXT,
ADD COLUMN     "finalScore" DECIMAL(65,30),
ADD COLUMN     "initialScore" DECIMAL(65,30),
ADD COLUMN     "legacyChallengeId" BIGINT,
ADD COLUMN     "markForPurchase" BOOLEAN,
ADD COLUMN     "placement" INTEGER,
ADD COLUMN     "prizeId" BIGINT,
ADD COLUMN     "screeningScore" DECIMAL(65,30),
ADD COLUMN     "status" "SubmissionStatus" NOT NULL,
ADD COLUMN     "systemFileName" TEXT,
ADD COLUMN     "thurgoodJobId" TEXT,
ADD COLUMN     "uploadId" VARCHAR(14),
ADD COLUMN     "userRank" INTEGER,
ADD COLUMN     "viewCount" INTEGER,
ALTER COLUMN "id" SET DEFAULT nanoid(),
ALTER COLUMN "id" SET DATA TYPE VARCHAR(14),
DROP COLUMN "type",
ADD COLUMN     "type" "SubmissionType" NOT NULL,
ALTER COLUMN "url" DROP NOT NULL,
ALTER COLUMN "memberId" DROP NOT NULL,
ALTER COLUMN "challengeId" DROP NOT NULL,
ALTER COLUMN "submittedDate" DROP NOT NULL,
ALTER COLUMN "updatedAt" DROP NOT NULL,
ALTER COLUMN "updatedBy" DROP NOT NULL,
ADD CONSTRAINT "submission_pkey" PRIMARY KEY ("id");

-- CreateTable
CREATE TABLE "upload" (
    "id" VARCHAR(14) NOT NULL DEFAULT nanoid(),
    "legacyId" TEXT,
    "projectId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "type" "UploadType" NOT NULL,
    "status" "UploadStatus" NOT NULL,
    "parameter" TEXT,
    "url" TEXT,
    "desc" TEXT,
    "projectPhaseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3),
    "updatedBy" TEXT,

    CONSTRAINT "upload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resourceSubmission" (
    "id" VARCHAR(14) NOT NULL DEFAULT nanoid(),
    "resourceId" TEXT NOT NULL,
    "submissionId" TEXT,
    "legacySubmissionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3),
    "updatedBy" TEXT,

    CONSTRAINT "resourceSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "upload_projectId_idx" ON "upload"("projectId");

-- CreateIndex
CREATE INDEX "upload_legacyId_idx" ON "upload"("legacyId");

-- CreateIndex
CREATE INDEX "submission_memberId_idx" ON "submission"("memberId");

-- CreateIndex
CREATE INDEX "submission_challengeId_idx" ON "submission"("challengeId");

-- CreateIndex
CREATE INDEX "submission_legacySubmissionId_idx" ON "submission"("legacySubmissionId");

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviewSummation" ADD CONSTRAINT "reviewSummation_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission" ADD CONSTRAINT "submission_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "upload"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviewApplication" ADD CONSTRAINT "reviewApplication_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "reviewOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resourceSubmission" ADD CONSTRAINT "resourceSubmission_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
