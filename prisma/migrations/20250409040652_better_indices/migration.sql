-- CreateIndex
CREATE INDEX "reviewItem_reviewId_idx" ON "reviewItem"("reviewId");

-- CreateIndex
CREATE INDEX "reviewItem_id_idx" ON "reviewItem"("id");

-- CreateIndex
CREATE INDEX "reviewItemComment_reviewItemId_idx" ON "reviewItemComment"("reviewItemId");

-- CreateIndex
CREATE INDEX "reviewItemComment_id_idx" ON "reviewItemComment"("id");
