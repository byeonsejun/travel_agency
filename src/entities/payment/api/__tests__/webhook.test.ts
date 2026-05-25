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

// ── 공통 픽스처 (v2 envelope + data.* 중첩) ────────────────────
const BOOKING_ID = "booking_webhook_testid123";
const PAYMENT_ID = "payment_webhook_testid456";
const ORDER_ID = `${BOOKING_ID}__1`;
const PAYMENT_KEY = "tpayments_wh_test_key12345";
const AMOUNT = 120_000;
const TRANSMISSION_ID = "whtrans_test_unique_001";

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

// v2 picture helpers — top-level `eventType` + `data.*` 중첩 (토스 v2024-06-01).
type V2PaymentDataOverrides = {
  orderId?: string;
  status?:
    | "READY"
    | "IN_PROGRESS"
    | "WAITING_FOR_DEPOSIT"
    | "DONE"
    | "CANCELED"
    | "PARTIAL_CANCELED"
    | "ABORTED"
    | "EXPIRED";
  totalAmount?: number;
  paymentKey?: string;
};

function v2PaymentStatusChangedBody(
  overrides: V2PaymentDataOverrides = {},
): string {
  return JSON.stringify({
    eventType: "PAYMENT_STATUS_CHANGED",
    createdAt: "2026-05-24T01:18:13.957Z",
    data: {
      paymentKey: overrides.paymentKey ?? PAYMENT_KEY,
      orderId: overrides.orderId ?? ORDER_ID,
      status: overrides.status ?? "DONE",
      totalAmount: overrides.totalAmount ?? AMOUNT,
      approvedAt: "2026-05-24T01:18:13+09:00",
      receipt: { url: "https://dashboard-sandbox.tosspayments.com/receipt/r" },
    },
  });
}

function v2UnknownEventBody(eventType: string): string {
  return JSON.stringify({
    eventType,
    createdAt: "2026-05-24T01:18:13.957Z",
    data: { foo: "bar" },
  });
}

// 기본 $transaction mock — Phase 1 함수형 호출 처리
function setupDefaultTransaction(): void {
  mocks.db.$transaction.mockImplementation(
    async (arg: ((tx: typeof mocks.tx) => unknown) | Array<Promise<unknown>>) => {
      if (typeof arg === "function") return arg(mocks.tx);
      if (Array.isArray(arg)) return Promise.all(arg);
    },
  );
}

