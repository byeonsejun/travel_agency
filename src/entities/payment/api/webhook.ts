/**
 * 토스페이먼츠 웹훅 핸들러 v2024-06-01 (plan 2026-05-24-toss-webhook-v2).
 *
 * 책임:
 *  1. R9: HMAC-SHA256 서명 검증 — dev 한정 임시 우회 (commit a1b425d).
 *         Verification 정식 메커니즘은 별도 plan 에서 정착.
 *  2. R4: providerEventId(webhook:${Tosspayments-Webhook-Transmission-Id})
 *         UNIQUE 멱등성 — 중복 전송 no-op.
 *  3. R8: 모든 이벤트 수신 내역을 PaymentEvent 에 append-only 기록.
 *  4.     트랜잭션 성공 후 maybeApplyBookingTransitionV2 — confirm-API 와
 *         레이스 시 InvalidTransitionError swallow.
 *
 * 1차 dispatch 범위 (plan §Design Decisions §2):
 *  - PAYMENT_STATUS_CHANGED + data.status === "DONE" → Payment PAID 전이
 *  - 그 외 status·eventType → IGNORED no-op + PaymentEvent 기록
 */

import type { Prisma } from "@prisma/client";
import { db } from "@/shared/lib/db";
import { verifyTossSignature } from "@/shared/lib/toss";
import { env } from "@/shared/lib/env";
import { transitionStatus, InvalidTransitionError } from "@/entities/booking";
import { logger, metrics } from "@/shared/lib/observability";
import {
  PaymentStatusChangedDataSchema,
  TossWebhookV2EventSchema,
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

export async function handleTossWebhook({
  rawBody,
  signature,
  transmissionId,
}: {
  rawBody: string;
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

  // ── R9: 서명 검증 ─────────────────────────────────────────────
  //
  // ⚠️ TEMPORARY (TODO: webhook v2024-06-01 verification 마이그레이션 — 별도 plan):
  // 토스 v2024-06-01 webhook 은 HMAC `toss-signature` 헤더를 *발송하지 않는다.*
  // 대신 body 의 `data.secret`(결제 건별 secret) + transmission-id 기반
  // verification 메커니즘. 본 코드의 HMAC 분기는 구버전 호환용으로만 남고,
  // `development` 환경에서만 signature 부재 시 통과한다 (dev e2e 진행 위해).
  // production·test 는 여전히 throw → 실거래 안전성 + 단위 테스트 invariant 보존.
  if (!signature) {
    if (env.NODE_ENV !== "development") {
      metrics.incr("payment.webhook.toss.invalid_sig");
      throw new InvalidSignatureError();
    }
    metrics.incr("payment.webhook.toss.dev_signature_skipped");
  } else {
    const secret = env.TOSS_WEBHOOK_SECRET;
    if (secret !== undefined) {
      if (!verifyTossSignature(rawBody, signature, secret)) {
        metrics.incr("payment.webhook.toss.invalid_sig");
        throw new InvalidSignatureError();
      }
    } else if (env.NODE_ENV === "production") {
      metrics.incr("payment.webhook.toss.invalid_sig");
      throw new InvalidSignatureError(
        "TOSS_WEBHOOK_SECRET not configured in production",
      );
    }
  }

  // ── 파싱: v2 envelope ──────────────────────────────────────
  const json = JSON.parse(rawBody) as unknown;
  const envelope = TossWebhookV2EventSchema.parse(json);

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
