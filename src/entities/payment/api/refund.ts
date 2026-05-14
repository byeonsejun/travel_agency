/**
 * 환불 + RefundJob 보상 트랜잭션 (spec §5.4, domain-booking R7)
 *
 * Phase 1 (DB Tx) : RefundJob 중복 검사 + IN_PROGRESS enqueue
 * Phase 2 (외부 IO): tossClient.cancel — DB tx 밖 (R3 절대 규칙)
 * Phase 3 (DB Tx) : Payment CANCELED + RefundJob SUCCEEDED + PaymentEvent REFUND_REQUEST
 *
 * Phase 2 실패 시 → RefundJob PENDING + backoff(attempts) 재적재 → REFUND_DEFERRED throw
 * (cron worker가 비동기 재시도 — self-healing)
 *
 * booking 전이(좌석 환원)는 transitionStatus 내 shouldReturnSeats가 자동 처리.
 */

import type { BookingStatus, Prisma } from "@prisma/client";
import { db } from "@/shared/lib/db";
import { tossClient } from "@/shared/lib/toss";
import { transitionStatus } from "@/entities/booking";
import { PaymentError } from "./errors";

interface RefundInput {
  bookingId: string;
  actor: string;
  reason?: string;
}

// ── 지수 백오프: 30s / 5m / 30m / 2h / 6h ────────────────────────
const BACKOFF_DELAYS_MS = [
  30_000,                // attempt 0 실패 → 30초 후 재시도
  5 * 60_000,            // attempt 1 실패 → 5분
  30 * 60_000,           // attempt 2 실패 → 30분
  2 * 60 * 60_000,       // attempt 3 실패 → 2시간
  6 * 60 * 60_000,       // attempt 4+ 실패 → 6시간 (최대)
];

export function backoff(attempts: number): Date {
  const delayMs = BACKOFF_DELAYS_MS[Math.min(attempts, BACKOFF_DELAYS_MS.length - 1)];
  return new Date(Date.now() + delayMs);
}

const REFUNDABLE_STATUSES: BookingStatus[] = ["PAID", "READY"];

export async function refundBooking({ bookingId, actor, reason }: RefundInput): Promise<void> {
  // ── 사전 검증 1: booking 조회 + 환불 가능 상태 확인 ──────────
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, status: true },
  });

  if (!booking) throw new PaymentError("BOOKING_NOT_FOUND");
  if (!REFUNDABLE_STATUSES.includes(booking.status)) {
    throw new PaymentError("BOOKING_NOT_REFUNDABLE", { current: booking.status });
  }

  // ── 사전 검증 2: PAID Payment 1건 조회 ────────────────────────
  const paidPayment = await db.payment.findFirst({
    where: { bookingId, status: "PAID" },
    select: { id: true, amount: true, tossPaymentKey: true },
  });

  // tossPaymentKey 미설정 = PAID가 아니거나 데이터 이상 — 환불 불가
  if (!paidPayment?.tossPaymentKey) {
    throw new PaymentError("PAID_PAYMENT_NOT_FOUND");
  }

  // ── Phase 1: RefundJob 중복 검사 + IN_PROGRESS enqueue (DB Tx) ─
  // PENDING/IN_PROGRESS/SUCCEEDED 중 하나라도 있으면 이중 환불 차단
  const refundJob = await db.$transaction(async (tx) => {
    const existingJob = await tx.refundJob.findFirst({
      where: {
        bookingId,
        status: { in: ["PENDING", "IN_PROGRESS", "SUCCEEDED"] },
      },
      select: { id: true, status: true },
    });

    if (existingJob) {
      throw new PaymentError("REFUND_ALREADY_REQUESTED", {
        existingStatus: existingJob.status,
      });
    }

    return tx.refundJob.create({
      data: {
        bookingId,
        paymentId: paidPayment.id,
        amount: paidPayment.amount,
        reason: reason ?? null,
        status: "IN_PROGRESS",
      },
      select: { id: true, attempts: true },
    });
  });

  // ── Phase 2: 외부 PG 취소 호출 — DB tx 밖 (R3) ────────────────
  try {
    await tossClient.cancel({
      paymentKey: paidPayment.tossPaymentKey,
      cancelReason: reason ?? "사용자 환불 요청",
      cancelAmount: paidPayment.amount,
    });
  } catch (cancelErr) {
    // PG cancel 실패 → RefundJob PENDING 재적재 (지수 백오프)
    // cron worker가 nextRunAt 이후 재시도 (자가 치유)
    await db.refundJob.update({
      where: { id: refundJob.id },
      data: {
        status: "PENDING",
        attempts: { increment: 1 },
        nextRunAt: backoff(refundJob.attempts),
        lastError: String(cancelErr),
      },
    });
    throw new PaymentError("REFUND_DEFERRED", { cause: String(cancelErr) });
  }

  // ── Phase 3: Payment CANCELED + RefundJob SUCCEEDED + PaymentEvent ─
  await db.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: paidPayment.id },
      data: { status: "CANCELED", canceledAt: new Date() },
    });

    await tx.refundJob.update({
      where: { id: refundJob.id },
      data: { status: "SUCCEEDED" },
    });

    await tx.paymentEvent.create({
      data: {
        providerEventId: `refund:${paidPayment.id}:${Date.now()}`,
        bookingId,
        paymentId: paidPayment.id,
        type: "REFUND_REQUEST",
        payload: {
          bookingId,
          reason: reason ?? null,
          actor,
        } as unknown as Prisma.InputJsonValue,
        result: "PROCESSED",
      },
    });
  });

  // ── booking 상태 전이 (좌석 환원은 shouldReturnSeats 자동 처리) ─
  const targetStatus: BookingStatus = actor.startsWith("user:")
    ? "CANCELED_BY_USER"
    : "CANCELED_BY_AGENCY";

  await transitionStatus({
    bookingId,
    to: targetStatus,
    actor,
    reason: reason ?? "환불 처리 완료",
  });
}
