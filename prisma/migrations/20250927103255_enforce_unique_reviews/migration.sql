/*
  Warnings:

  - A unique constraint covering the columns `[resourceId,submissionId,scorecardId]` on the table `review` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "review_resourceId_submissionId_scorecardId_key" ON "review"("resourceId", "submissionId", "scorecardId");
