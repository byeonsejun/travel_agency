-- Phase 4-B — DepartureCancellation 배치 + RefundJob.cancellationBatchId
-- 멱등 재적용 안전(IF NOT EXISTS). enum/제약은 DO 블록으로 duplicate 가드.
-- 본 프로젝트는 prisma migrate dev shadow DB 재현 불가(첫 migration이 partial
-- raw artifact) → db execute + migrate resolve로 적용. [ADR-0027 Task 1 선례]

DO $$ BEGIN
  CREATE TYPE "DepartureCancellationStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'PARTIALLY_FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "DepartureCancellation" (
  "id"               TEXT PRIMARY KEY,
  "departureId"      TEXT NOT NULL,
  "status"           "DepartureCancellationStatus" NOT NULL DEFAULT 'PROCESSING',
  "totalBookings"    INTEGER NOT NULL,
  "immediateCancels" INTEGER NOT NULL DEFAULT 0,
  "actor"            TEXT NOT NULL,
  "reason"           TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DepartureCancellation_departureId_fkey"
    FOREIGN KEY ("departureId") REFERENCES "Departure"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "DepartureCancellation_status_idx" ON "DepartureCancellation"("status");
CREATE INDEX IF NOT EXISTS "DepartureCancellation_departureId_idx" ON "DepartureCancellation"("departureId");

ALTER TABLE "RefundJob" ADD COLUMN IF NOT EXISTS "cancellationBatchId" TEXT;
CREATE INDEX IF NOT EXISTS "RefundJob_cancellationBatchId_idx" ON "RefundJob"("cancellationBatchId");

DO $$ BEGIN
  ALTER TABLE "RefundJob" ADD CONSTRAINT "RefundJob_cancellationBatchId_fkey"
    FOREIGN KEY ("cancellationBatchId") REFERENCES "DepartureCancellation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
