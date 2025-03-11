-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ReviewItemCommentType" ADD VALUE 'AGGREGATION_COMMENT';
ALTER TYPE "ReviewItemCommentType" ADD VALUE 'AGGREGATION_REVIEW_COMMENT';
ALTER TYPE "ReviewItemCommentType" ADD VALUE 'SUBMITTER_COMMENT';
ALTER TYPE "ReviewItemCommentType" ADD VALUE 'FINAL_FIX_COMMENT';
ALTER TYPE "ReviewItemCommentType" ADD VALUE 'FINAL_REVIEW_COMMENT';
ALTER TYPE "ReviewItemCommentType" ADD VALUE 'MANAGER_COMMENT';
ALTER TYPE "ReviewItemCommentType" ADD VALUE 'APPROVAL_REVIEW_COMMENT';
ALTER TYPE "ReviewItemCommentType" ADD VALUE 'APPROVAL_REVIEW_COMMENT_OTHER_FIXES';
ALTER TYPE "ReviewItemCommentType" ADD VALUE 'SPECIFICATION_REVIEW_COMMENT';
