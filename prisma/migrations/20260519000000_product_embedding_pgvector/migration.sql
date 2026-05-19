-- M-AI-SEARCH Task 5 — pgvector 확장 + ProductEmbedding ivfflat 인덱스.
--
-- 이 프로젝트는 `prisma db push` 워크플로우이며 별도 migrate 베이스라인이
-- 없다. 본 파일은 **재현 가능한 멱등 raw SQL 아티팩트**로, 신규 환경
-- 프로비저닝/재적용 시 여러 번 실행해도 안전하다 (전 구간 IF NOT EXISTS).
-- Prisma는 vector 타입·ivfflat 인덱스를 관리하지 못하므로 raw SQL 동봉
-- (spec §1.2). 런타임 적용은 scripts/backfill-embeddings.ts가 수행한다.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS "ProductEmbedding" (
  "productId"    TEXT PRIMARY KEY,
  "vector"       vector(1536) NOT NULL,
  "modelVersion" TEXT NOT NULL,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductEmbedding_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- 코사인 거리(<=>) 정렬 가속. lists=100은 시드 규모 기준 보수값.
CREATE INDEX IF NOT EXISTS product_embedding_vector_idx
  ON "ProductEmbedding" USING ivfflat (vector vector_cosine_ops)
  WITH (lists = 100);
