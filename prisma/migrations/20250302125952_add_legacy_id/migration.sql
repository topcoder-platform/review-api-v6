-- AlterTable
ALTER TABLE "appeal" ADD COLUMN     "legacyId" TEXT;

-- AlterTable
ALTER TABLE "appealResponse" ADD COLUMN     "legacyId" TEXT;

-- AlterTable
ALTER TABLE "review" ADD COLUMN     "legacyId" TEXT;

-- AlterTable
ALTER TABLE "reviewItem" ADD COLUMN     "legacyId" TEXT;

-- AlterTable
ALTER TABLE "reviewItemComment" ADD COLUMN     "legacyId" TEXT;

-- AlterTable
ALTER TABLE "scorecard" ADD COLUMN     "legacyId" TEXT;

-- AlterTable
ALTER TABLE "scorecardGroup" ADD COLUMN     "legacyId" TEXT;

-- AlterTable
ALTER TABLE "scorecardQuestion" ADD COLUMN     "legacyId" TEXT;

-- AlterTable
ALTER TABLE "scorecardSection" ADD COLUMN     "legacyId" TEXT;
