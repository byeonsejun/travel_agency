/**
 * 토스페이먼츠 웹훅 핸들러 v2024-06-01 (ADR-0013) + 진위 검증 cross-check (ADR-0016).
 *
 * 책임:
 *  1. R4: providerEventId(webhook:${Tosspayments-Webhook-Transmission-Id})
 *         UNIQUE 멱등성 — 중복 전송 no-op.
 *  2. R9: 진위 검증 — 결제 조회 API cross-check (ADR-0016).
 *         payload paymentKey 로 GET /v1/payments/{paymentKey} 호출 후
 *         orderId/totalAmount/status 일치 여부 검증. 불일치 → InvalidSignatureError.
 *  3. R8: 모든 이벤트 수신 내역을 PaymentEvent 에 append-only 기록.
 *  4.     트랜잭션 성공 후 maybeApplyBookingTransitionV2 — confirm-API 와
 *         레이스 시 InvalidTransitionError swallow.
 *
 * 1차 dispatch 범위 (ADR-0013 §2):
 *  - PAYMENT_STATUS_CHANGED + data.status === "DONE" → Payment PAID 전이
 *  - 그 외 status·eventType → IGNORED no-op + PaymentEvent 기록
 */

import type { Prisma } from "@prisma/client";
import { db } from "@/shared/lib/db";
import { tossClient } from "@/shared/lib/toss";
import { transitionStatus, InvalidTransitionError } from "@/entities/booking";
import { logger, metrics } from "@/shared/lib/observability";
import {
  PaymentStatusChangedDataSchema,
  TossWebhookV2EventSchema,
  type TossPaymentStatusChangedData,
} from "../model/schemas";
import { PaymentError, InvalidSignatureError } from "./errors";

async function maybeApplyBookingTransitionV2(
  bookingId: string,
  transmissionId: string,
): Promise<void> {
  try {
    await transitionStatus({
      bookingId,
      to: "PAID",
      actor: `system:webhook:toss:${transmissionId}`,
      reason: `webhook PAYMENT_STATUS_CHANGED:DONE`,
    });
  } catch (err) {
    // confirm-API가 이미 PAID로 전이한 경우 — swallow (멱등)
    if (err instanceof InvalidTransitionError) return;
    throw err;
  }
}

/**
 * 결제 조회 API cross-check 진위 검증 (ADR-0016).
 *
 * webhook payload 의 paymentKey 로 토스 서버를 직접 조회해 orderId/totalAmount/status
 * 가 일치하는지 확인. 토스가 모르는 paymentKey(404) 또는 응답 불일치 → 위조 webhook
 * 으로 간주하여 InvalidSignatureError throw. 합법 webhook 인데 토스 OUTAGE 면 토스
 * 재전송(7회) 으로 자동 복구.
 */
async function crossCheckPayment(
  data: TossPaymentStatusChangedData,
): Promise<void> {
  let fresh;
  try {
    fresh = await tossClient.getPayment(data.paymentKey);
  } catch (err) {
    metrics.incr("payment.webhook.toss.invalid_sig");
    throw new InvalidSignatureError(
      `Cross-check failed: tossClient.getPayment threw (${(err as Error).message})`,
    );
  }
  if (
    fresh.orderId !== data.orderId ||
    fresh.totalAmount !== data.totalAmount ||
    fresh.status !== data.status
  ) {
    metrics.incr("payment.webhook.toss.invalid_sig");
    throw new InvalidSignatureError(
      "Webhook payload mismatched Toss record (cross-check)",
    );
  }
}

