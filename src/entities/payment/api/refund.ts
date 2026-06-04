/**
 * 환불 + RefundJob 보상 트랜잭션 (spec §5.4, domain-booking R7)
 *
 * Phase 1 (DB Tx) : RefundJob 중복 검사 + IN_PROGRESS enqueue (reserve)
 * Phase 2 (외부 IO): tossClient.cancel — DB tx 밖 (R3 절대 규칙)
 * Phase 3 (DB Tx) : Payment CANCELED/PARTIAL_CANCELED + RefundJob SUCCEEDED + PaymentEvent REFUND_REQUEST
 *
 * Phase 2 실패 시 → RefundJob PENDING + backoff(attempts) 재적재 → REFUND_DEFERRED throw
 * (cron worker가 비동기 재시도 — self-healing)
 *
 * booking 전이(좌석 환원)는 onSettled 콜백 또는 transitionStatusTx에서 처리.
 */

import type { PaxType, Prisma, RefundKind } from "@prisma/client";
import { db } from "@/shared/lib/db";
import { tossClient } from "@/shared/lib/toss";
import {
  transitionStatusTx,
  releaseSeats as releaseSeatsRaw,
} from "@/entities/booking";
import { metrics, captureException } from "@/shared/lib/observability";
import { PaymentError } from "./errors";
import { computePenalty } from "../model/penaltyPolicy";
import { reserveRefund } from "./ledger";
import {
  discretionaryKey,
  travelerCancelKey,
  fullCancelKey,
} from "../model/refundKeys";

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

/**
 * 취소 여행자 목록으로 환불 base + 좌석 환원 수를 계산하는 순수 함수.
 * ADULT/CHILD만 좌석 점유(INFANT 미차감).
 */
export function computeCanceledBase(
  travelers: { paxType: PaxType | null; unitPrice: number }[]
): { canceledBase: number; seatsReleased: number } {
  let canceledBase = 0;
  let seatsReleased = 0;
  for (const t of travelers) {
    canceledBase += t.unitPrice;
    if (t.paxType === "ADULT" || t.paxType === "CHILD") seatsReleased += 1;
  }
  return { canceledBase, seatsReleased };
}

interface TravelerCancelInput {
  bookingId: string;
  travelerIds: string[];
  actor: string;
  applyPenalty: boolean;
  reason?: string;
}

/** 여행자 부분 취소 — 취소분 base에 위약금 적용, 좌석 N개 환원, 마지막이면 booking terminal. */
export async function refundTraveler(input: TravelerCancelInput): Promise<void> {
  const booking = await db.booking.findUnique({
    where: { id: input.bookingId },
    select: {
      id: true,
      status: true,
      departureId: true,
      departure: { select: { departureDate: true } },
      travelers: { select: { id: true, paxType: true, unitPrice: true, canceledAt: true } },
    },
  });
  if (!booking) throw new PaymentError("BOOKING_NOT_FOUND");
  if (!["PAID", "READY"].includes(booking.status)) {
    throw new PaymentError("BOOKING_NOT_REFUNDABLE", { current: booking.status });
  }

  const targetTravelers = booking.travelers.filter(
    (t) => input.travelerIds.includes(t.id) && t.canceledAt === null
  );
  if (targetTravelers.length === 0) throw new PaymentError("NO_ACTIVE_TRAVELERS");

  const { canceledBase, seatsReleased } = computeCanceledBase(targetTravelers);
  const { penaltyAmount, refundAmount } = input.applyPenalty
    ? computePenalty({ baseAmount: canceledBase, departureDate: booking.departure.departureDate, now: new Date() })
    : { penaltyAmount: 0, refundAmount: canceledBase };

  const payment = await db.payment.findFirst({
    where: { bookingId: input.bookingId, status: { in: ["PAID", "PARTIAL_CANCELED"] } },
    select: { id: true, amount: true, refundedAmount: true, tossPaymentKey: true },
  });
  if (!payment?.tossPaymentKey) throw new PaymentError("PAID_PAYMENT_NOT_FOUND");

  // 취소 후 남은 활성 여행자 수 → 0이면 booking terminal
  const remainingActive = booking.travelers.filter(
    (t) => t.canceledAt === null && !input.travelerIds.includes(t.id)
  ).length;
  const isLast = remainingActive === 0;

  const idempotencyKey = isLast
    ? fullCancelKey(booking.id)
    : travelerCancelKey(booking.id, input.travelerIds);

  await runRefundSaga(
    {
      bookingId: booking.id,
      paymentId: payment.id,
      tossPaymentKey: payment.tossPaymentKey,
      amount: payment.amount,
      prevRefundedAmount: payment.refundedAmount,
      refundAmount,
      penaltyAmount,
      baseAmount: canceledBase,
      seatsReleased,
      kind: isLast ? "FULL_CANCEL" : "TRAVELER_CANCEL",
      idempotencyKey,
      actor: input.actor,
      reason: input.reason,
    },
    async () => {
      // settle 후처리: traveler 표식 + 좌석 정밀 환원 + (마지막이면) terminal 전이
      await db.$transaction(async (tx) => {
        // traveler 표식 — 취소 RefundJob ID 연결
        const rj = await tx.refundJob.findFirstOrThrow({
          where: { idempotencyKey },
          select: { id: true },
        });
        await tx.traveler.updateMany({
          where: { id: { in: input.travelerIds }, canceledAt: null },
          data: { canceledAt: new Date(), canceledByRefundJobId: rj.id },
        });
        // 좌석 정밀 환원 (사가가 이미 seatsReleased를 RefundJob에 기록)
        if (seatsReleased > 0) {
          await releaseSeatsRaw(tx, booking.departureId, seatsReleased);
        }
        // 마지막 여행자면 booking terminal 전이 (skipSeatReturn — 좌석 이중환원 방지)
        if (isLast) {
          await transitionStatusTx(tx, {
            bookingId: booking.id,
            to: input.actor.startsWith("user:") ? "CANCELED_BY_USER" : "CANCELED_BY_AGENCY",
            actor: input.actor,
            reason: input.reason ?? "전체 여행자 취소 완료",
            skipSeatReturn: true,
          });
        }
      });
    }
  );
}

/** 하위호환: 예약 전체 취소 — 모든 활성 여행자를 refundTraveler에 위임. */
export async function refundBooking({
  bookingId,
  actor,
  reason,
  applyPenalty,
}: {
  bookingId: string;
  actor: string;
  reason?: string;
  applyPenalty: boolean;
}): Promise<void> {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: { travelers: { where: { canceledAt: null }, select: { id: true } } },
  });
  if (!booking) throw new PaymentError("BOOKING_NOT_FOUND");
  await refundTraveler({
    bookingId,
    travelerIds: booking.travelers.map((t) => t.id),
    actor,
    applyPenalty,
    reason,
  });
}
