/**
 * observability.ts — 운영 대시보드용 PaymentEvent·RefundJob 관측 쿼리.
 *
 * read-only. 비즈니스 로직 없음. 외부 레이어(app/api/admin, scripts)가 사용.
 */

import { db } from "@/shared/lib/db";

interface ListPaymentEventsOptions {
  limit?: number;
  type?: string;
  since?: Date;
}

export async function listRecentPaymentEvents({
  limit = 50,
  type,
  since,
}: ListPaymentEventsOptions = {}) {
  return db.paymentEvent.findMany({
    where: {
      ...(type !== undefined ? { type } : {}),
      ...(since !== undefined ? { createdAt: { gte: since } } : {}),
    },
    select: {
      id: true,
      providerEventId: true,
      bookingId: true,
      paymentId: true,
      type: true,
      payload: true,
      result: true,
      errorMessage: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function summarizeRefundJobs() {
  const [grouped, oldestPending] = await Promise.all([
    db.refundJob.groupBy({
      by: ["status"],
      _count: { id: true },
    }),
    db.refundJob.findFirst({
      where: { status: "PENDING" },
      orderBy: { nextRunAt: "asc" },
      select: {
        id: true,
        bookingId: true,
        amount: true,
        nextRunAt: true,
        attempts: true,
      },
    }),
  ]);

  const statusCounts = Object.fromEntries(
    grouped.map((g) => [g.status, g._count.id])
  );

  return { statusCounts, oldestPending };
}
