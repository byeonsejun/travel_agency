-- Wishlist (PRD §4.2) — 사용자가 관심 상품을 저장하는 즐겨찾기.
--
-- 이 프로젝트는 `prisma db push` 워크플로우다. 본 파일은 신규 환경 프로비저닝
-- 시 멱등하게 재적용 가능한 raw SQL 아티팩트로 박제한다 (전 구간 IF NOT EXISTS).
-- 가격/좌석 변동 알림은 의도적 미포함 — 체리피킹 유도 방지 (사용자 정책 결정).

CREATE TABLE IF NOT EXISTS "Wishlist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Wishlist_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Wishlist_userId_createdAt_idx"
    ON "Wishlist"("userId", "createdAt" DESC);

CREATE UNIQUE INDEX IF NOT EXISTS "Wishlist_userId_productId_key"
    ON "Wishlist"("userId", "productId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Wishlist_userId_fkey'
    ) THEN
        ALTER TABLE "Wishlist"
            ADD CONSTRAINT "Wishlist_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Wishlist_productId_fkey'
    ) THEN
        ALTER TABLE "Wishlist"
            ADD CONSTRAINT "Wishlist_productId_fkey"
            FOREIGN KEY ("productId") REFERENCES "Product"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
