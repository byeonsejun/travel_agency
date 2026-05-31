-- EmbeddingJob async worker queue + ProductEmbedding.contentHash (B3 Task 1)
--
-- 이 프로젝트는 prisma db push / raw SQL 워크플로우다. 본 파일은 신규 환경
-- 프로비저닝 시 멱등하게 재적용 가능한 raw SQL 아티팩트다 (전 구간 IF NOT EXISTS).
-- CreateEnum은 IF NOT EXISTS 미지원 → pg_type SELECT 가드로 대체.

-- CreateEnum: EmbeddingJobStatus (멱등 가드)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EmbeddingJobStatus') THEN
        CREATE TYPE "EmbeddingJobStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED');
    END IF;
END $$;

-- CreateTable: EmbeddingJob
CREATE TABLE IF NOT EXISTS "EmbeddingJob" (
    "id"          TEXT NOT NULL,
    "productId"   TEXT NOT NULL,
    "status"      "EmbeddingJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts"    INTEGER NOT NULL DEFAULT 0,
    "lastError"   TEXT,
    "nextRunAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor"       TEXT,
    "contentHash" TEXT,
    "version"     INTEGER NOT NULL DEFAULT 0,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmbeddingJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: cron picker — WHERE status='PENDING' AND nextRunAt <= now()
CREATE INDEX IF NOT EXISTS "EmbeddingJob_status_nextRunAt_idx"
    ON "EmbeddingJob"("status", "nextRunAt");

-- CreateIndex: idempotent enqueue — 중복 PENDING 행 검사
CREATE INDEX IF NOT EXISTS "EmbeddingJob_productId_status_idx"
    ON "EmbeddingJob"("productId", "status");

-- AddForeignKey: EmbeddingJob → Product (멱등 가드)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'EmbeddingJob_productId_fkey'
    ) THEN
        ALTER TABLE "EmbeddingJob"
            ADD CONSTRAINT "EmbeddingJob_productId_fkey"
            FOREIGN KEY ("productId") REFERENCES "Product"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddColumn: ProductEmbedding.contentHash (nullable for backfill compatibility)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'ProductEmbedding' AND column_name = 'contentHash'
    ) THEN
        ALTER TABLE "ProductEmbedding" ADD COLUMN "contentHash" TEXT;
    END IF;
END $$;
