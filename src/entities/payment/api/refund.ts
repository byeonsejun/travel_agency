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

import type { BookingStatus, Prisma, RefundKind } from "@prisma/client";
import { db } from "@/shared/lib/db";
import { tossClient } from "@/shared/lib/toss";
import { transitionStatus } from "@/entities/booking";
import { logger, metrics, captureException } from "@/shared/lib/observability";
import { PaymentError } from "./errors";
import { computePenalty } from "../model/penaltyPolicy";
import { reserveRefund } from "./ledger";
import { discretionaryKey } from "../model/refundKeys";

interface SagaCore {
  bookingId: string;
  paymentId: string;
  tossPaymentKey: string;
  amount: number;              // payment 총액
  prevRefundedAmount: number;  // reserve 전 refundedAmount (status 결정용)
  refundAmount: number;        // 이번 환불 실액
  penaltyAmount: number;
  baseAmount: number;
  seatsReleased: number;
  kind: RefundKind;
  idempotencyKey: string;
  actor: string;
  reason?: string;
}

/**
 * 공통 3-phase 환불 사가.
 * Phase1 멱등+예약(reserve) → Phase2 PG(Tx 밖) → Phase3 정산(settle).
 * onSettled: 정산 후 booking 전이·좌석·traveler 표식 등 부가 처리를 호출자가 주입.
 */
async function runRefundSaga(
  core: SagaCore,
  onSettled?: () => Promise<void>
): Promise<void> {
  // Phase 1: 멱등 검사 + reserve (DB Tx)
  const created = await db.$transaction(async (tx) => {
    const existing = await tx.refundJob.findUnique({
      where: { idempotencyKey: core.idempotencyKey },
      select: { id: true },
    });
    if (existing) return null; // 멱등 no-op

    const ok = await reserveRefund(tx, {
      paymentId: core.paymentId,
      amount: core.amount,
      requestedRefund: core.refundAmount,
    });
    if (!ok) throw new PaymentError("REFUND_EXCEEDS_REFUNDABLE", { requestedRefund: core.refundAmount });

    return tx.refundJob.create({
      data: {
        bookingId: core.bookingId,
        paymentId: core.paymentId,
        amount: core.refundAmount,
        penaltyAmount: core.penaltyAmount,
        baseAmount: core.baseAmount,
        seatsReleased: core.seatsReleased,
        kind: core.kind,
        idempotencyKey: core.idempotencyKey,
        reason: core.reason ?? null,
        actor: core.actor,
        status: "IN_PROGRESS",
      },
      select: { id: true, attempts: true },
    });
  });
  if (!created) return; // 멱등 종료

  // Phase 2: 외부 PG 취소 (Tx 밖 — ADR-0003)
  try {
    await tossClient.cancel({
      paymentKey: core.tossPaymentKey,
      cancelReason: core.reason ?? "환불 요청",
      cancelAmount: core.refundAmount,
      idempotencyKey: created.id,
    });
  } catch (err) {
    await db.refundJob.update({
      where: { id: created.id },
      data: {
        status: "PENDING",
        attempts: { increment: 1 },
        nextRunAt: backoff(created.attempts),
        lastError: String(err),
      },
    });
    metrics.incr("payment.refund.deferred");
    captureException(err, { bookingId: core.bookingId });
    throw new PaymentError("REFUND_DEFERRED", { cause: String(err) });
  }

  // Phase 3: 정산 (DB Tx)
  const newRefundedAmount = core.prevRefundedAmount + core.refundAmount;
  await db.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: core.paymentId },
      data: {
        status: newRefundedAmount >= core.amount ? "CANCELED" : "PARTIAL_CANCELED",
        canceledAt: new Date(),
      },
    });
    await tx.refundJob.update({ where: { id: created.id }, data: { status: "SUCCEEDED" } });
    await tx.paymentEvent.create({
      data: {
        providerEventId: `refund:${created.id}`,
        bookingId: core.bookingId,
        paymentId: core.paymentId,
        type: "REFUND_REQUEST",
        payload: {
          kind: core.kind,
          baseAmount: core.baseAmount,
          penaltyAmount: core.penaltyAmount,
          refundAmount: core.refundAmount,
          actor: core.actor,
        } as unknown as Prisma.InputJsonValue,
        result: "PROCESSED",
      },
    });
  });
  metrics.incr("payment.refund.success");

  if (onSettled) await onSettled();
}

interface DiscretionaryInput {
  bookingId: string;
  paymentId: string;
  amount: number;        // 환불 요청액
  actor: string;
  requestId: string;     // UI 생성 멱등 토큰
  reason?: string;
}

