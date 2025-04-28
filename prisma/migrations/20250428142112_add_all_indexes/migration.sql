-- CreateIndex
CREATE INDEX "appeal_id_idx" ON "appeal"("id");

-- CreateIndex
CREATE INDEX "appeal_reviewItemCommentId_idx" ON "appeal"("reviewItemCommentId");

-- CreateIndex
CREATE INDEX "appealResponse_id_idx" ON "appealResponse"("id");

-- CreateIndex
CREATE INDEX "appealResponse_appealId_idx" ON "appealResponse"("appealId");

-- CreateIndex
CREATE INDEX "appealResponse_resourceId_idx" ON "appealResponse"("resourceId");

-- CreateIndex
CREATE INDEX "challengeResult_challengeId_idx" ON "challengeResult"("challengeId");

-- CreateIndex
CREATE INDEX "challengeResult_userId_idx" ON "challengeResult"("userId");

-- CreateIndex
CREATE INDEX "challengeResult_submissionId_idx" ON "challengeResult"("submissionId");

-- CreateIndex
CREATE INDEX "contactRequest_id_idx" ON "contactRequest"("id");

-- CreateIndex
CREATE INDEX "contactRequest_resourceId_idx" ON "contactRequest"("resourceId");

-- CreateIndex
CREATE INDEX "contactRequest_challengeId_idx" ON "contactRequest"("challengeId");

-- CreateIndex
CREATE INDEX "review_id_idx" ON "review"("id");

-- CreateIndex
CREATE INDEX "review_phaseId_idx" ON "review"("phaseId");

-- CreateIndex
CREATE INDEX "review_scorecardId_idx" ON "review"("scorecardId");

-- CreateIndex
CREATE INDEX "reviewItem_scorecardQuestionId_idx" ON "reviewItem"("scorecardQuestionId");

-- CreateIndex
CREATE INDEX "reviewItemComment_resourceId_idx" ON "reviewItemComment"("resourceId");

-- CreateIndex
CREATE INDEX "reviewItemComment_type_idx" ON "reviewItemComment"("type");

-- CreateIndex
CREATE INDEX "scorecard_id_idx" ON "scorecard"("id");

-- CreateIndex
CREATE INDEX "scorecard_type_idx" ON "scorecard"("type");

-- CreateIndex
CREATE INDEX "scorecard_status_idx" ON "scorecard"("status");

-- CreateIndex
CREATE INDEX "scorecardGroup_id_idx" ON "scorecardGroup"("id");

-- CreateIndex
CREATE INDEX "scorecardGroup_scorecardId_idx" ON "scorecardGroup"("scorecardId");

-- CreateIndex
CREATE INDEX "scorecardGroup_sortOrder_idx" ON "scorecardGroup"("sortOrder");

-- CreateIndex
CREATE INDEX "scorecardQuestion_id_idx" ON "scorecardQuestion"("id");

-- CreateIndex
CREATE INDEX "scorecardQuestion_scorecardSectionId_idx" ON "scorecardQuestion"("scorecardSectionId");

-- CreateIndex
CREATE INDEX "scorecardQuestion_type_idx" ON "scorecardQuestion"("type");

-- CreateIndex
CREATE INDEX "scorecardQuestion_sortOrder_idx" ON "scorecardQuestion"("sortOrder");

-- CreateIndex
CREATE INDEX "scorecardSection_id_idx" ON "scorecardSection"("id");

-- CreateIndex
CREATE INDEX "scorecardSection_scorecardGroupId_idx" ON "scorecardSection"("scorecardGroupId");

-- CreateIndex
CREATE INDEX "scorecardSection_sortOrder_idx" ON "scorecardSection"("sortOrder");
