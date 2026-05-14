import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted: vi.mock factory 실행 전 mocks 객체를 먼저 준비 (Vitest hoisting 보장)
const mocks = vi.hoisted(() => {
  const tx = {
    payment: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    booking: { findUnique: vi.fn() },
    paymentEvent: { create: vi.fn() },
  };
  return {
    tx,
    db: {
      $transaction: vi.fn(),
      payment: { update: vi.fn() },
      paymentEvent: { create: vi.fn() },
      refundJob: { create: vi.fn() },
    },
    tossClient: { confirm: vi.fn(), cancel: vi.fn() },
    transitionStatus: vi.fn(),
  };
});

vi.mock("@/shared/lib/db", () => ({ db: mocks.db }));
vi.mock("@/shared/lib/toss", () => ({ tossClient: mocks.tossClient }));
vi.mock("@/entities/booking", () => ({ transitionStatus: mocks.transitionStatus }));

import { confirmPayment } from "../confirm";
import { PaymentError } from "../errors";

// ── 공통 픽스처 ────────────────────────────────────────────────
const BOOKING_ID = "booking_cltestid123456789";
const PAYMENT_ID = "payment_cltestid456789abc";
const PAYMENT_KEY = "tpayments_sk_test_key1234567890";
const ORDER_ID = `${BOOKING_ID}__1`;
const AMOUNT = 150_000;
const USER_ID = "user_cltestid789012";

const mockBooking = {
  id: BOOKING_ID,
  userId: USER_ID,
  status: "DEPARTURE_CONFIRMED" as const,
  totalPrice: AMOUNT,
};

const mockPaymentPending = {
  id: PAYMENT_ID,
  bookingId: BOOKING_ID,
  status: "PENDING" as const,
  amount: AMOUNT,
  tossOrderId: ORDER_ID,
  tossPaymentKey: null,
  receiptUrl: null,
  booking: mockBooking,
};

const pgDoneResponse = {
  paymentKey: PAYMENT_KEY,
  orderId: ORDER_ID,
  status: "DONE" as const,
  totalAmount: AMOUNT,
  approvedAt: new Date().toISOString(),
  receipt: { url: "https://mock.tosspayments.com/receipt/test" },
};

// ── 기본 $transaction mock 설정 ────────────────────────────────
function setupDefaultTransaction(): void {
  mocks.db.$transaction.mockImplementation(
    async (arg: ((tx: typeof mocks.tx) => unknown) | Array<Promise<unknown>>) => {
      if (typeof arg === "function") return arg(mocks.tx);
      if (Array.isArray(arg)) return Promise.all(arg);
    }
  );
}

