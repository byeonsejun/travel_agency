/**
 * observability-hooks.test.ts — 결제 코어 관측성 훅 단위 테스트 (M-OBS Task 8)
 *
 * 검증 목표:
 *  - 비즈니스 로직(트랜잭션 경계·외부 IO 순서)은 기존 테스트가 보호 (무수정)
 *  - 이 파일은 관측성 훅(logger/metrics/captureException 호출)에만 집중
 *
 * 전략:
 *  - DB/toss/booking은 기존 패턴대로 vi.hoisted mock
 *  - captureException만 vi.mock으로 교체 (내부 logger.error 중복 방지)
 *  - logger는 vi.spyOn으로 실제 메서드를 인터셉트
 *  - metrics는 metrics.resetForTest() + metrics.snapshot()으로 검증
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── vi.hoisted: vi.mock factory 실행 전에 mocks 객체 확보 ─────────
const mocks = vi.hoisted(() => {
  class MockInvalidTransitionError extends Error {
    constructor(from: string, to: string) {
      super(`Invalid transition: ${from} → ${to}`);
      this.name = "InvalidTransitionError";
    }
  }

  const tx = {
    payment: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    booking: { findUnique: vi.fn() },
    paymentEvent: { findUnique: vi.fn(), create: vi.fn() },
    refundJob: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  };

  return {
    tx,
    db: {
      $transaction: vi.fn(),
      payment: { update: vi.fn(), findFirst: vi.fn() },
      paymentEvent: { create: vi.fn() },
      refundJob: { create: vi.fn(), update: vi.fn() },
      booking: { findUnique: vi.fn() },
    },
    tossClient: { confirm: vi.fn(), cancel: vi.fn(), getPayment: vi.fn() },
    transitionStatus: vi.fn(),
    InvalidTransitionError: MockInvalidTransitionError,
    captureException: vi.fn(),
  };
});

vi.mock("@/shared/lib/db", () => ({ db: mocks.db }));
vi.mock("@/shared/lib/toss", () => ({
  tossClient: mocks.tossClient,
}));
vi.mock("@/entities/booking", () => ({
  transitionStatus: mocks.transitionStatus,
  InvalidTransitionError: mocks.InvalidTransitionError,
}));
// captureException만 교체 — logger/metrics는 실제 구현 사용
vi.mock("@/shared/lib/observability", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/lib/observability")>();
  return { ...actual, captureException: mocks.captureException };
});

import { confirmPayment } from "../confirm";
import { handleTossWebhook } from "../webhook";
import { refundBooking } from "../refund";
import { logger, metrics } from "@/shared/lib/observability";

// ── 공통 픽스처 ────────────────────────────────────────────────
const BOOKING_ID = "booking_obs_hook_test001";
const PAYMENT_ID = "payment_obs_hook_test002";
const PAYMENT_KEY = "tpayments_obs_test_key_123";
const ORDER_ID = `${BOOKING_ID}__1`;
const AMOUNT = 180_000;
const EVENT_ID = "evt_obs_hook_unique_001";

const mockBooking = {
  id: BOOKING_ID,
  userId: "user_obs_001",
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
  booking: mockBooking,
};
const pgDoneResponse = {
  paymentKey: PAYMENT_KEY,
  orderId: ORDER_ID,
  status: "DONE" as const,
  totalAmount: AMOUNT,
  approvedAt: new Date().toISOString(),
  receipt: { url: "https://mock.tosspayments.com/receipt/obs-test" },
};

// v2 envelope + data.* 중첩 (가이드 v2024-06-01).
const validWebhookBody = (overrides: { orderId?: string; status?: string; totalAmount?: number } = {}) =>
  JSON.stringify({
    eventType: "PAYMENT_STATUS_CHANGED",
    createdAt: new Date().toISOString(),
    data: {
      paymentKey: PAYMENT_KEY,
      orderId: overrides.orderId ?? ORDER_ID,
      status: overrides.status ?? "DONE",
      totalAmount: overrides.totalAmount ?? AMOUNT,
      approvedAt: new Date().toISOString(),
    },
  });

const unknownEventBody = (eventType: string) =>
  JSON.stringify({
    eventType,
    createdAt: new Date().toISOString(),
    data: { foo: "bar" },
  });

const TRANSMISSION_ID = `whtrans_obs_${EVENT_ID}`;

function setupDefaultTransaction(): void {
  mocks.db.$transaction.mockImplementation(
    async (arg: ((tx: typeof mocks.tx) => unknown) | Array<Promise<unknown>>) => {
      if (typeof arg === "function") return arg(mocks.tx);
      if (Array.isArray(arg)) return Promise.all(arg);
    }
  );
}

// ── logger spy helpers ────────────────────────────────────────
let errorSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let infoSpy: ReturnType<typeof vi.spyOn>;

// ─────────────────────────────────────────────────────────────
// confirm.ts — compensateCancel 관측성 훅
// ─────────────────────────────────────────────────────────────
describe("confirm.ts — compensateCancel 관측성 훅", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    metrics.resetForTest();
    setupDefaultTransaction();

    errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    // Phase 1 기본
    mocks.tx.payment.findUnique.mockResolvedValue(null);
    mocks.tx.booking.findUnique.mockResolvedValue(mockBooking);
    mocks.tx.payment.create.mockResolvedValue(mockPaymentPending);
    mocks.tx.payment.update.mockResolvedValue({});
    mocks.tx.paymentEvent.create.mockResolvedValue({ id: "evt_1" });
    mocks.db.payment.update.mockResolvedValue({});
    mocks.db.paymentEvent.create.mockResolvedValue({ id: "evt_db_1" });
    mocks.db.refundJob.create.mockResolvedValue({ id: "job_1" });

    // PG: 금액 위조로 compensateCancel 트리거
    mocks.tossClient.confirm.mockResolvedValue({ ...pgDoneResponse, totalAmount: AMOUNT + 1 });
    mocks.transitionStatus.mockResolvedValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("PG cancel 실패 → logger.error('payment.compensate_cancel.pg_failed') + metrics.incr + captureException", async () => {
    mocks.tossClient.cancel.mockRejectedValue(new Error("PG cancel down"));

    await expect(confirmPayment({
      userId: mockBooking.userId,
      paymentKey: PAYMENT_KEY,
      orderId: ORDER_ID,
      amount: AMOUNT,
    })).rejects.toMatchObject({ code: "AMOUNT_MISMATCH_PG_RESPONSE" });

    // logger.error with structured event name
    const pgFailCall = errorSpy.mock.calls.find((c) => c[0] === "payment.compensate_cancel.pg_failed");
    expect(pgFailCall).toBeDefined();
    expect(pgFailCall![1]).toBeInstanceOf(Error);

    // metrics counter
    expect(metrics.snapshot().counters["payment.compensate_cancel.pg_failed"]).toBe(1);

    // captureException
    expect(mocks.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ bookingId: BOOKING_ID })
    );
  });

  it("PG cancel + RefundJob enqueue 모두 실패 → enqueue_failed logger + metrics", async () => {
    mocks.tossClient.cancel.mockRejectedValue(new Error("PG down"));
    mocks.db.refundJob.create.mockRejectedValue(new Error("DB down"));

    await expect(confirmPayment({
      userId: mockBooking.userId,
      paymentKey: PAYMENT_KEY,
      orderId: ORDER_ID,
      amount: AMOUNT,
    })).rejects.toMatchObject({ code: "AMOUNT_MISMATCH_PG_RESPONSE" });

    const enqueueFail = errorSpy.mock.calls.find((c) => c[0] === "payment.compensate_cancel.enqueue_failed");
    expect(enqueueFail).toBeDefined();

    expect(metrics.snapshot().counters["payment.compensate_cancel.pg_failed"]).toBe(1);
    expect(metrics.snapshot().counters["payment.compensate_cancel.enqueue_failed"]).toBe(1);
    expect(mocks.captureException).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────
// webhook.ts — metrics/logger 훅
// ─────────────────────────────────────────────────────────────
describe("webhook.ts — 관측성 훅", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    metrics.resetForTest();
    setupDefaultTransaction();

    errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});

    mocks.tx.paymentEvent.findUnique.mockResolvedValue(null);
    mocks.tx.payment.findUnique.mockResolvedValue(mockPaymentPending);
    mocks.tx.payment.update.mockResolvedValue({});
    mocks.tx.paymentEvent.create.mockResolvedValue({ id: "pevt_1" });
    // 기본 cross-check 성공 (ADR-0016)
    mocks.tossClient.getPayment.mockResolvedValue({
      paymentKey: PAYMENT_KEY,
      orderId: ORDER_ID,
      status: "DONE",
      totalAmount: AMOUNT,
    });
    mocks.transitionStatus.mockResolvedValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("cross-check payload 불일치 → metrics.incr('payment.webhook.toss.invalid_sig')", async () => {
    mocks.tossClient.getPayment.mockResolvedValue({
      paymentKey: PAYMENT_KEY,
      orderId: "wrong_order",
      status: "DONE",
      totalAmount: AMOUNT,
    });

    await expect(
      handleTossWebhook({ rawBody: validWebhookBody(), signature: null, transmissionId: TRANSMISSION_ID })
    ).rejects.toThrow();

    expect(metrics.snapshot().counters["payment.webhook.toss.invalid_sig"]).toBe(1);
  });

  it("cross-check 토스 API 에러 → metrics.incr('payment.webhook.toss.invalid_sig')", async () => {
    mocks.tossClient.getPayment.mockRejectedValue(new Error("network"));

    await expect(
      handleTossWebhook({ rawBody: validWebhookBody(), signature: null, transmissionId: TRANSMISSION_ID })
    ).rejects.toThrow();

    expect(metrics.snapshot().counters["payment.webhook.toss.invalid_sig"]).toBe(1);
  });

  it("transmissionId 부재 → metrics.incr('payment.webhook.toss.missing_transmission_id') + throw", async () => {
    await expect(
      handleTossWebhook({ rawBody: validWebhookBody(), signature: "sig", transmissionId: null })
    ).rejects.toThrow();

    expect(metrics.snapshot().counters["payment.webhook.toss.missing_transmission_id"]).toBe(1);
  });

  it("중복 transmissionId → metrics.incr('payment.webhook.toss.duplicate') + logger.info('payment.webhook.duplicate')", async () => {
    mocks.tx.paymentEvent.findUnique.mockResolvedValue({
      id: "pevt_existing",
      providerEventId: `webhook:${TRANSMISSION_ID}`,
    });

    await handleTossWebhook({ rawBody: validWebhookBody(), signature: "sig", transmissionId: TRANSMISSION_ID });

    expect(metrics.snapshot().counters["payment.webhook.toss.duplicate"]).toBe(1);
    const infoCall = infoSpy.mock.calls.find((c) => c[0] === "payment.webhook.duplicate");
    expect(infoCall).toBeDefined();
  });

  it("알 수 없는 orderId → metrics.incr('payment.webhook.toss.ignored') + logger.warn", async () => {
    mocks.tx.payment.findUnique.mockResolvedValue(null);
    // cross-check 통과(토스 record 와 payload 일치) — 우리 DB 에 해당 orderId 만 없음
    mocks.tossClient.getPayment.mockResolvedValue({
      paymentKey: PAYMENT_KEY,
      orderId: "unknown_oid",
      status: "DONE",
      totalAmount: AMOUNT,
    });

    await handleTossWebhook({
      rawBody: validWebhookBody({ orderId: "unknown_oid" }),
      signature: "sig",
      transmissionId: TRANSMISSION_ID,
    });

    expect(metrics.snapshot().counters["payment.webhook.toss.ignored"]).toBe(1);
    const warnCall = warnSpy.mock.calls.find((c) => c[0] === "payment.webhook.ignored");
    expect(warnCall).toBeDefined();
  });

  it("PAYMENT_STATUS_CHANGED DONE 성공 → metrics.incr('payment.webhook.toss.processed', { eventType, status })", async () => {
    await handleTossWebhook({ rawBody: validWebhookBody(), signature: "sig", transmissionId: TRANSMISSION_ID });

    const key = "payment.webhook.toss.processed|eventType=PAYMENT_STATUS_CHANGED,status=DONE";
    expect(metrics.snapshot().counters[key]).toBe(1);
  });

  it("미지원 eventType (METHOD_UPDATED) → metrics.incr('payment.webhook.toss.ignored') + logger.warn", async () => {
    await handleTossWebhook({
      rawBody: unknownEventBody("METHOD_UPDATED"),
      signature: "sig",
      transmissionId: TRANSMISSION_ID,
    });

    expect(metrics.snapshot().counters["payment.webhook.toss.ignored"]).toBe(1);
    const warnCall = warnSpy.mock.calls.find((c) => c[0] === "payment.webhook.ignored");
    expect(warnCall).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────
// refund.ts — metrics/logger/captureException 훅
// ─────────────────────────────────────────────────────────────
describe("refund.ts — 관측성 훅", () => {
  const mockPaidPayment = {
    id: PAYMENT_ID,
    amount: AMOUNT,
    tossPaymentKey: PAYMENT_KEY,
  };
  const mockRefundJob = { id: "job_obs_001", attempts: 0 };

  beforeEach(() => {
    vi.clearAllMocks();
    metrics.resetForTest();
    setupDefaultTransaction();

    errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    // 기본: PAID 상태 정상 환불 셋업 (departure 포함 — refundBooking select에 departure 추가됨)
    mocks.db.booking.findUnique.mockResolvedValue({
      id: BOOKING_ID,
      status: "PAID",
      departure: { departureDate: new Date(Date.now() + 40 * 86_400_000) },
    });
    mocks.db.payment.findFirst.mockResolvedValue(mockPaidPayment);
    mocks.tx.refundJob.findFirst.mockResolvedValue(null);
    mocks.tx.refundJob.create.mockResolvedValue(mockRefundJob);
    mocks.tx.payment.update.mockResolvedValue({});
    mocks.tx.paymentEvent.create.mockResolvedValue({ id: "pevt_refund_1" });
    mocks.db.refundJob.update.mockResolvedValue({});
    mocks.tossClient.cancel.mockResolvedValue({});
    mocks.transitionStatus.mockResolvedValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("BOOKING_NOT_REFUNDABLE → metrics.incr('payment.refund.rejected', { reason })", async () => {
    mocks.db.booking.findUnique.mockResolvedValue({ id: BOOKING_ID, status: "RECEIVED" });

    await expect(
      refundBooking({ bookingId: BOOKING_ID, actor: "user:obs-test", applyPenalty: false })
    ).rejects.toMatchObject({ code: "BOOKING_NOT_REFUNDABLE" });

    const { counters } = metrics.snapshot();
    expect(counters["payment.refund.rejected|reason=BOOKING_NOT_REFUNDABLE"]).toBe(1);
  });

  it("PG cancel 실패 → logger.error('payment.refund.pg_cancel_failed') + metrics.incr('payment.refund.deferred') + captureException", async () => {
    mocks.tossClient.cancel.mockRejectedValue(new Error("PG timeout"));

    await expect(
      refundBooking({ bookingId: BOOKING_ID, actor: "user:obs-test", applyPenalty: false })
    ).rejects.toMatchObject({ code: "REFUND_DEFERRED" });

    const errCall = errorSpy.mock.calls.find((c) => c[0] === "payment.refund.pg_cancel_failed");
    expect(errCall).toBeDefined();
    expect(errCall![1]).toBeInstanceOf(Error);

    expect(metrics.snapshot().counters["payment.refund.deferred"]).toBe(1);
    expect(mocks.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ bookingId: BOOKING_ID })
    );
  });

  it("환불 성공 → metrics.incr('payment.refund.success')", async () => {
    // Phase 3 tx: refundJob update + payment update + paymentEvent create
    let txCallCount = 0;
    mocks.db.$transaction.mockImplementation(
      async (arg: ((tx: typeof mocks.tx) => unknown) | Array<Promise<unknown>>) => {
        txCallCount++;
        if (typeof arg === "function") return arg(mocks.tx);
        if (Array.isArray(arg)) return Promise.all(arg);
      }
    );
    mocks.tx.refundJob.findFirst.mockResolvedValue(null);
    mocks.tx.refundJob.create.mockResolvedValue(mockRefundJob);
    // Phase 3 tx calls
    mocks.tx.payment.update.mockResolvedValue({});
    mocks.tx.refundJob.update.mockResolvedValue({});
    mocks.tx.paymentEvent.create.mockResolvedValue({ id: "pevt_r_1" });

    await refundBooking({ bookingId: BOOKING_ID, actor: "user:obs-test", applyPenalty: false });

    expect(metrics.snapshot().counters["payment.refund.success"]).toBe(1);
  });
});
