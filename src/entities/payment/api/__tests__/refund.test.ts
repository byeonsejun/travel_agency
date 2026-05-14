import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted: vi.mock factory 실행 전 mocks 객체를 먼저 준비
const mocks = vi.hoisted(() => {
  const tx = {
    refundJob: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    payment: { update: vi.fn() },
    paymentEvent: { create: vi.fn() },
  };
  return {
    tx,
    db: {
      $transaction: vi.fn(),
      booking: { findUnique: vi.fn() },
      payment: { findFirst: vi.fn() },
      refundJob: { update: vi.fn() }, // Phase 2 실패 시 tx 밖에서 직접 update
    },
    tossClient: { cancel: vi.fn() },
    transitionStatus: vi.fn(),
  };
});

vi.mock("@/shared/lib/db", () => ({ db: mocks.db }));
vi.mock("@/shared/lib/toss", () => ({ tossClient: mocks.tossClient }));
vi.mock("@/entities/booking", () => ({ transitionStatus: mocks.transitionStatus }));

import { refundBooking, backoff } from "../refund";
import { PaymentError } from "../errors";

// ── 공통 픽스처 ────────────────────────────────────────────────
const BOOKING_ID = "booking_refund_testid001";
const PAYMENT_ID = "payment_refund_testid002";
const TOSS_PAYMENT_KEY = "tpayments_sk_test_refund_key";
const AMOUNT = 200_000;
const JOB_ID = "refundjob_testid_001";

const mockPaidBooking = { id: BOOKING_ID, status: "PAID" as const };
const mockReadyBooking = { id: BOOKING_ID, status: "READY" as const };
const mockPaidPayment = {
  id: PAYMENT_ID,
  amount: AMOUNT,
  tossPaymentKey: TOSS_PAYMENT_KEY,
};
const mockRefundJob = { id: JOB_ID, attempts: 0 };

function setupDefaultTransaction(): void {
  mocks.db.$transaction.mockImplementation(
    async (arg: ((tx: typeof mocks.tx) => unknown) | Array<Promise<unknown>>) => {
      if (typeof arg === "function") return arg(mocks.tx);
      if (Array.isArray(arg)) return Promise.all(arg);
    }
  );
}