/** 관리자 재량 환불 — 좌석/booking/traveler 불변, 순수 금액 환불. */
export async function refundDiscretionary(input: DiscretionaryInput): Promise<void> {
  const payment = await db.payment.findFirst({
    where: { id: input.paymentId, status: { in: ["PAID", "PARTIAL_CANCELED"] } },
    select: { id: true, amount: true, refundedAmount: true, tossPaymentKey: true },
  });
  if (!payment?.tossPaymentKey) throw new PaymentError("PAID_PAYMENT_NOT_FOUND");

  await runRefundSaga({
    bookingId: input.bookingId,
    paymentId: payment.id,
    tossPaymentKey: payment.tossPaymentKey,
    amount: payment.amount,
    prevRefundedAmount: payment.refundedAmount,
    refundAmount: input.amount,
    penaltyAmount: 0,
    baseAmount: 0,
    seatsReleased: 0,
    kind: "DISCRETIONARY",
    idempotencyKey: discretionaryKey(input.bookingId, input.requestId),
    actor: input.actor,
    reason: input.reason,
  });
  // onSettled 없음 — 좌석/booking 전이 불필요
}

interface RefundInput {
  bookingId: string;
  actor: string;
  reason?: string;
  /** true = 표준약관 위약금 계산 후 부분 환불. false = 전액 환불 (admin 면제·cascade 경로). */
  applyPenalty: boolean;
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

export async function refundBooking({ bookingId, actor, reason, applyPenalty }: RefundInput): Promise<void> {
  // ── 사전 검증 1: booking 조회 + 환불 가능 상태 확인 ──────────
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      status: true,
      departure: { select: { departureDate: true } },
    },
  });

  if (!booking) throw new PaymentError("BOOKING_NOT_FOUND");
  if (!REFUNDABLE_STATUSES.includes(booking.status)) {
    metrics.incr("payment.refund.rejected", { reason: "BOOKING_NOT_REFUNDABLE" });
    throw new PaymentError("BOOKING_NOT_REFUNDABLE", { current: booking.status });
  }

  // ── 사전 검증 2: PAID Payment 1건 조회 ────────────────────────
  const paidPayment = await db.payment.findFirst({
    where: { bookingId, status: "PAID" },
    select: { id: true, amount: true, tossPaymentKey: true },
  });

  // tossPaymentKey 미설정 = PAID가 아니거나 데이터 이상 — 환불 불가
  if (!paidPayment?.tossPaymentKey) {
    metrics.incr("payment.refund.rejected", { reason: "PAID_PAYMENT_NOT_FOUND" });
    throw new PaymentError("PAID_PAYMENT_NOT_FOUND");
  }

  // ── 위약금 동결: applyPenalty면 표준약관 계산, 아니면 전액 환불 (spec §5.1) ──
  // 취소 요청 시점에 단 한 번 계산 후 RefundJob에 스냅샷 저장 — 이후 재계산 금지.
  const { penaltyAmount, refundAmount } = applyPenalty
    ? computePenalty({
        baseAmount: paidPayment.amount,
        departureDate: booking.departure.departureDate,
        now: new Date(),
      })
    : { penaltyAmount: 0, refundAmount: paidPayment.amount };

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
      metrics.incr("payment.refund.rejected", { reason: "REFUND_ALREADY_REQUESTED" });
      throw new PaymentError("REFUND_ALREADY_REQUESTED", {
        existingStatus: existingJob.status,
      });
    }

    return tx.refundJob.create({
      data: {
        bookingId,
        paymentId: paidPayment.id,
        amount: refundAmount,       // 위약금 차감 후 실제 환불액
        penaltyAmount,              // 취소 시점 동결된 위약금 스냅샷
        reason: reason ?? null,
        // actor를 보존해서 worker가 booking 전이 시 user/agency를 정확히 분기.
        actor,
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
      cancelAmount: refundAmount,   // 위약금 차감 후 환불액 (전액 환불 시 paidPayment.amount 동일)
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
    logger.error("payment.refund.pg_cancel_failed", cancelErr, { bookingId, refundJobId: refundJob.id });
    metrics.incr("payment.refund.deferred");
    captureException(cancelErr, { bookingId });
    throw new PaymentError("REFUND_DEFERRED", { cause: String(cancelErr) });
  }

  // ── Phase 3: Payment CANCELED/PARTIAL_CANCELED + RefundJob SUCCEEDED + PaymentEvent ─
  await db.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: paidPayment.id },
      data: {
        // 위약금 > 0이면 부분 취소(PARTIAL_CANCELED), 아니면 전액 취소(CANCELED)
        status: penaltyAmount > 0 ? "PARTIAL_CANCELED" : "CANCELED",
        canceledAt: new Date(),
      },
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
          // 감사 추적: 위약금 산정 근거 3-tuple 보존 (spec §5.2)
          baseAmount: paidPayment.amount,
          penaltyAmount,
          refundAmount,
        } as unknown as Prisma.InputJsonValue,
        result: "PROCESSED",
      },
    });
  });

  metrics.incr("payment.refund.success");

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