describe("confirmPayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultTransaction();

    // Phase 1 기본: 신규 결제 시도
    mocks.tx.payment.findUnique.mockResolvedValue(null);
    mocks.tx.booking.findUnique.mockResolvedValue(mockBooking);
    mocks.tx.payment.create.mockResolvedValue(mockPaymentPending);
    mocks.tx.payment.update.mockResolvedValue({});
    mocks.tx.paymentEvent.create.mockResolvedValue({ id: "evt_tx_1" });

    // Array-form db 호출 (Phase 2 네트워크 에러 기록, Phase 3b, compensateCancel)
    mocks.db.payment.update.mockResolvedValue({});
    mocks.db.paymentEvent.create.mockResolvedValue({ id: "evt_db_1" });
    mocks.db.refundJob.create.mockResolvedValue({ id: "job_1" });

    // Phase 2 기본
    mocks.tossClient.confirm.mockResolvedValue(pgDoneResponse);
    mocks.tossClient.cancel.mockResolvedValue({
      paymentKey: PAYMENT_KEY,
      status: "CANCELED",
      cancels: [],
    });

    // Phase 3a 기본
    mocks.transitionStatus.mockResolvedValue({ ...mockBooking, status: "PAID" });
  });

  // ── 시나리오 1: 성공 ────────────────────────────────────────
  it("success: Payment PAID, transitionStatus 호출, tossClient.cancel 미호출", async () => {
    const result = await confirmPayment({
      userId: USER_ID,
      paymentKey: PAYMENT_KEY,
      orderId: ORDER_ID,
      amount: AMOUNT,
    });

    expect(result).toEqual({ bookingId: BOOKING_ID, status: "PAID" });
    expect(mocks.tossClient.confirm).toHaveBeenCalledOnce();
    expect(mocks.tossClient.confirm).toHaveBeenCalledWith({
      paymentKey: PAYMENT_KEY,
      orderId: ORDER_ID,
      amount: AMOUNT,
    });
    expect(mocks.transitionStatus).toHaveBeenCalledWith({
      bookingId: BOOKING_ID,
      to: "PAID",
      actor: `system:payment:confirm:${PAYMENT_KEY}`,
      reason: `tossPaymentKey=${PAYMENT_KEY}`,
    });
    expect(mocks.tossClient.cancel).not.toHaveBeenCalled();
  });

  // ── 시나리오 2: 금액 위조 — 클라이언트 측 (Phase 1) ─────────
  it("amount mismatch (request): AMOUNT_MISMATCH_REQUEST throw, PG 미호출", async () => {
    mocks.tx.booking.findUnique.mockResolvedValue({
      ...mockBooking,
      totalPrice: AMOUNT + 1_000,
    });

    await expect(
      confirmPayment({ userId: USER_ID, paymentKey: PAYMENT_KEY, orderId: ORDER_ID, amount: AMOUNT })
    ).rejects.toMatchObject({ code: "AMOUNT_MISMATCH_REQUEST" });

    expect(mocks.tossClient.confirm).not.toHaveBeenCalled();
    expect(mocks.tossClient.cancel).not.toHaveBeenCalled();
  });

  // ── 시나리오 3: PG 응답 금액 위조 (Phase 3a) ─────────────────
  it("PG amount tamper: compensateCancel 호출, AMOUNT_MISMATCH_PG_RESPONSE throw", async () => {
    mocks.tossClient.confirm.mockResolvedValue({
      ...pgDoneResponse,
      totalAmount: AMOUNT + 1,
    });

    await expect(
      confirmPayment({ userId: USER_ID, paymentKey: PAYMENT_KEY, orderId: ORDER_ID, amount: AMOUNT })
    ).rejects.toMatchObject({ code: "AMOUNT_MISMATCH_PG_RESPONSE" });

    expect(mocks.tossClient.cancel).toHaveBeenCalledOnce();
    expect(mocks.tossClient.cancel).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentKey: PAYMENT_KEY,
        cancelAmount: AMOUNT + 1,
      })
    );
    expect(mocks.transitionStatus).not.toHaveBeenCalled();
  });

  // ── 시나리오 4: DB 갱신 실패 (Phase 3a Tx-2) ─────────────────
  it("DB update failed: compensateCancel 호출, DB_UPDATE_FAILED throw", async () => {
    let fnTxCalls = 0;
    mocks.db.$transaction.mockImplementation(
      async (arg: ((tx: typeof mocks.tx) => unknown) | Array<Promise<unknown>>) => {
        if (typeof arg === "function") {
          fnTxCalls++;
          if (fnTxCalls === 2) throw new Error("DB connection pool exhausted");
          return arg(mocks.tx);
        }
        if (Array.isArray(arg)) return Promise.all(arg);
      }
    );

    await expect(
      confirmPayment({ userId: USER_ID, paymentKey: PAYMENT_KEY, orderId: ORDER_ID, amount: AMOUNT })
    ).rejects.toMatchObject({ code: "DB_UPDATE_FAILED" });

    expect(mocks.tossClient.cancel).toHaveBeenCalledOnce();
  });

  // ── 시나리오 5: 멱등성 — 이미 PAID인 Payment ─────────────────
  it("idempotent: 기존 PAID Payment → PG 호출 없이 즉시 반환", async () => {
    mocks.tx.payment.findUnique.mockResolvedValue({
      ...mockPaymentPending,
      status: "PAID",
    });

    const result = await confirmPayment({
      userId: USER_ID,
      paymentKey: PAYMENT_KEY,
      orderId: ORDER_ID,
      amount: AMOUNT,
    });

    expect(result).toEqual({ bookingId: BOOKING_ID, status: "PAID" });
    expect(mocks.tossClient.confirm).not.toHaveBeenCalled();
    expect(mocks.transitionStatus).not.toHaveBeenCalled();
  });

  // ── 시나리오 6: Booking 미존재 ─────────────────────────────
  it("BOOKING_NOT_FOUND throw when booking does not exist", async () => {
    mocks.tx.booking.findUnique.mockResolvedValue(null);

    await expect(
      confirmPayment({ userId: USER_ID, paymentKey: PAYMENT_KEY, orderId: ORDER_ID, amount: AMOUNT })
    ).rejects.toMatchObject({ code: "BOOKING_NOT_FOUND" });

    expect(mocks.tossClient.confirm).not.toHaveBeenCalled();
  });

  // ── 시나리오 7: Booking 상태 비적격 ────────────────────────
  it("BOOKING_NOT_PAYABLE throw when booking is not DEPARTURE_CONFIRMED", async () => {
    mocks.tx.booking.findUnique.mockResolvedValue({
      ...mockBooking,
      status: "RECEIVED",
    });

    await expect(
      confirmPayment({ userId: USER_ID, paymentKey: PAYMENT_KEY, orderId: ORDER_ID, amount: AMOUNT })
    ).rejects.toMatchObject({ code: "BOOKING_NOT_PAYABLE" });

    expect(mocks.tossClient.confirm).not.toHaveBeenCalled();
  });

  // ── 시나리오 8: PG 네트워크 에러 (Phase 2) ───────────────────
  it("PG network error: FAILED 이벤트 기록, PG_NETWORK_ERROR throw", async () => {
    mocks.tossClient.confirm.mockRejectedValue(new Error("ECONNRESET"));

    await expect(
      confirmPayment({ userId: USER_ID, paymentKey: PAYMENT_KEY, orderId: ORDER_ID, amount: AMOUNT })
    ).rejects.toMatchObject({ code: "PG_NETWORK_ERROR" });

    expect(mocks.db.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED" }),
      })
    );
    expect(mocks.transitionStatus).not.toHaveBeenCalled();
  });

  // ── 시나리오 9: PG 명시적 실패 응답 (status !== DONE) ─────────
  it("PG fail response: FAILED status 반환, compensateCancel 미호출", async () => {
    mocks.tossClient.confirm.mockResolvedValue({
      ...pgDoneResponse,
      status: "FAILED",
      failure: { code: "INVALID_CARD", message: "카드 정보가 올바르지 않습니다" },
    });

    const result = await confirmPayment({
      userId: USER_ID,
      paymentKey: PAYMENT_KEY,
      orderId: ORDER_ID,
      amount: AMOUNT,
    });

    expect(result.status).toBe("FAILED");
    expect(result.failureMessage).toBe("카드 정보가 올바르지 않습니다");
    expect(mocks.tossClient.cancel).not.toHaveBeenCalled();
    expect(mocks.transitionStatus).not.toHaveBeenCalled();
  });

  // ── 시나리오 10: compensateCancel PG cancel 실패 → RefundJob enqueue ──
  it("compensateCancel PG cancel 실패: RefundJob enqueue, 원본 에러 전파", async () => {
    mocks.tossClient.confirm.mockResolvedValue({
      ...pgDoneResponse,
      totalAmount: AMOUNT + 1,
    });
    mocks.tossClient.cancel.mockRejectedValue(new Error("PG cancel API down"));

    await expect(
      confirmPayment({ userId: USER_ID, paymentKey: PAYMENT_KEY, orderId: ORDER_ID, amount: AMOUNT })
    ).rejects.toMatchObject({ code: "AMOUNT_MISMATCH_PG_RESPONSE" });

    expect(mocks.db.refundJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "PENDING", amount: AMOUNT + 1 }),
      })
    );
  });

  // ── 시나리오 11: 소유권 위반 ────────────────────────────────
  it("FORBIDDEN throw when userId mismatches booking owner", async () => {
    mocks.tx.booking.findUnique.mockResolvedValue({
      ...mockBooking,
      userId: "user_other_xyz",
    });

    await expect(
      confirmPayment({ userId: USER_ID, paymentKey: PAYMENT_KEY, orderId: ORDER_ID, amount: AMOUNT })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(mocks.tossClient.confirm).not.toHaveBeenCalled();
  });
});
