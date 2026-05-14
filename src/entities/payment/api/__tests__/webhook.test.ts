import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted: vi.mock factory보다 먼저 실행 보장
const mocks = vi.hoisted(() => {
  class MockInvalidTransitionError extends Error {
    constructor(from: string, to: string) {
      super(`Invalid booking transition: ${from} → ${to}`);
      this.name = "InvalidTransitionError";
    }
  }

  const tx = {
    paymentEvent: { findUnique: vi.fn(), create: vi.fn() },
    payment: { findUnique: vi.fn(), update: vi.fn() },
  };

  return {
    tx,
    db: { $transaction: vi.fn() },
    verifyTossSignature: vi.fn(),
    env: {
      TOSS_WEBHOOK_SECRET: "test_webhook_secret_for_testing",
      NODE_ENV: "test" as "development" | "test" | "production",
    },
    transitionStatus: vi.fn(),
    InvalidTransitionError: MockInvalidTransitionError,
  };
});

vi.mock("@/shared/lib/db", () => ({ db: mocks.db }));
vi.mock("@/shared/lib/env", () => ({ env: mocks.env }));
vi.mock("@/shared/lib/toss", () => ({
  verifyTossSignature: mocks.verifyTossSignature,
}));
vi.mock("@/entities/booking", () => ({
  transitionStatus: mocks.transitionStatus,
  InvalidTransitionError: mocks.InvalidTransitionError,
}));

import { handleTossWebhook } from "../webhook";
import { InvalidSignatureError } from "../errors";

// ── 공통 픽스처 ────────────────────────────────────────────────
const BOOKING_ID = "booking_webhook_testid123";
const PAYMENT_ID = "payment_webhook_testid456";
const ORDER_ID = `${BOOKING_ID}__1`;
const PAYMENT_KEY = "tpayments_wh_test_key12345";
const AMOUNT = 120_000;
const EVENT_ID = "evt_toss_unique_id_001";

const mockPaymentPending = {
  id: PAYMENT_ID,
  bookingId: BOOKING_ID,
  status: "PENDING" as const,
  amount: AMOUNT,
  tossOrderId: ORDER_ID,
  booking: {
    id: BOOKING_ID,
    status: "DEPARTURE_CONFIRMED" as const,
    userId: "user_wh_test",
    totalPrice: AMOUNT,
  },
};

const validRawBody = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    eventId: EVENT_ID,
    orderId: ORDER_ID,
    type: "PAYMENT_DONE",
    paymentKey: PAYMENT_KEY,
    totalAmount: AMOUNT,
    approvedAt: new Date().toISOString(),
    ...overrides,
  });

// 기본 $transaction mock — Phase 1 함수형 호출 처리
function setupDefaultTransaction(): void {
  mocks.db.$transaction.mockImplementation(
    async (arg: ((tx: typeof mocks.tx) => unknown) | Array<Promise<unknown>>) => {
      if (typeof arg === "function") return arg(mocks.tx);
      if (Array.isArray(arg)) return Promise.all(arg);
    }
  );
}

