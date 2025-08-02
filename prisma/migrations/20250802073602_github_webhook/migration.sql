-- DropForeignKey
ALTER TABLE "reviewApplication" DROP CONSTRAINT "reviewApplication_opportunityId_fkey";

-- AlterTable
ALTER TABLE "reviewApplication" ALTER COLUMN "opportunityId" SET DATA TYPE TEXT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "reviewOpportunity" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "gitWebhookLog" (
    "id" VARCHAR(14) NOT NULL DEFAULT nanoid(),
    "eventId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "eventPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gitWebhookLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gitWebhookLog_eventId_idx" ON "gitWebhookLog"("eventId");

-- CreateIndex
CREATE INDEX "gitWebhookLog_event_idx" ON "gitWebhookLog"("event");

-- CreateIndex
CREATE INDEX "gitWebhookLog_createdAt_idx" ON "gitWebhookLog"("createdAt");

-- AddForeignKey
ALTER TABLE "reviewApplication" ADD CONSTRAINT "reviewApplication_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "reviewOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
