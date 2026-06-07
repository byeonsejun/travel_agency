-- ALTER TYPE ... ADD VALUE는 트랜잭션 밖에서 실행되어야 한다(Postgres 제약).
ALTER TYPE "EmailType" ADD VALUE 'PARTIAL_REFUND_COMPLETED';

ALTER TABLE "EmailJob" ADD COLUMN "refundJobId" TEXT;
