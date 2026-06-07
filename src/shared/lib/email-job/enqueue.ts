/**
 * enqueue.ts — EmailJob 멱등 enqueue SSOT (트랜잭셔널 아웃박스 적재부).
 *
 * find-then-create: Postgres 인터랙티브 Tx에서 unique 위반(P2002)은 Tx 전체를
 * abort시켜 후속 COMMIT을 깨뜨린다. 따라서 EmbeddingJob enqueue처럼 사전 조회로
 * 분기한다. dedupeKey @unique 는 동시성 백스톱(드문 동시 전이 시 두 번째 Tx 롤백).
 *
 * 허용 import: @prisma/client (타입만)
 * 금지: @/shared/lib/db, features/widgets/app
 */

import type { Prisma, EmailType } from "@prisma/client";

export interface EnqueueEmailJobArgs {
  type: EmailType;
  dedupeKey: string;
  bookingId: string;
  /** PARTIAL_REFUND_COMPLETED 타입일 때만 설정. 워커가 hydration 시 RefundJob을 직접 조회. */
  refundJobId?: string;
}

export async function enqueueEmailJob(
  tx: Prisma.TransactionClient,
  { type, dedupeKey, bookingId, refundJobId }: EnqueueEmailJobArgs,
): Promise<void> {
  const existing = await tx.emailJob.findUnique({
    where: { dedupeKey },
    select: { id: true },
  });
  if (existing) return; // 멱등 no-op

  await tx.emailJob.create({
    data: { type, dedupeKey, bookingId, refundJobId: refundJobId ?? null, status: "PENDING" },
  });
}
