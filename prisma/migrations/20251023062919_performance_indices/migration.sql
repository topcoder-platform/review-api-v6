-- CreateIndex
CREATE INDEX "aiWorkflowRun_submissionId_status_idx" ON "aiWorkflowRun"("submissionId", "status");

-- CreateIndex
CREATE INDEX "aiWorkflowRun_workflowId_idx" ON "aiWorkflowRun"("workflowId");

-- CreateIndex
CREATE INDEX "review_status_phaseId_idx" ON "review"("status", "phaseId");

-- CreateIndex
CREATE INDEX "review_resourceId_status_idx" ON "review"("resourceId", "status");

-- CreateIndex
CREATE INDEX "reviewOpportunity_status_challengeId_type_idx" ON "reviewOpportunity"("status", "challengeId", "type");

-- CreateIndex
CREATE INDEX "reviewSummation_submissionId_isPassing_idx" ON "reviewSummation"("submissionId", "isPassing");

-- CreateIndex
CREATE INDEX "submission_challengeId_memberId_status_idx" ON "submission"("challengeId", "memberId", "status");

-- CreateIndex
CREATE INDEX "submission_submittedDate_idx" ON "submission"("submittedDate");

-- CreateIndex
CREATE INDEX "upload_projectId_resourceId_idx" ON "upload"("projectId", "resourceId");
