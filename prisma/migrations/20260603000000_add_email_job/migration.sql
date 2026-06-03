-- CreateEnum
CREATE TYPE "EmailType" AS ENUM ('BOOKING_CONFIRMATION', 'REFUND_COMPLETED');

-- CreateEnum
CREATE TYPE "EmailJobStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "EmailJob" (
    "id" TEXT NOT NULL,
    "type" "EmailType" NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "status" "EmailJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentTo" TEXT,
    "providerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailJob_dedupeKey_key" ON "EmailJob"("dedupeKey");

-- CreateIndex
CREATE INDEX "EmailJob_status_nextRunAt_idx" ON "EmailJob"("status", "nextRunAt");

-- AddForeignKey
ALTER TABLE "EmailJob" ADD CONSTRAINT "EmailJob_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
