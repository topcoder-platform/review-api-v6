/*
  Warnings:

  - Added the required column `challengeTrack` to the `scorecard` table without a default value. This is not possible if the table is not empty.
  - Added the required column `challengeType` to the `scorecard` table without a default value. This is not possible if the table is not empty.
  - Added the required column `createdBy` to the `scorecard` table without a default value. This is not possible if the table is not empty.
  - Added the required column `maxScore` to the `scorecard` table without a default value. This is not possible if the table is not empty.
  - Added the required column `minScore` to the `scorecard` table without a default value. This is not possible if the table is not empty.
  - Added the required column `name` to the `scorecard` table without a default value. This is not possible if the table is not empty.
  - Added the required column `status` to the `scorecard` table without a default value. This is not possible if the table is not empty.
  - Added the required column `type` to the `scorecard` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `scorecard` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedBy` to the `scorecard` table without a default value. This is not possible if the table is not empty.
  - Added the required column `version` to the `scorecard` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ScorecardStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'DELETED');

-- CreateEnum
CREATE TYPE "ScorecardType" AS ENUM ('SCREENING', 'REVIEW', 'APPROVAL', 'POST_MORTEM', 'SPECIFICATION_REVIEW', 'CHECKPOINT_SCREENING', 'CHECKPOINT_REVIEW', 'ITERATIVE_REVIEW');

-- CreateEnum
CREATE TYPE "ChallengeTrack" AS ENUM ('DEVELOPMENT', 'DATA_SCIENCE', 'DESIGN', 'QUALITY_ASSURANCE');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('SCALE', 'YES_NO');

-- CreateEnum
CREATE TYPE "ReviewItemCommentType" AS ENUM ('COMMENT', 'REQUIRED', 'RECOMMENDED');

-- AlterTable
ALTER TABLE "scorecard" ADD COLUMN     "challengeTrack" "ChallengeTrack" NOT NULL,
ADD COLUMN     "challengeType" TEXT NOT NULL,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "createdBy" TEXT NOT NULL,
ADD COLUMN     "maxScore" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "minScore" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "name" TEXT NOT NULL,
ADD COLUMN     "status" "ScorecardStatus" NOT NULL,
ADD COLUMN     "type" "ScorecardType" NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "updatedBy" TEXT NOT NULL,
ADD COLUMN     "version" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "scorecardGroup" (
    "id" VARCHAR(14) NOT NULL DEFAULT nanoid(),
    "scorecardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "scorecardGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scorecardSection" (
    "id" VARCHAR(14) NOT NULL DEFAULT nanoid(),
    "scorecardGroupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "scorecardSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scorecardQuestion" (
    "id" VARCHAR(14) NOT NULL DEFAULT nanoid(),
    "scorecardSectionId" TEXT NOT NULL,
    "type" "QuestionType" NOT NULL,
    "description" TEXT NOT NULL,
    "guidelines" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "requiresUpload" BOOLEAN NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "scaleMin" INTEGER,
    "scaleMax" INTEGER,

    CONSTRAINT "scorecardQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review" (
    "id" VARCHAR(14) NOT NULL DEFAULT nanoid(),
    "resourceId" TEXT NOT NULL,
    "phaseId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "scorecardId" TEXT NOT NULL,
    "committed" BOOLEAN NOT NULL DEFAULT false,
    "finalScore" DOUBLE PRECISION NOT NULL,
    "initialScore" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviewItem" (
    "id" VARCHAR(14) NOT NULL DEFAULT nanoid(),
    "reviewId" TEXT NOT NULL,
    "scorecardQuestionId" TEXT NOT NULL,
    "uploadId" TEXT,
    "initialAnswer" TEXT NOT NULL,
    "finalAnswer" TEXT,
    "managerComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "reviewItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviewItemComment" (
    "id" VARCHAR(14) NOT NULL DEFAULT nanoid(),
    "resourceId" TEXT NOT NULL,
    "reviewItemId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" "ReviewItemCommentType" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "reviewItemComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appeal" (
    "id" VARCHAR(14) NOT NULL DEFAULT nanoid(),
    "resourceId" TEXT NOT NULL,
    "reviewItemCommentId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "appeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appealResponse" (
    "id" VARCHAR(14) NOT NULL DEFAULT nanoid(),
    "appealId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "appealResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challengeResult" (
    "challengeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "paymentId" TEXT,
    "submissionId" TEXT NOT NULL,
    "oldRating" INTEGER,
    "newRating" INTEGER,
    "initialScore" DOUBLE PRECISION NOT NULL,
    "finalScore" DOUBLE PRECISION NOT NULL,
    "placement" INTEGER NOT NULL,
    "rated" BOOLEAN NOT NULL,
    "passedReview" BOOLEAN NOT NULL,
    "validSubmission" BOOLEAN NOT NULL,
    "pointAdjustment" DOUBLE PRECISION,
    "ratingOrder" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "challengeResult_pkey" PRIMARY KEY ("challengeId","userId")
);

-- CreateTable
CREATE TABLE "contactRequest" (
    "id" VARCHAR(14) NOT NULL DEFAULT nanoid(),
    "resourceId" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "contactRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "review_committed_idx" ON "review"("committed");

-- CreateIndex
CREATE INDEX "review_submissionId_idx" ON "review"("submissionId");

-- CreateIndex
CREATE INDEX "review_resourceId_idx" ON "review"("resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "appeal_reviewItemCommentId_key" ON "appeal"("reviewItemCommentId");

-- CreateIndex
CREATE INDEX "appeal_resourceId_idx" ON "appeal"("resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "appealResponse_appealId_key" ON "appealResponse"("appealId");

-- CreateIndex
CREATE INDEX "scorecard_challengeTrack_idx" ON "scorecard"("challengeTrack");

-- CreateIndex
CREATE INDEX "scorecard_challengeType_idx" ON "scorecard"("challengeType");

-- CreateIndex
CREATE INDEX "scorecard_name_idx" ON "scorecard"("name");

-- AddForeignKey
ALTER TABLE "scorecardGroup" ADD CONSTRAINT "scorecardGroup_scorecardId_fkey" FOREIGN KEY ("scorecardId") REFERENCES "scorecard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scorecardSection" ADD CONSTRAINT "scorecardSection_scorecardGroupId_fkey" FOREIGN KEY ("scorecardGroupId") REFERENCES "scorecardGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scorecardQuestion" ADD CONSTRAINT "scorecardQuestion_scorecardSectionId_fkey" FOREIGN KEY ("scorecardSectionId") REFERENCES "scorecardSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_scorecardId_fkey" FOREIGN KEY ("scorecardId") REFERENCES "scorecard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviewItem" ADD CONSTRAINT "reviewItem_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviewItemComment" ADD CONSTRAINT "reviewItemComment_reviewItemId_fkey" FOREIGN KEY ("reviewItemId") REFERENCES "reviewItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appeal" ADD CONSTRAINT "appeal_reviewItemCommentId_fkey" FOREIGN KEY ("reviewItemCommentId") REFERENCES "reviewItemComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appealResponse" ADD CONSTRAINT "appealResponse_appealId_fkey" FOREIGN KEY ("appealId") REFERENCES "appeal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