describe("handleTossWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultTransaction();

    // 기본: 새 이벤트(중복 없음), 알려진 payment
    mocks.tx.paymentEvent.findUnique.mockResolvedValue(null);
    mocks.tx.payment.findUnique.mockResolvedValue(mockPaymentPending);
    mocks.tx.payment.update.mockResolvedValue({});
    mocks.tx.paymentEvent.create.mockResolvedValue({ id: "pevt_1" });

    mocks.verifyTossSignature.mockReturnValue(true);
    mocks.transitionStatus.mockResolvedValue({});
  });

  // ── 시나리오 1: null signature → InvalidSignatureError ─────────
  it("null signature: InvalidSignatureError throw, DB 미접촉", async () => {
    await expect(
      handleTossWebhook({ rawBody: validRawBody(), signature: null })
    ).rejects.toBeInstanceOf(InvalidSignatureError);

    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  // ── 시나리오 2: 위조 서명 → InvalidSignatureError ───────────────
  it("위조 서명: InvalidSignatureError throw, DB 미접촉", async () => {
    mocks.verifyTossSignature.mockReturnValue(false);

    await expect(
      handleTossWebhook({ rawBody: validRawBody(), signature: "forged_sig_abc" })
    ).rejects.toBeInstanceOf(InvalidSignatureError);

    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  // ── 시나리오 3: 알 수 없는 orderId → IGNORED PaymentEvent ──────
  it("알 수 없는 orderId: result=IGNORED PaymentEvent 기록", async () => {
    mocks.tx.payment.findUnique.mockResolvedValue(null);

    const rawBody = validRawBody({ orderId: "unknown_oid_xyz" });
    await handleTossWebhook({ rawBody, signature: "valid_sig" });

    expect(mocks.tx.paymentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          result: "IGNORED",
          errorMessage: "Unknown orderId",
        }),
      })
    );
    expect(mocks.transitionStatus).not.toHaveBeenCalled();
  });

  // ── 시나리오 4: 중복 eventId (멱등성) → no-op ─────────────────
  it("중복 eventId: 두 번째 호출은 no-op (payment 조회·이벤트 생성 없음)", async () => {
    mocks.tx.paymentEvent.findUnique.mockResolvedValue({
      id: "pevt_existing",
      providerEventId: `webhook:${EVENT_ID}`,
    });

    await handleTossWebhook({ rawBody: validRawBody(), signature: "valid_sig" });

    // Payment 조회 없음 — 중복으로 즉시 종료
    expect(mocks.tx.payment.findUnique).not.toHaveBeenCalled();
    expect(mocks.tx.paymentEvent.create).not.toHaveBeenCalled();
    expect(mocks.transitionStatus).not.toHaveBeenCalled();
  });

  // ── 시나리오 5: PAYMENT_DONE 성공 → PAID + booking 전이 ─────────
  it("PAYMENT_DONE 성공: Payment PAID, PaymentEvent PROCESSED, transitionStatus 호출", async () => {
    await handleTossWebhook({ rawBody: validRawBody(), signature: "valid_sig" });

    expect(mocks.tx.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PAYMENT_ID },
        data: expect.objectContaining({ status: "PAID" }),
      })
    );
    expect(mocks.tx.paymentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          result: "PROCESSED",
          providerEventId: `webhook:${EVENT_ID}`,
        }),
      })
    );
    expect(mocks.transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: BOOKING_ID,
        to: "PAID",
        actor: expect.stringContaining("system:webhook:toss:"),
      })
    );
  });

  // ── 시나리오 6: PAYMENT_DONE 금액 불일치 → WEBHOOK_AMOUNT_MISMATCH ─
  it("PAYMENT_DONE 금액 불일치: FAILED PaymentEvent 기록, WEBHOOK_AMOUNT_MISMATCH throw", async () => {
    const rawBody = validRawBody({ totalAmount: AMOUNT + 500 });

    await expect(
      handleTossWebhook({ rawBody, signature: "valid_sig" })
    ).rejects.toMatchObject({ code: "WEBHOOK_AMOUNT_MISMATCH" });

    expect(mocks.tx.paymentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ result: "FAILED" }),
      })
    );
    expect(mocks.tx.payment.update).not.toHaveBeenCalled();
    expect(mocks.transitionStatus).not.toHaveBeenCalled();
  });

  // ── 시나리오 7: PAYMENT_CANCELED → Payment CANCELED ───────────
  it("PAYMENT_CANCELED: Payment CANCELED, PaymentEvent PROCESSED", async () => {
    mocks.tx.payment.findUnique.mockResolvedValue({
      ...mockPaymentPending,
      status: "PAID",
    });

    const rawBody = validRawBody({
      type: "PAYMENT_CANCELED",
      canceledAt: new Date().toISOString(),
      totalAmount: undefined,
      approvedAt: undefined,
    });
    await handleTossWebhook({ rawBody, signature: "valid_sig" });

    expect(mocks.tx.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "CANCELED" }),
      })
    );
    expect(mocks.tx.paymentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ result: "PROCESSED" }),
      })
    );
  });

  // ── 시나리오 8: 이미 PAID인 Payment, PAYMENT_DONE → SKIPPED ────
  it("이미 PAID Payment + PAYMENT_DONE: PaymentEvent SKIPPED, payment update 없음", async () => {
    mocks.tx.payment.findUnique.mockResolvedValue({
      ...mockPaymentPending,
      status: "PAID",
    });

    const rawBody = validRawBody({ type: "PAYMENT_DONE", totalAmount: AMOUNT });
    await handleTossWebhook({ rawBody, signature: "valid_sig" });

    expect(mocks.tx.payment.update).not.toHaveBeenCalled();
    expect(mocks.tx.paymentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ result: "SKIPPED" }),
      })
    );
  });

  // ── 시나리오 9: PAYMENT_FAILED → Payment FAILED ─────────────────
  it("PAYMENT_FAILED: Payment FAILED, PaymentEvent PROCESSED, transitionStatus 미호출", async () => {
    const rawBody = validRawBody({
      type: "PAYMENT_FAILED",
      failure: { code: "INVALID_CARD", message: "카드 정보 오류" },
      totalAmount: undefined,
      approvedAt: undefined,
    });
    await handleTossWebhook({ rawBody, signature: "valid_sig" });

    expect(mocks.tx.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED" }),
      })
    );
    expect(mocks.transitionStatus).not.toHaveBeenCalled();
  });

  // ── 시나리오 10: transitionStatus → InvalidTransitionError → swallow ─
  it("transitionStatus InvalidTransitionError: swallow (이미 전이된 상태, 정상 종료)", async () => {
    mocks.transitionStatus.mockRejectedValue(
      new mocks.InvalidTransitionError("PAID", "PAID")
    );

    // Should resolve without throwing
    await expect(
      handleTossWebhook({ rawBody: validRawBody(), signature: "valid_sig" })
    ).resolves.toBeUndefined();
  });

  // ── 시나리오 11: 미지원 type → IGNORED PaymentEvent ─────────────
  it("미지원 event type: PaymentEvent IGNORED, transitionStatus 미호출", async () => {
    const rawBody = validRawBody({ type: "UNKNOWN_TYPE_XYZ" });
    await handleTossWebhook({ rawBody, signature: "valid_sig" });

    expect(mocks.tx.payment.update).not.toHaveBeenCalled();
    expect(mocks.tx.paymentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ result: "IGNORED" }),
      })
    );
    expect(mocks.transitionStatus).not.toHaveBeenCalled();
  });
});
