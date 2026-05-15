/**
 * 3-Phase 결제 승인 함수 (spec §3.3).
 *
 * Phase 1 (DB Tx-1) : Payment row 멱등성 확보 + 사전 검증
 * Phase 2 (외부 IO) : tossClient.confirm — DB tx 밖 (R3)
 * Phase 3 (DB Tx-2/3): Payment PAID + BookingEvent + booking 상태 전이
 *
 * Phase 3 DB 실패 시 → compensateCancel (동기 PG cancel + RefundJob enqueue) 후 throw.
 */

import type { Prisma } from "@prisma/client";
import { db } from "@/shared/lib/db";
import { tossClient } from "@/shared/lib/toss";
import type { TossConfirmResponse } from "@/shared/lib/toss";
import { transitionStatus } from "@/entities/booking";
import { logger, metrics, captureException } from "@/shared/lib/observability";
import { parseBookingIdFromOrderId } from "./orderId";
import { assertAmountMatches } from "./crossCheck";
import { PaymentError } from "./errors";

interface ConfirmInput {
  userId: string;
  paymentKey: string;
  orderId: string;
  amount: number;
}

export interface ConfirmResult {
  bookingId: string;
  status: "PAID" | "FAILED";
  failureMessage?: string;
}

interface CompensateCancelInput {
  paymentKey: string;
  paymentId: string;
  bookingId: string;
  cancelAmount: number;
  reason: string;
}

async function compensateCancel({
  paymentKey,
  paymentId,
  bookingId,
  cancelAmount,
  reason,
}: CompensateCancelInput): Promise<void> {
  try {
    await tossClient.cancel({ paymentKey, cancelReason: reason, cancelAmount });

    // PG cancel 성공 → DB에 보상 결과 기록
    await db.$transaction([
      db.payment.update({
        where: { id: paymentId },
        data: { status: "CANCELED", canceledAt: new Date() },
      }),
      db.paymentEvent.create({
        data: {
          providerEventId: `compensate:${paymentKey}:${reason}`,
          bookingId,
          paymentId,
          type: "COMPENSATE_CANCEL",
          payload: { reason, cancelAmount } as unknown as Prisma.InputJsonValue,
          result: "PROCESSED",
        },
      }),
    ]);
  } catch (cancelErr) {
    // PG cancel 실패 — 재시도 큐에 적재 (R7)
    logger.error("payment.compensate_cancel.pg_failed", cancelErr, { paymentKey, bookingId, reason });
    metrics.incr("payment.compensate_cancel.pg_failed");
    captureException(cancelErr, { bookingId, paymentId });
    try {
      await db.refundJob.create({
        data: {
          bookingId,
          paymentId,
          amount: cancelAmount,
          reason,
          status: "PENDING",
        },
      });
    } catch (dbErr) {
      logger.error("payment.compensate_cancel.enqueue_failed", dbErr, { paymentKey, bookingId });
      metrics.incr("payment.compensate_cancel.enqueue_failed");
      captureException(dbErr, { bookingId, paymentId });
    }
  }
}