describe("refundBooking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultTransaction();

    // 사전 조회 기본값
    mocks.db.booking.findUnique.mockResolvedValue(mockPaidBooking);
    mocks.db.payment.findFirst.mockResolvedValue(mockPaidPayment);

    // Phase 1 tx 기본: 중복 없음 → RefundJob IN_PROGRESS 생성
    mocks.tx.refundJob.findFirst.mockResolvedValue(null);
    mocks.tx.refundJob.create.mockResolvedValue(mockRefundJob);

    // Phase 3 tx 기본
    mocks.tx.payment.update.mockResolvedValue({});
    mocks.tx.refundJob.update.mockResolvedValue({});
    mocks.tx.paymentEvent.create.mockResolvedValue({ id: "pevt_refund_1" });

    // Phase 2 기본: cancel 성공
    mocks.tossClient.cancel.mockResolvedValue({
      paymentKey: TOSS_PAYMENT_KEY,
      status: "CANCELED",
      cancels: [],
    });

    // transitionStatus 기본: 성공
    mocks.transitionStatus.mockResolvedValue({
      ...mockPaidBooking,
      status: "CANCELED_BY_USER",
    });

    // Phase 2 실패 경로 (tx 밖 refundJob update)
    mocks.db.refundJob.update.mockResolvedValue({});
  });

  // ── 시나리오 1: PAID 정상 환불 → CANCELED_BY_USER ───────────
  it("PAID booking 정상 환불: Payment CANCELED, RefundJob SUCCEEDED, booking CANCELED_BY_USER", async () => {
    await refundBooking({ bookingId: BOOKING_ID, actor: "user:test123", reason: "단순 변심" });

    // Phase 3: Payment CANCELED
    expect(mocks.tx.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PAYMENT_ID },
        data: expect.objectContaining({ status: "CANCELED" }),
      })
    );

    // Phase 3: RefundJob SUCCEEDED (tx 안)
    expect(mocks.tx.refundJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: JOB_ID },
        data: expect.objectContaining({ status: "SUCCEEDED" }),
      })
    );

    // Phase 3: PaymentEvent REFUND_REQUEST/PROCESSED
    expect(mocks.tx.paymentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "REFUND_REQUEST",
          result: "PROCESSED",
        }),
      })
    );

    // booking 전이: user → CANCELED_BY_USER
    expect(mocks.transitionStatus).toHaveBeenCalledWith({
      bookingId: BOOKING_ID,
      to: "CANCELED_BY_USER",
      actor: "user:test123",
      reason: "단순 변심",
    });

    // PG cancel 호출 확인
    expect(mocks.tossClient.cancel).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentKey: TOSS_PAYMENT_KEY,
        cancelAmount: AMOUNT,
      })
    );

    // Phase 2 실패 경로(db.refundJob.update) 미호출
    expect(mocks.db.refundJob.update).not.toHaveBeenCalled();
  });

  // ── 시나리오 2: READY booking + admin actor → CANCELED_BY_AGENCY ─
  it("READY booking + admin actor: CANCELED_BY_AGENCY 전이", async () => {
    mocks.db.booking.findUnique.mockResolvedValue(mockReadyBooking);

    await refundBooking({ bookingId: BOOKING_ID, actor: "admin:manager01" });

    expect(mocks.transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "CANCELED_BY_AGENCY",
        actor: "admin:manager01",
      })
    );
  });

  // ── 시나리오 3: 이중 환불 요청 → REFUND_ALREADY_REQUESTED ────
  it("이중 환불 요청: REFUND_ALREADY_REQUESTED throw, PG cancel 미호출", async () => {
    mocks.tx.refundJob.findFirst.mockResolvedValue({
      id: "existing_job_id",
      status: "PENDING",
    });

    await expect(
      refundBooking({ bookingId: BOOKING_ID, actor: "user:test123" })
    ).rejects.toMatchObject({ code: "REFUND_ALREADY_REQUESTED" });

    expect(mocks.tossClient.cancel).not.toHaveBeenCalled();
    expect(mocks.transitionStatus).not.toHaveBeenCalled();
    expect(mocks.tx.payment.update).not.toHaveBeenCalled();
  });

  // ── 시나리오 4: PG cancel 실패 → RefundJob PENDING + REFUND_DEFERRED ─
  it("PG cancel 실패: RefundJob PENDING 재적재 + nextRunAt 미래, booking 미전이", async () => {
    mocks.tossClient.cancel.mockRejectedValue(new Error("Toss API 500 Internal Server Error"));

    await expect(
      refundBooking({ bookingId: BOOKING_ID, actor: "user:test123" })
    ).rejects.toMatchObject({ code: "REFUND_DEFERRED" });

    // tx 밖 refundJob.update 호출 (R3: PG 호출과 같은 경로, tx 없음)
    expect(mocks.db.refundJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: JOB_ID },
        data: expect.objectContaining({
          status: "PENDING",
          attempts: { increment: 1 },
          nextRunAt: expect.any(Date),
          lastError: expect.stringContaining("Toss API 500"),
        }),
      })
    );

    // booking 상태 전이 없음 (PAID 유지)
    expect(mocks.transitionStatus).not.toHaveBeenCalled();

    // Phase 3 (Payment CANCELED) 미실행
    expect(mocks.tx.payment.update).not.toHaveBeenCalled();
  });

  // ── 시나리오 5: 환불 불가 상태 (RECEIVED) → BOOKING_NOT_REFUNDABLE ─
  it("RECEIVED booking: BOOKING_NOT_REFUNDABLE throw, payment 조회 미호출", async () => {
    mocks.db.booking.findUnique.mockResolvedValue({ id: BOOKING_ID, status: "RECEIVED" });

    await expect(
      refundBooking({ bookingId: BOOKING_ID, actor: "user:test123" })
    ).rejects.toMatchObject({ code: "BOOKING_NOT_REFUNDABLE" });

    expect(mocks.db.payment.findFirst).not.toHaveBeenCalled();
    expect(mocks.tossClient.cancel).not.toHaveBeenCalled();
  });

  // ── 시나리오 6: PAID Payment 없음 → PAID_PAYMENT_NOT_FOUND ───
  it("PAID Payment 없음: PAID_PAYMENT_NOT_FOUND throw", async () => {
    mocks.db.payment.findFirst.mockResolvedValue(null);

    await expect(
      refundBooking({ bookingId: BOOKING_ID, actor: "user:test123" })
    ).rejects.toMatchObject({ code: "PAID_PAYMENT_NOT_FOUND" });

    expect(mocks.tossClient.cancel).not.toHaveBeenCalled();
  });

  // ── 시나리오 7: actor "system:" → CANCELED_BY_AGENCY ─────────
  it("system actor: CANCELED_BY_AGENCY 전이", async () => {
    await refundBooking({ bookingId: BOOKING_ID, actor: "system:admin-cron" });

    expect(mocks.transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ to: "CANCELED_BY_AGENCY" })
    );
  });
});

describe("backoff", () => {
  it("attempts=0: 약 30초 후 반환", () => {
    const before = Date.now();
    const result = backoff(0);
    expect(result.getTime()).toBeGreaterThanOrEqual(before + 30_000);
    expect(result.getTime()).toBeLessThanOrEqual(before + 30_000 + 200);
  });

  it("attempts=1: 약 5분 후 반환", () => {
    const before = Date.now();
    const result = backoff(1);
    expect(result.getTime()).toBeGreaterThanOrEqual(before + 5 * 60_000);
    expect(result.getTime()).toBeLessThanOrEqual(before + 5 * 60_000 + 200);
  });

  it("attempts=2: 약 30분 후 반환", () => {
    const before = Date.now();
    const result = backoff(2);
    expect(result.getTime()).toBeGreaterThanOrEqual(before + 30 * 60_000);
  });

  it("attempts=4: 약 6시간 후 반환 (최대 단계)", () => {
    const before = Date.now();
    const result = backoff(4);
    expect(result.getTime()).toBeGreaterThanOrEqual(before + 6 * 60 * 60_000);
  });

  it("attempts=99: 6시간으로 cap — attempts=4와 동일 결과", () => {
    const result4 = backoff(4).getTime();
    const result99 = backoff(99).getTime();
    expect(Math.abs(result99 - result4)).toBeLessThan(200);
  });
});
