-- DropForeignKey
ALTER TABLE "reviewApplication" DROP CONSTRAINT "reviewApplication_opportunityId_fkey";

-- AlterTable
ALTER TABLE "reviewApplication" ALTER COLUMN "opportunityId" SET DATA TYPE TEXT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "reviewOpportunity" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "reviewApplication" ADD CONSTRAINT "reviewApplication_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "reviewOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
