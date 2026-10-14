-- CreateEnum
CREATE TYPE "AnalyticsEventType" AS ENUM ('PURCHASE', 'REFUND');

-- CreateEnum
CREATE TYPE "AnalyticsJobStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "gaClientId" TEXT;

-- CreateTable
CREATE TABLE "AnalyticsJob" (
    "id" TEXT NOT NULL,
    "type" "AnalyticsEventType" NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "refundJobId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "status" "AnalyticsJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsJob_dedupeKey_key" ON "AnalyticsJob"("dedupeKey");

-- CreateIndex
CREATE INDEX "AnalyticsJob_status_nextRunAt_idx" ON "AnalyticsJob"("status", "nextRunAt");

-- AddForeignKey
ALTER TABLE "AnalyticsJob" ADD CONSTRAINT "AnalyticsJob_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

