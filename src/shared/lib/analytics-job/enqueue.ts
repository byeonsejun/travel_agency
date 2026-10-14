/**
 * enqueue.ts — AnalyticsJob 멱등 enqueue SSOT (트랜잭셔널 아웃박스 적재부, ADR-0062).
 *
 * EmailJob enqueue 와 동형 find-then-create: Postgres 인터랙티브 Tx 에서 unique 위반(P2002)은
 * Tx 전체를 abort 시켜 결제/환불 COMMIT 을 깨뜨리므로 사전 조회로 분기한다.
 * dedupeKey @unique 는 동시성 백스톱.
 *
 * 허용 import: @prisma/client (타입만)
 * 금지: @/shared/lib/db, features/widgets/app
 */

import type { AnalyticsEventType, Prisma } from "@prisma/client";

export interface EnqueueAnalyticsJobArgs {
  type: AnalyticsEventType;
  dedupeKey: string;
  bookingId: string;
  /** REFUND 일 때만. 워커가 RefundJob.amount 를 조회. */
  refundJobId?: string;
  /** 이벤트 발생 시각 → MP timestamp_micros. */
  occurredAt: Date;
}

export async function enqueueAnalyticsJob(
  tx: Prisma.TransactionClient,
  { type, dedupeKey, bookingId, refundJobId, occurredAt }: EnqueueAnalyticsJobArgs,
): Promise<void> {
  const existing = await tx.analyticsJob.findUnique({
    where: { dedupeKey },
    select: { id: true },
  });
  if (existing) return; // 멱등 no-op

  await tx.analyticsJob.create({
    data: {
      type,
      dedupeKey,
      bookingId,
      refundJobId: refundJobId ?? null,
      occurredAt,
      status: "PENDING",
    },
  });
}
