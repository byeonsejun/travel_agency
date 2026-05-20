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

/**
 * booking 단건의 활성(PENDING/IN_PROGRESS) RefundJob 조회.
 * BookingDetail UI 게이트용 — 활성 RefundJob이 있으면 cancel 버튼을 숨기고
 * "환불 처리 중 — 자동 재시도" 안내를 노출하기 위함.
 * SUCCEEDED/FAILED는 종료 상태라 게이트에 포함하지 않는다.
 */
export async function findActiveRefundJob(bookingId: string) {
  return db.refundJob.findFirst({
    where: { bookingId, status: { in: ["PENDING", "IN_PROGRESS"] } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      attempts: true,
      nextRunAt: true,
      lastError: true,
    },
  });
}

export type ActiveRefundJob = NonNullable<
  Awaited<ReturnType<typeof findActiveRefundJob>>
>;

type RefundJobStatusFilter = "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED";

interface ListRefundJobsOptions {
  status?: RefundJobStatusFilter;
  limit?: number;
}

/**
 * 관리자 환불 모니터링 대시보드용 — RefundJob 목록 조회.
 * 상태 필터·limit 지원. booking.user 정보와 함께 반환.
 */
export async function listRefundJobs({
  status,
  limit = 50,
}: ListRefundJobsOptions = {}) {
  return db.refundJob.findMany({
    where: status !== undefined ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      bookingId: true,
      amount: true,
      reason: true,
      actor: true,
      status: true,
      attempts: true,
      lastError: true,
      nextRunAt: true,
      createdAt: true,
      booking: {
        select: {
          user: { select: { name: true, email: true } },
          departure: {
            select: {
              product: { select: { title: true } },
            },
          },
        },
      },
    },
  });
}

export type RefundJobRow = Awaited<ReturnType<typeof listRefundJobs>>[number];
