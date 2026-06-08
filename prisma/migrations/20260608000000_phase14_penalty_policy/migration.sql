-- CreateTable
CREATE TABLE "PenaltyPolicy" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "tiers" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PenaltyPolicy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PenaltyPolicy_key_version_key" ON "PenaltyPolicy"("key", "version");
CREATE INDEX "PenaltyPolicy_key_isActive_idx" ON "PenaltyPolicy"("key", "isActive");

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "penaltyPolicyKey" TEXT;
ALTER TABLE "Departure" ADD COLUMN "penaltyPolicyKey" TEXT;
ALTER TABLE "Booking" ADD COLUMN "penaltyPolicyKey" TEXT;
ALTER TABLE "Booking" ADD COLUMN "penaltyPolicyVersion" INTEGER;