describe("handleTossWebhook (v2024-06-01)", () => {
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

  // ── 시나리오 1: null signature → InvalidSignatureError (test 환경) ──
  it("null signature: InvalidSignatureError throw, DB 미접촉", async () => {
    await expect(
      handleTossWebhook({
        rawBody: v2PaymentStatusChangedBody(),
        signature: null,
        transmissionId: TRANSMISSION_ID,
      }),
    ).rejects.toBeInstanceOf(InvalidSignatureError);

    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  // ── 시나리오 2: 위조 서명 → InvalidSignatureError ───────────────
  it("위조 서명: InvalidSignatureError throw, DB 미접촉", async () => {
    mocks.verifyTossSignature.mockReturnValue(false);

    await expect(
      handleTossWebhook({
        rawBody: v2PaymentStatusChangedBody(),
        signature: "forged_sig_abc",
        transmissionId: TRANSMISSION_ID,
      }),
    ).rejects.toBeInstanceOf(InvalidSignatureError);

    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  // ── 시나리오 3: transmissionId null → InvalidSignatureError ─────
  it("transmissionId null: InvalidSignatureError throw, DB 미접촉", async () => {
    await expect(
      handleTossWebhook({
        rawBody: v2PaymentStatusChangedBody(),
        signature: "valid_sig",
        transmissionId: null,
      }),
    ).rejects.toBeInstanceOf(InvalidSignatureError);

    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  // ── 시나리오 4: 알 수 없는 orderId → IGNORED PaymentEvent ──────
  it("알 수 없는 orderId: result=IGNORED PaymentEvent 기록", async () => {
    mocks.tx.payment.findUnique.mockResolvedValue(null);

    await handleTossWebhook({
      rawBody: v2PaymentStatusChangedBody({ orderId: "unknown_oid_xyz" }),
      signature: "valid_sig",
      transmissionId: TRANSMISSION_ID,
    });

    expect(mocks.tx.paymentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          result: "IGNORED",
          errorMessage: "Unknown orderId",
        }),
      }),
    );
    expect(mocks.transitionStatus).not.toHaveBeenCalled();
  });

  // ── 시나리오 5: 중복 transmissionId (멱등성) → no-op ──────────
  it("중복 transmissionId: 두 번째 호출은 no-op (payment 조회·이벤트 생성 없음)", async () => {
    mocks.tx.paymentEvent.findUnique.mockResolvedValue({
      id: "pevt_existing",
      providerEventId: `webhook:${TRANSMISSION_ID}`,
    });

    await handleTossWebhook({
      rawBody: v2PaymentStatusChangedBody(),
      signature: "valid_sig",
      transmissionId: TRANSMISSION_ID,
    });

    // Payment 조회 없음 — 중복으로 즉시 종료
    expect(mocks.tx.payment.findUnique).not.toHaveBeenCalled();
    expect(mocks.tx.paymentEvent.create).not.toHaveBeenCalled();
    expect(mocks.transitionStatus).not.toHaveBeenCalled();
  });

  // ── 시나리오 6: PAYMENT_STATUS_CHANGED + DONE → PAID + booking 전이 ─
  it("PAYMENT_STATUS_CHANGED status=DONE 성공: Payment PAID, PaymentEvent PROCESSED, transitionStatus 호출", async () => {
    await handleTossWebhook({
      rawBody: v2PaymentStatusChangedBody(),
      signature: "valid_sig",
      transmissionId: TRANSMISSION_ID,
    });

    expect(mocks.tx.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PAYMENT_ID },
        data: expect.objectContaining({ status: "PAID" }),
      }),
    );
    expect(mocks.tx.paymentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          result: "PROCESSED",
          providerEventId: `webhook:${TRANSMISSION_ID}`,
        }),
      }),
    );
    expect(mocks.transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: BOOKING_ID,
        to: "PAID",
        actor: expect.stringContaining("system:webhook:toss:"),
      }),
    );
  });

  // ── 시나리오 7: DONE 금액 불일치 → WEBHOOK_AMOUNT_MISMATCH ─────
  it("DONE 금액 불일치: FAILED PaymentEvent 기록, WEBHOOK_AMOUNT_MISMATCH throw", async () => {
    await expect(
      handleTossWebhook({
        rawBody: v2PaymentStatusChangedBody({ totalAmount: AMOUNT + 500 }),
        signature: "valid_sig",
        transmissionId: TRANSMISSION_ID,
      }),
    ).rejects.toMatchObject({ code: "WEBHOOK_AMOUNT_MISMATCH" });

    expect(mocks.tx.paymentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ result: "FAILED" }),
      }),
    );
    expect(mocks.tx.payment.update).not.toHaveBeenCalled();
    expect(mocks.transitionStatus).not.toHaveBeenCalled();
  });

  // ── 시나리오 8: 이미 PAID Payment + DONE → SKIPPED ──────────────
  it("이미 PAID Payment + DONE: PaymentEvent SKIPPED, payment update 없음", async () => {
    mocks.tx.payment.findUnique.mockResolvedValue({
      ...mockPaymentPending,
      status: "PAID",
    });

    await handleTossWebhook({
      rawBody: v2PaymentStatusChangedBody(),
      signature: "valid_sig",
      transmissionId: TRANSMISSION_ID,
    });

    expect(mocks.tx.payment.update).not.toHaveBeenCalled();
    expect(mocks.tx.paymentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ result: "SKIPPED" }),
      }),
    );
  });

  // ── 시나리오 9: transitionStatus InvalidTransitionError → swallow ─
  it("transitionStatus InvalidTransitionError: swallow (이미 전이된 상태, 정상 종료)", async () => {
    mocks.transitionStatus.mockRejectedValue(
      new mocks.InvalidTransitionError("PAID", "PAID"),
    );

    await expect(
      handleTossWebhook({
        rawBody: v2PaymentStatusChangedBody(),
        signature: "valid_sig",
        transmissionId: TRANSMISSION_ID,
      }),
    ).resolves.toBeUndefined();
  });

  // ── 시나리오 10: 미지원 eventType → IGNORED PaymentEvent ───────
  it("미지원 eventType (METHOD_UPDATED 등): PaymentEvent IGNORED, payment.update 미호출", async () => {
    await handleTossWebhook({
      rawBody: v2UnknownEventBody("METHOD_UPDATED"),
      signature: "valid_sig",
      transmissionId: TRANSMISSION_ID,
    });

    expect(mocks.tx.payment.update).not.toHaveBeenCalled();
    expect(mocks.tx.paymentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ result: "IGNORED" }),
      }),
    );
    expect(mocks.transitionStatus).not.toHaveBeenCalled();
  });

  // ── 시나리오 11: PAYMENT_STATUS_CHANGED + status≠DONE → IGNORED ─
  it("PAYMENT_STATUS_CHANGED status=READY: phase 1 범위 외 IGNORED no-op", async () => {
    await handleTossWebhook({
      rawBody: v2PaymentStatusChangedBody({ status: "READY" }),
      signature: "valid_sig",
      transmissionId: TRANSMISSION_ID,
    });

    expect(mocks.tx.payment.update).not.toHaveBeenCalled();
    expect(mocks.tx.paymentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ result: "IGNORED" }),
      }),
    );
    expect(mocks.transitionStatus).not.toHaveBeenCalled();
  });

  it("PAYMENT_STATUS_CHANGED status=ABORTED: phase 1 범위 외 IGNORED no-op", async () => {
    await handleTossWebhook({
      rawBody: v2PaymentStatusChangedBody({ status: "ABORTED" }),
      signature: "valid_sig",
      transmissionId: TRANSMISSION_ID,
    });

    expect(mocks.tx.payment.update).not.toHaveBeenCalled();
    expect(mocks.tx.paymentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ result: "IGNORED" }),
      }),
    );
  });
});
