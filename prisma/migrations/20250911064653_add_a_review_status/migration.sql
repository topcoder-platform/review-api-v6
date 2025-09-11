/*
  Warnings:

  - The `status` column on the `review` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "review" DROP COLUMN "status",
ADD COLUMN     "status" "ReviewStatus";

-- CreateIndex
CREATE INDEX "review_status_idx" ON "review"("status");
