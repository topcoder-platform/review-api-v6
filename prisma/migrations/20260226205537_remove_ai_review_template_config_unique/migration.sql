-- DropIndex
DROP INDEX "aiReviewTemplateConfig_challengeTrack_challengeType_version_key";

-- CreateIndex
CREATE INDEX "aiReviewTemplateConfig_challengeTrack_challengeType_version_idx" ON "aiReviewTemplateConfig"("challengeTrack", "challengeType", "version");
