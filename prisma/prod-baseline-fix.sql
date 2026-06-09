-- ============================================================================
-- 운영 DB P3009 복구 + phase14/15 적용 (1회성 런북)
-- ============================================================================
-- 증상: Vercel 빌드의 `prisma migrate deploy`가 P3009로 실패 —
--   "20260519000000_product_embedding_pgvector migration ... failed".
-- 원인: 과거 pgvector 마이그가 실패 기록으로 남아 이후 마이그 전부 차단됨.
--   운영 스키마는 db push 로 phase13까지 구축돼 있고, _prisma_migrations 이력만 깨짐.
-- 조치: (1) phase14/15 DDL 멱등 적용 → (2) _prisma_migrations 를 로컬의 정답
--   체크섬으로 재구성(전부 applied 표시). 실행 후 migrate deploy = "No pending".
--
-- 실행: Supabase SQL Editor 에 통째로 붙여넣고 Run. (재실행 안전 — 멱등)
-- ============================================================================

BEGIN;

-- ── (1) phase14_penalty_policy DDL (멱등) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS "PenaltyPolicy" (
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
CREATE UNIQUE INDEX IF NOT EXISTS "PenaltyPolicy_key_version_key" ON "PenaltyPolicy"("key","version");
CREATE INDEX IF NOT EXISTS "PenaltyPolicy_key_isActive_idx" ON "PenaltyPolicy"("key","isActive");
ALTER TABLE "Product"   ADD COLUMN IF NOT EXISTS "penaltyPolicyKey" TEXT;
ALTER TABLE "Departure" ADD COLUMN IF NOT EXISTS "penaltyPolicyKey" TEXT;
ALTER TABLE "Booking"   ADD COLUMN IF NOT EXISTS "penaltyPolicyKey" TEXT;
ALTER TABLE "Booking"   ADD COLUMN IF NOT EXISTS "penaltyPolicyVersion" INTEGER;

-- ── (2) phase15_review_report DDL (멱등) ────────────────────────────────────
DO $$ BEGIN CREATE TYPE "ReportReason" AS ENUM ('SPAM','ABUSIVE','IRRELEVANT','PRIVACY','OTHER'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "ReportStatus" AS ENUM ('OPEN','RESOLVED','DISMISSED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
CREATE TABLE IF NOT EXISTS "ReviewReport" (
  "id" TEXT NOT NULL,
  "reviewId" TEXT NOT NULL,
  "reporterId" TEXT NOT NULL,
  "reason" "ReportReason" NOT NULL,
  "note" TEXT,
  "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "ReviewReport_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ReviewReport_reviewId_reporterId_key" ON "ReviewReport"("reviewId","reporterId");
CREATE INDEX IF NOT EXISTS "ReviewReport_status_createdAt_idx" ON "ReviewReport"("status","createdAt" DESC);
CREATE INDEX IF NOT EXISTS "ReviewReport_reviewId_idx" ON "ReviewReport"("reviewId");
DO $$ BEGIN
  ALTER TABLE "ReviewReport" ADD CONSTRAINT "ReviewReport_reviewId_fkey"
    FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "ReviewReport" ADD CONSTRAINT "ReviewReport_reporterId_fkey"
    FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── (3) _prisma_migrations 재구성 (로컬 정답 체크섬, 전부 applied) ───────────
-- 11개를 지우고 깨끗한 applied 행으로 재삽입. 체크섬은 로컬 DB에서 추출(정답).
DELETE FROM "_prisma_migrations" WHERE migration_name IN (
  '20260519000000_product_embedding_pgvector',
  '20260521000000_add_wishlist',
  '20260522000000_add_review',
  '20260531000000_embedding_job_pipeline',
  '20260602000000_departure_cancellation',
  '20260603000000_add_email_job',
  '20260604000000_phase8_ledger',
  '20260604002728_phase5b_partial_refund',
  '20260607000000_phase13_partial_refund_email',
  '20260608000000_phase14_penalty_policy',
  '20260608010000_phase15_review_report'
);
INSERT INTO "_prisma_migrations"
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES
  (gen_random_uuid()::text, 'cca094acc822431394dfdeb0962e9fd799a52687a346b634a8a53668d3f94052', now(), '20260519000000_product_embedding_pgvector', NULL, NULL, now(), 1),
  (gen_random_uuid()::text, 'de4400d229faeb84f41f09fcf1d4d6b6ac78c89b0f96a3de695f07e079ec97c5', now(), '20260521000000_add_wishlist', NULL, NULL, now(), 1),
  (gen_random_uuid()::text, '525e8e361fb51fd871520650a1dc5ed9028219905a63bf4c555a4f1ba0414659', now(), '20260522000000_add_review', NULL, NULL, now(), 1),
  (gen_random_uuid()::text, '505b8e7c57d75bda6c5871f1416bafb87dbe8b91a264bfcf072c350388bed045', now(), '20260531000000_embedding_job_pipeline', NULL, NULL, now(), 1),
  (gen_random_uuid()::text, 'ebb2d1d4686601c48eccdf6b35d2c2adf8100785fcef77a91a2827dd2b3d5994', now(), '20260602000000_departure_cancellation', NULL, NULL, now(), 1),
  (gen_random_uuid()::text, '7ed8cac96cd3ce6808858c58858b4b22956ceb1f2b9e9390b2c74530f3a5f93d', now(), '20260603000000_add_email_job', NULL, NULL, now(), 1),
  (gen_random_uuid()::text, 'a91ee26ab29cbcb04988fc33d1de8af09f744a3b6643b553c50ea9630e2f0874', now(), '20260604000000_phase8_ledger', NULL, NULL, now(), 1),
  (gen_random_uuid()::text, '1c85f0f1ecac2646718f5be89532af3afc07e663fbe1af62dbf30989ba9c9af7', now(), '20260604002728_phase5b_partial_refund', NULL, NULL, now(), 1),
  (gen_random_uuid()::text, '8dc7a494b6db38a334ea7c5c772d68a384d83cd55c7ff9e36f7a981d3646b441', now(), '20260607000000_phase13_partial_refund_email', NULL, NULL, now(), 1),
  (gen_random_uuid()::text, '763703851628332ccfde3ae510e0b35f68de217adbd1cae9029c45b834242480', now(), '20260608000000_phase14_penalty_policy', NULL, NULL, now(), 1),
  (gen_random_uuid()::text, 'c5e4c1457ab88b52355865de9dbf3e60c3818f6ec4bce8806a0569181d1f3304', now(), '20260608010000_phase15_review_report', NULL, NULL, now(), 1);

COMMIT;

-- 검증: 11행, finished_at 채워짐, rolled_back_at NULL 이어야 함
SELECT migration_name, (finished_at IS NOT NULL) AS applied, (rolled_back_at IS NULL) AS not_rolled_back
FROM "_prisma_migrations" ORDER BY migration_name;