export async function confirmPayment(input: ConfirmInput): Promise<ConfirmResult> {
  // ── Phase 1: DB Tx-1 — 멱등성 확보 + Payment row 생성 ─────────
  const { bookingId, payment } = await db.$transaction(async (tx) => {
    const existing = await tx.payment.findUnique({
      where: { tossOrderId: input.orderId },
      include: {
        booking: { select: { id: true, userId: true, status: true, totalPrice: true } },
      },
    });

    if (existing) {
      // 이미 PAID면 멱등 반환
      if (existing.status === "PAID") {
        return { bookingId: existing.bookingId, payment: existing };
      }
      // PENDING: 소유권 검증 후 진행
      const existingBooking = existing.booking;
      if (!existingBooking || existingBooking.userId !== input.userId) {
        throw new PaymentError("FORBIDDEN");
      }
      return { bookingId: existing.bookingId, payment: existing };
    }

    // 신규 시도 — orderId에서 bookingId 파싱
    const rawBookingId = parseBookingIdFromOrderId(input.orderId);
    const booking = await tx.booking.findUnique({
      where: { id: rawBookingId },
      select: { id: true, userId: true, status: true, totalPrice: true },
    });

    if (!booking) throw new PaymentError("BOOKING_NOT_FOUND");
    if (booking.userId !== input.userId) throw new PaymentError("FORBIDDEN");
    if (booking.status !== "DEPARTURE_CONFIRMED") {
      throw new PaymentError("BOOKING_NOT_PAYABLE", { current: booking.status });
    }

    // 1차 금액 검증 (R6): 클라이언트 요청 금액 vs DB booking.totalPrice
    assertAmountMatches(booking.totalPrice, input.amount, "request");

    const newPayment = await tx.payment.create({
      data: {
        bookingId: booking.id,
        method: "CARD",
        amount: booking.totalPrice,
        status: "PENDING",
        tossOrderId: input.orderId,
      },
      include: {
        booking: { select: { id: true, userId: true, status: true, totalPrice: true } },
      },
    });

    return { bookingId: booking.id, payment: newPayment };
  });

  // 이미 PAID였으면 즉시 반환 (멱등)
  if (payment.status === "PAID") {
    return { bookingId, status: "PAID" };
  }

  // ── Phase 2: 외부 PG 호출 — DB tx 밖 (R3 절대 규칙) ──────────
  let pg: TossConfirmResponse;
  try {
    pg = await tossClient.confirm({
      paymentKey: input.paymentKey,
      orderId: input.orderId,
      amount: input.amount,
    });
  } catch (err) {
    // 네트워크/타임아웃 — 결제 성공 여부 불명, 웹훅이 보정
    await db.$transaction([
      db.payment.update({
        where: { id: payment.id },
        data: { status: "FAILED", failureCode: "PG_NETWORK", failureMessage: String(err) },
      }),
      db.paymentEvent.create({
        data: {
          providerEventId: `confirm:${input.paymentKey}:network-error:${Date.now()}`,
          bookingId,
          paymentId: payment.id,
          type: "CONFIRM_REQUEST",
          payload: { error: String(err) } as unknown as Prisma.InputJsonValue,
          result: "FAILED",
          errorMessage: String(err),
        },
      }),
    ]);
    throw new PaymentError("PG_NETWORK_ERROR", { cause: String(err) });
  }

  // ── Phase 3a: PG 응답 "DONE" ───────────────────────────────────
  if (pg.status === "DONE") {
    // 2차 금액 검증 (R6): PG 응답 totalAmount vs DB payment.amount
    try {
      assertAmountMatches(payment.amount, pg.totalAmount, "pg-response");
    } catch (amountErr) {
      // 금액 불일치 → 즉시 보상 cancel (R7)
      await compensateCancel({
        paymentKey: input.paymentKey,
        paymentId: payment.id,
        bookingId,
        cancelAmount: pg.totalAmount,
        reason: "AMOUNT_MISMATCH_PG_RESPONSE",
      });
      throw amountErr;
    }

    // DB Tx-2: Payment PAID + PaymentEvent PROCESSED 단일 트랜잭션 (R8)
    try {
      await db.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: "PAID",
            tossPaymentKey: input.paymentKey,
            paidAt: new Date(pg.approvedAt),
            receiptUrl: pg.receipt?.url ?? null,
          },
        });
        await tx.paymentEvent.create({
          data: {
            providerEventId: `confirm:${input.paymentKey}`,
            bookingId,
            paymentId: payment.id,
            type: "CONFIRM_REQUEST",
            payload: { ...pg } as unknown as Prisma.InputJsonValue,
            result: "PROCESSED",
          },
        });
      });

      // DB Tx-3: booking → PAID (별도 트랜잭션 — 의도적 분리, spec §5.2)
      // transitionStatus 내부에서 assertTransition + BookingEvent append 자동 처리
      await transitionStatus({
        bookingId,
        to: "PAID",
        actor: `system:payment:confirm:${input.paymentKey}`,
        reason: `tossPaymentKey=${input.paymentKey}`,
      });
    } catch (dbErr) {
      // PG는 승인됐는데 DB 갱신 실패 → 강제 보상 cancel (R7)
      await compensateCancel({
        paymentKey: input.paymentKey,
        paymentId: payment.id,
        bookingId,
        cancelAmount: pg.totalAmount,
        reason: "DB_UPDATE_FAILED",
      });
      throw new PaymentError("DB_UPDATE_FAILED", { cause: String(dbErr) });
    }

    return { bookingId, status: "PAID" };
  }

  // ── Phase 3b: PG 명시적 실패 응답 ─────────────────────────────
  await db.$transaction([
    db.payment.update({
      where: { id: payment.id },
      data: {
        status: "FAILED",
        failureCode: pg.failure?.code ?? "UNKNOWN",
        failureMessage: pg.failure?.message ?? null,
      },
    }),
    db.paymentEvent.create({
      data: {
        providerEventId: `confirm:${input.paymentKey}:failure:${Date.now()}`,
        bookingId,
        paymentId: payment.id,
        type: "CONFIRM_REQUEST",
        payload: { ...pg } as unknown as Prisma.InputJsonValue,
        result: "FAILED",
        errorMessage: pg.failure?.message ?? "PG returned non-DONE status",
      },
    }),
  ]);

  return { bookingId, status: "FAILED", failureMessage: pg.failure?.message };
}
