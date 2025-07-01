-- CreateEnum
CREATE TYPE "ReviewOpportunityStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReviewApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReviewOpportunityType" AS ENUM ('REGULAR_REVIEW', 'COMPONENT_DEV_REVIEW', 'SPEC_REVIEW', 'ITERATIVE_REVIEW', 'SCENARIOS_REVIEW');

-- CreateEnum
CREATE TYPE "ReviewApplicationRole" AS ENUM ('PRIMARY_REVIEWER', 'SECONDARY_REVIEWER', 'PRIMARY_FAILURE_REVIEWER', 'ACCURACY_REVIEWER', 'STRESS_REVIEWER', 'FAILURE_REVIEWER', 'SPECIFICATION_REVIEWER', 'ITERATIVE_REVIEWER', 'REVIEWER');

-- CreateTable
CREATE TABLE "reviewOpportunity" (
    "id" VARCHAR(14) NOT NULL DEFAULT nanoid(),
    "challengeId" TEXT NOT NULL,
    "status" "ReviewOpportunityStatus" NOT NULL,
    "type" "ReviewOpportunityType" NOT NULL,
    "openPositions" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "duration" INTEGER NOT NULL,
    "basePayment" DOUBLE PRECISION NOT NULL,
    "incrementalPayment" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "reviewOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviewApplication" (
    "id" VARCHAR(14) NOT NULL DEFAULT nanoid(),
    "userId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "opportunityId" VARCHAR(14) NOT NULL,
    "role" "ReviewApplicationRole" NOT NULL,
    "status" "ReviewApplicationStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "reviewApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reviewOpportunity_id_idx" ON "reviewOpportunity"("id");

-- CreateIndex
CREATE INDEX "reviewOpportunity_challengeId_idx" ON "reviewOpportunity"("challengeId");

-- CreateIndex
CREATE UNIQUE INDEX "reviewOpportunity_challengeId_type_key" ON "reviewOpportunity"("challengeId", "type");

-- CreateIndex
CREATE INDEX "reviewApplication_id_idx" ON "reviewApplication"("id");

-- CreateIndex
CREATE INDEX "reviewApplication_userId_idx" ON "reviewApplication"("userId");

-- CreateIndex
CREATE INDEX "reviewApplication_opportunityId_idx" ON "reviewApplication"("opportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "reviewApplication_opportunityId_userId_role_key" ON "reviewApplication"("opportunityId", "userId", "role");

-- AddForeignKey
ALTER TABLE "reviewApplication" ADD CONSTRAINT "reviewApplication_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "reviewOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
