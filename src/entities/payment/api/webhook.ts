/**
 * 토스페이먼츠 웹훅 핸들러 (spec §4.3).
 *
 * 책임:
 *  1. R9: HMAC-SHA256 서명 검증 — 위조 요청 즉시 거부
 *  2. R4: providerEventId(webhook:${eventId}) UNIQUE 멱등성 — 중복 이벤트 no-op
 *  3. R8: 모든 이벤트 수신 내역을 PaymentEvent에 append-only 기록
 *  4.     트랜잭션 성공 후 maybeApplyBookingTransition — confirm-API와 레이스 시 swallow
 */

import type { Prisma } from "@prisma/client";
import { db } from "@/shared/lib/db";
import { verifyTossSignature } from "@/shared/lib/toss";
import { env } from "@/shared/lib/env";
import { transitionStatus, InvalidTransitionError } from "@/entities/booking";
import { TossWebhookEventSchema } from "../model/schemas";
import type { TossWebhookEvent } from "../model/schemas";
import { PaymentError, InvalidSignatureError } from "./errors";

type TxClient = Omit<Prisma.TransactionClient, "$transaction" | "$disconnect" | "$connect" | "$on" | "$use" | "$extends">;

type PaymentRow = {
  id: string;
  bookingId: string;
  status: string;
  amount: number;
  booking: {
    id: string;
    status: string;
    userId: string;
    totalPrice: number;
  } | null;
};

async function recordEvent(
  tx: TxClient,
  providerEventId: string,
  event: TossWebhookEvent,
  payment: PaymentRow | null,
  result: "PROCESSED" | "SKIPPED" | "IGNORED" | "FAILED",
  errorMessage?: string
): Promise<void> {
  await tx.paymentEvent.create({
    data: {
      providerEventId,
      bookingId: payment?.bookingId ?? null,
      paymentId: payment?.id ?? null,
      type: `WEBHOOK:${event.type}`,
      payload: { ...event } as unknown as Prisma.InputJsonValue,
      result,
      ...(errorMessage !== undefined ? { errorMessage } : {}),
    },
  });
}

async function maybeApplyBookingTransition(
  event: TossWebhookEvent,
  bookingId: string
): Promise<void> {
  if (event.type !== "PAYMENT_DONE" && event.type !== "PAYMENT_CONFIRMED") return;

  try {
    await transitionStatus({
      bookingId,
      to: "PAID",
      actor: `system:webhook:toss:${event.eventId}`,
      reason: `webhook ${event.type}`,
    });
  } catch (err) {
    // confirm-API가 이미 PAID로 전이한 경우 — swallow (멱등)
    if (err instanceof InvalidTransitionError) return;
    throw err;
  }
}

export async function handleTossWebhook({
  rawBody,
  signature,
}: {
  rawBody: string;
  signature: string | null;
}): Promise<void> {
  // ── R9: 서명 검증 ─────────────────────────────────────────────
  if (!signature) {
    throw new InvalidSignatureError();
  }

  const secret = env.TOSS_WEBHOOK_SECRET;
  if (secret !== undefined) {
    if (!verifyTossSignature(rawBody, signature, secret)) {
      throw new InvalidSignatureError();
    }
  } else if (env.NODE_ENV === "production") {
    // prod에서 secret 미설정 — env superRefine으로 이미 부팅 거부했어야 하지만 방어
    throw new InvalidSignatureError("TOSS_WEBHOOK_SECRET not configured in production");
  }
  // dev/test: secret 미설정 시 경고 없이 통과 (로컬 테스트 편의)

  // ── 파싱 + 스키마 검증 ─────────────────────────────────────────
  const json = JSON.parse(rawBody) as unknown;
  const event = TossWebhookEventSchema.parse(json);
  const idemKey = `webhook:${event.eventId}`;

  // ── R4: 멱등성 + 상태 업데이트 단일 트랜잭션 ────────────────────
  let processedBookingId: string | null = null;

  await db.$transaction(async (tx) => {
    // (1) 중복 이벤트 — 즉시 no-op (R4)
    const existing = await tx.paymentEvent.findUnique({
      where: { providerEventId: idemKey },
    });
    if (existing) return;

    // (2) Payment 조회 — 없으면 IGNORED
    const payment = await tx.payment.findUnique({
      where: { tossOrderId: event.orderId },
      include: {
        booking: { select: { id: true, status: true, userId: true, totalPrice: true } },
      },
    });

    if (!payment) {
      await recordEvent(tx as unknown as TxClient, idemKey, event, null, "IGNORED", "Unknown orderId");
      return;
    }

    // (3) type별 분기 — R8: 모든 분기 끝에 PaymentEvent 기록
    switch (event.type) {
      case "PAYMENT_DONE":
      case "PAYMENT_CONFIRMED": {
        if (payment.status === "PAID") {
          await recordEvent(tx as unknown as TxClient, idemKey, event, payment, "SKIPPED");
          return;
        }
        if (event.totalAmount !== payment.amount) {
          await recordEvent(tx as unknown as TxClient, idemKey, event, payment, "FAILED", "Amount mismatch");
          throw new PaymentError("WEBHOOK_AMOUNT_MISMATCH", {
            expected: payment.amount,
            received: event.totalAmount,
          });
        }
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: "PAID",
            tossPaymentKey: event.paymentKey ?? null,
            paidAt: event.approvedAt ? new Date(event.approvedAt) : new Date(),
            receiptUrl: event.receipt?.url ?? null,
          },
        });
        await recordEvent(tx as unknown as TxClient, idemKey, event, payment, "PROCESSED");
        processedBookingId = payment.bookingId;
        break;
      }

      case "PAYMENT_FAILED":
      case "PAYMENT_ABORTED": {
        if (payment.status === "FAILED" || payment.status === "CANCELED") {
          await recordEvent(tx as unknown as TxClient, idemKey, event, payment, "SKIPPED");
          return;
        }
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: "FAILED",
            failureCode: event.failure?.code ?? "UNKNOWN",
            failureMessage: event.failure?.message ?? null,
          },
        });
        await recordEvent(tx as unknown as TxClient, idemKey, event, payment, "PROCESSED");
        break;
      }

      case "PAYMENT_CANCELED": {
        if (payment.status === "CANCELED") {
          await recordEvent(tx as unknown as TxClient, idemKey, event, payment, "SKIPPED");
          return;
        }
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: "CANCELED",
            canceledAt: event.canceledAt ? new Date(event.canceledAt) : new Date(),
          },
        });
        await recordEvent(tx as unknown as TxClient, idemKey, event, payment, "PROCESSED");
        break;
      }

      default: {
        await recordEvent(
          tx as unknown as TxClient,
          idemKey,
          event,
          payment,
          "IGNORED",
          `Unknown type: ${event.type}`
        );
        return;
      }
    }
  });

  // ── 트랜잭션 성공 후 booking 상태 보정 (별도 트랜잭션) ────────────
  // InvalidTransitionError는 swallow — confirm-API와의 레이스 컨디션 멱등 처리
  if (processedBookingId !== null) {
    await maybeApplyBookingTransition(event, processedBookingId);
  }
}