export async function handleTossWebhook({
  rawBody,
  signature: _signature,
  transmissionId,
}: {
  rawBody: string;
  /** ADR-0016 이후 미사용 — payout/seller webhook 도입 시 별도 재도입. */
  signature: string | null;
  transmissionId: string | null;
}): Promise<void> {
  // ── 멱등 키 — Tosspayments-Webhook-Transmission-Id 헤더 필수 ─
  // 토스 v2 가 모든 webhook 에 동봉. 외부(비-토스) 발신 차단의 1차 가드.
  if (!transmissionId) {
    metrics.incr("payment.webhook.toss.missing_transmission_id");
    throw new InvalidSignatureError(
      "Missing Tosspayments-Webhook-Transmission-Id header",
    );
  }

  // ── 파싱: v2 envelope ──────────────────────────────────────
  const json = JSON.parse(rawBody) as unknown;
  const envelope = TossWebhookV2EventSchema.parse(json);

  // ── R9: 진위 검증 — 결제 조회 API cross-check (ADR-0016) ──
  // PAYMENT_STATUS_CHANGED 만 cross-check 대상. 미지원 eventType 은 dispatch
  // 에서 IGNORED 처리되며 paymentKey 가 없을 수 있으므로 cross-check 스킵.
  if (envelope.eventType === "PAYMENT_STATUS_CHANGED") {
    const data = PaymentStatusChangedDataSchema.parse(envelope.data);
    await crossCheckPayment(data);
  }

  const idemKey = `webhook:${transmissionId}`;
  let processedBookingId: string | null = null;

  await db.$transaction(async (tx) => {
    // (1) 중복 — transmissionId 기반 멱등 키
    const existing = await tx.paymentEvent.findUnique({
      where: { providerEventId: idemKey },
    });
    if (existing) {
      metrics.incr("payment.webhook.toss.duplicate");
      logger.info("payment.webhook.duplicate", { providerEventId: idemKey });
      return;
    }

    // (2) eventType 분기 — 본 plan 은 PAYMENT_STATUS_CHANGED 만 처리.
    //     그 외(DEPOSIT_CALLBACK, CANCEL_STATUS_CHANGED, 브랜드페이/지급대행
    //     등)는 IGNORED no-op + PaymentEvent 기록 (다음 plan).
    if (envelope.eventType !== "PAYMENT_STATUS_CHANGED") {
      await tx.paymentEvent.create({
        data: {
          providerEventId: idemKey,
          type: `WEBHOOK:${envelope.eventType}`,
          payload: envelope as unknown as Prisma.InputJsonValue,
          result: "IGNORED",
          errorMessage: `Unsupported eventType: ${envelope.eventType}`,
        },
      });
      metrics.incr("payment.webhook.toss.ignored");
      logger.warn("payment.webhook.ignored", {
        providerEventId: idemKey,
        eventType: envelope.eventType,
      });
      return;
    }

    // (3) data 정밀 파싱
    const data = PaymentStatusChangedDataSchema.parse(envelope.data);

    // (4) Payment 조회 — orderId 위치가 data.* 로 이동
    const payment = await tx.payment.findUnique({
      where: { tossOrderId: data.orderId },
      include: {
        booking: {
          select: { id: true, status: true, userId: true, totalPrice: true },
        },
      },
    });

    if (!payment) {
      await tx.paymentEvent.create({
        data: {
          providerEventId: idemKey,
          type: `WEBHOOK:${envelope.eventType}:${data.status}`,
          payload: envelope as unknown as Prisma.InputJsonValue,
          result: "IGNORED",
          errorMessage: "Unknown orderId",
        },
      });
      metrics.incr("payment.webhook.toss.ignored");
      logger.warn("payment.webhook.ignored", {
        providerEventId: idemKey,
        orderId: data.orderId,
      });
      return;
    }

    // (5) status 분기 — 본 plan 1차: DONE 만 PAID 전이, 나머지 IGNORED.
    //     실패/취소(ABORTED/EXPIRED/CANCELED) 분기는 메인 흐름
    //     (cancelBookingAction, refund saga) 이 별도 경로로 처리 중 →
    //     별도 plan 에서 dispatch 확장.
    if (data.status !== "DONE") {
      await tx.paymentEvent.create({
        data: {
          providerEventId: idemKey,
          bookingId: payment.bookingId,
          paymentId: payment.id,
          type: `WEBHOOK:${envelope.eventType}:${data.status}`,
          payload: envelope as unknown as Prisma.InputJsonValue,
          result: "IGNORED",
          errorMessage: `Status ${data.status} not handled in v2 phase 1`,
        },
      });
      metrics.incr("payment.webhook.toss.ignored");
      return;
    }

    // (6) DONE 분기 — 기존 PAYMENT_DONE 로직과 의미 동일
    if (payment.status === "PAID") {
      await tx.paymentEvent.create({
        data: {
          providerEventId: idemKey,
          bookingId: payment.bookingId,
          paymentId: payment.id,
          type: `WEBHOOK:${envelope.eventType}:DONE`,
          payload: envelope as unknown as Prisma.InputJsonValue,
          result: "SKIPPED",
        },
      });
      return;
    }

    if (data.totalAmount !== payment.amount) {
      await tx.paymentEvent.create({
        data: {
          providerEventId: idemKey,
          bookingId: payment.bookingId,
          paymentId: payment.id,
          type: `WEBHOOK:${envelope.eventType}:DONE`,
          payload: envelope as unknown as Prisma.InputJsonValue,
          result: "FAILED",
          errorMessage: "Amount mismatch",
        },
      });
      throw new PaymentError("WEBHOOK_AMOUNT_MISMATCH", {
        expected: payment.amount,
        received: data.totalAmount,
      });
    }

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "PAID",
        tossPaymentKey: data.paymentKey,
        paidAt: data.approvedAt ? new Date(data.approvedAt) : new Date(),
        receiptUrl: data.receipt?.url ?? null,
      },
    });

    await tx.paymentEvent.create({
      data: {
        providerEventId: idemKey,
        bookingId: payment.bookingId,
        paymentId: payment.id,
        type: `WEBHOOK:${envelope.eventType}:DONE`,
        payload: envelope as unknown as Prisma.InputJsonValue,
        result: "PROCESSED",
      },
    });

    processedBookingId = payment.bookingId;
    metrics.incr("payment.webhook.toss.processed", {
      eventType: envelope.eventType,
      status: data.status,
    });
  });

  // ── 트랜잭션 성공 후 booking 상태 보정 (별도 트랜잭션) ────────────
  if (processedBookingId !== null) {
    await maybeApplyBookingTransitionV2(processedBookingId, transmissionId);
  }
}
