-- Review & ReviewPhoto (PRD §4.2) — COMPLETED booking 보유자만 작성 가능한
-- 별점·텍스트·사진 후기 (1 booking = 1 review unique, 사진 정규화 1:N).
--
-- 이 프로젝트는 `prisma db push` 워크플로우다. 본 파일은 신규 환경 프로비저닝
-- 시 멱등하게 재적용 가능한 raw SQL 아티팩트로 박제한다 (전 구간 IF NOT EXISTS).
-- CREATE TYPE은 IF NOT EXISTS 미지원 → pg_type SELECT 가드로 대체.
-- 사진 storagePath는 product-images 버킷 + path prefix 분리 컨벤션:
--   review-photos/<reviewId>/<idx>.<ext>

-- CreateEnum (멱등 가드 — pg_type 존재 시 skip)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReviewStatus') THEN
        CREATE TYPE "ReviewStatus" AS ENUM ('PUBLISHED', 'HIDDEN', 'REPORTED');
    END IF;
END $$;

-- CreateTable: Review
CREATE TABLE IF NOT EXISTS "Review" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PUBLISHED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ReviewPhoto
CREATE TABLE IF NOT EXISTS "ReviewPhoto" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,

    CONSTRAINT "ReviewPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Review unique(bookingId) — 1 booking = 1 review 강제
CREATE UNIQUE INDEX IF NOT EXISTS "Review_bookingId_key"
    ON "Review"("bookingId");

-- CreateIndex: PDP 노출용 (status PUBLISHED + 최신순)
CREATE INDEX IF NOT EXISTS "Review_productId_status_createdAt_idx"
    ON "Review"("productId", "status", "createdAt" DESC);

-- CreateIndex: 마이페이지 본인 리뷰 목록용
CREATE INDEX IF NOT EXISTS "Review_userId_createdAt_idx"
    ON "Review"("userId", "createdAt" DESC);

-- CreateIndex: ReviewPhoto reviewId FK lookup 가속
CREATE INDEX IF NOT EXISTS "ReviewPhoto_reviewId_idx"
    ON "ReviewPhoto"("reviewId");

-- CreateIndex: ReviewPhoto (reviewId, order) unique — 동일 order 슬롯 중복 방지
CREATE UNIQUE INDEX IF NOT EXISTS "ReviewPhoto_reviewId_order_key"
    ON "ReviewPhoto"("reviewId", "order");

-- AddForeignKey (멱등 가드 — pg_constraint 이름 기반)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Review_bookingId_fkey'
    ) THEN
        ALTER TABLE "Review"
            ADD CONSTRAINT "Review_bookingId_fkey"
            FOREIGN KEY ("bookingId") REFERENCES "Booking"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Review_userId_fkey'
    ) THEN
        ALTER TABLE "Review"
            ADD CONSTRAINT "Review_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Review_productId_fkey'
    ) THEN
        ALTER TABLE "Review"
            ADD CONSTRAINT "Review_productId_fkey"
            FOREIGN KEY ("productId") REFERENCES "Product"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ReviewPhoto_reviewId_fkey'
    ) THEN
        ALTER TABLE "ReviewPhoto"
            ADD CONSTRAINT "ReviewPhoto_reviewId_fkey"
            FOREIGN KEY ("reviewId") REFERENCES "Review"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
