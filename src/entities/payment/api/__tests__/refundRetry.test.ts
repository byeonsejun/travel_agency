import { describe, it, expect, vi, beforeEach } from "vitest";
import { InvalidTransitionError } from "@/entities/booking";

const mocks = vi.hoisted(() => {
  const tx = {
    refundJob: { updateMany: vi.fn(), update: vi.fn() },
    payment: { update: vi.fn(), updateMany: vi.fn() },
    paymentEvent: { create: vi.fn() },
    traveler: { updateMany: vi.fn() },
  };
  return {
    tx,
    db: {
      $transaction: vi.fn(),
      refundJob: {
        findMany: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        update: vi.fn(),
      },
    },
    tossClient: { cancel: vi.fn() },
    transitionStatusTx: vi.fn(),
    releaseSeats: vi.fn(),
  };
});

vi.mock("@/shared/lib/db", () => ({ db: mocks.db }));
vi.mock("@/shared/lib/toss", () => ({ tossClient: mocks.tossClient }));
vi.mock("@/entities/booking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/booking")>();
  return {
    ...actual,
    transitionStatusTx: mocks.transitionStatusTx,
    releaseSeats: mocks.releaseSeats,
  };
});

import { listDueRefundJobs, retryRefundJob } from "../refundRetry";

const JOB_ID = "refundjob_test_id_0001";
const BOOKING_ID = "booking_retry_test_id_0001";
const PAYMENT_ID = "payment_retry_test_id_001";
const TOSS_PAYMENT_KEY = "tpayments_test_retry_key_001";
const AMOUNT = 150_000;

function setupClaimSucceeds() {
  // $transaction이 callback을 받으면 tx 주입, 그 안 updateMany는 count:1 반환
  mocks.db.$transaction.mockImplementation(
    async (arg: ((tx: typeof mocks.tx) => unknown) | unknown[]) => {
      if (typeof arg === "function") return arg(mocks.tx);
      if (Array.isArray(arg)) return Promise.all(arg);
    }
  );
  mocks.tx.refundJob.updateMany.mockResolvedValue({ count: 1 });
  // traveler.updateMany 기본값: count=0 (이미 처리됨 → 멱등 skip)
  mocks.tx.traveler.updateMany.mockResolvedValue({ count: 0 });
}

function setupClaimFails() {
  mocks.db.$transaction.mockImplementation(
    async (arg: ((tx: typeof mocks.tx) => unknown) | unknown[]) => {
      if (typeof arg === "function") return arg(mocks.tx);
      if (Array.isArray(arg)) return Promise.all(arg);
    }
  );
  mocks.tx.refundJob.updateMany.mockResolvedValue({ count: 0 });
}

const DEPARTURE_ID = "departure_retry_test_id_001";

function mockJobLoad(opts: {
  paymentStatus?: "PAID" | "CANCELED" | "PARTIAL_CANCELED";
  tossPaymentKey?: string | null;
  actor?: string | null;
  attempts?: number;
  amount?: number;
  penaltyAmount?: number;
  paymentAmount?: number;
  /** payment.refundedAmount — 기본값은 paymentAmount(전액 환불 → CANCELED) */
  refundedAmount?: number;
  kind?: "FULL_CANCEL" | "TRAVELER_CANCEL" | "DISCRETIONARY";
  seatsReleased?: number;
}) {
  // mockResolvedValue(not Once)로 덮어쓰기 — clearAllMocks가 mockResolvedValue
  // 큐를 비우지 않아 테스트 간 leak이 발생하기 때문.
  // `?? default`는 명시적 null도 fallback해서 의도와 어긋남 — undefined 체크로 분리.
  const actor = opts.actor === undefined ? "user:cluser0001" : opts.actor;
  const tossPaymentKey =
    opts.tossPaymentKey === undefined ? TOSS_PAYMENT_KEY : opts.tossPaymentKey;
  const jobAmount = opts.amount ?? AMOUNT;
  const paymentAmount = opts.paymentAmount ?? AMOUNT;
  // refundedAmount 기본값: paymentAmount (전액 환불 → CANCELED)
  const refundedAmount = opts.refundedAmount ?? paymentAmount;
  mocks.db.refundJob.findUniqueOrThrow.mockResolvedValue({
    id: JOB_ID,
    bookingId: BOOKING_ID,
    paymentId: PAYMENT_ID,
    amount: jobAmount,
    penaltyAmount: opts.penaltyAmount ?? 0,
    reason: "test refund",
    actor,
    status: "IN_PROGRESS",
    attempts: opts.attempts ?? 1,
    kind: opts.kind ?? "FULL_CANCEL",
    seatsReleased: opts.seatsReleased ?? 0,
    payment: {
      id: PAYMENT_ID,
      tossPaymentKey,
      amount: paymentAmount,
      status: opts.paymentStatus ?? "PAID",
      refundedAmount,
    },
    booking: { departureId: DEPARTURE_ID },
  });
}

describe("listDueRefundJobs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("PENDING(nextRunAt 도래) + stuck IN_PROGRESS 두 경로 OR로 조회", async () => {
    mocks.db.refundJob.findMany.mockResolvedValue([{ id: "j1" }, { id: "j2" }]);
    const result = await listDueRefundJobs(10);
    expect(result).toEqual([{ id: "j1" }, { id: "j2" }]);

    const args = mocks.db.refundJob.findMany.mock.calls[0]![0];
    expect(args.where.OR).toEqual([
      { status: "PENDING", nextRunAt: { lte: expect.any(Date) } },
      { status: "IN_PROGRESS", updatedAt: { lt: expect.any(Date) } },
    ]);
    expect(args.take).toBe(10);
  });
});

describe("retryRefundJob", () => {
  beforeEach(() => vi.clearAllMocks());

  // ── Claim 실패 → skipped ─────────────────────────────────────────
  it("CAS claim 실패 시 (다른 worker가 선점) skipped 반환, 도메인 호출 0회", async () => {
    setupClaimFails();
    const result = await retryRefundJob(JOB_ID);
    expect(result).toEqual({ type: "skipped", jobId: JOB_ID, reason: "not_claimable" });
    expect(mocks.tossClient.cancel).not.toHaveBeenCalled();
    expect(mocks.db.refundJob.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  // ── Short-circuit: payment 이미 CANCELED ─────────────────────────
  it("Payment가 이미 CANCELED면 job을 SUCCEEDED로 정리하고 PG 호출 0회", async () => {
    setupClaimSucceeds();
    mockJobLoad({ paymentStatus: "CANCELED" });
    const result = await retryRefundJob(JOB_ID);
    expect(result.type).toBe("skipped");
    if (result.type === "skipped") expect(result.reason).toBe("payment_already_canceled");
    expect(mocks.tossClient.cancel).not.toHaveBeenCalled();
    expect(mocks.db.refundJob.update).toHaveBeenCalledWith({
      where: { id: JOB_ID },
      data: expect.objectContaining({ status: "SUCCEEDED" }),
    });
  });

  // ── Short-circuit: tossPaymentKey 부재 → FAILED 종료 ──────────────
  it("tossPaymentKey 부재 시 FAILED로 종료 + PG 호출 0회", async () => {
    setupClaimSucceeds();
    mockJobLoad({ tossPaymentKey: null });
    const result = await retryRefundJob(JOB_ID);
    expect(result.type).toBe("failed");
    expect(mocks.tossClient.cancel).not.toHaveBeenCalled();
    expect(mocks.db.refundJob.update).toHaveBeenCalledWith({
      where: { id: JOB_ID },
      data: expect.objectContaining({ status: "FAILED" }),
    });
  });

  // ── Phase 2 PG 실패 → deferred (backoff PENDING 재적재) ──────────
  it("PG cancel 실패 시 deferred + attempts 증가 + nextRunAt backoff 적용", async () => {
    setupClaimSucceeds();
    mockJobLoad({ attempts: 1 });
    mocks.tossClient.cancel.mockRejectedValue(new Error("PG_HTTP 500"));

    const result = await retryRefundJob(JOB_ID);

    expect(result.type).toBe("deferred");
    if (result.type === "deferred") {
      expect(result.attempts).toBe(2);
      expect(result.nextRunAt).toBeInstanceOf(Date);
      expect(result.nextRunAt.getTime()).toBeGreaterThan(Date.now());
    }
    expect(mocks.db.refundJob.update).toHaveBeenCalledWith({
      where: { id: JOB_ID },
      data: expect.objectContaining({
        status: "PENDING",
        attempts: { increment: 1 },
        lastError: expect.stringContaining("PG_HTTP"),
      }),
    });
    // Phase 3는 진행 안 됨
    expect(mocks.tx.payment.update).not.toHaveBeenCalled();
    expect(mocks.transitionStatusTx).not.toHaveBeenCalled();
  });

  // ── 성공 경로 (user actor, FULL_CANCEL) → succeeded + booking CANCELED_BY_USER ─
  it("성공 시 Payment CANCELED + RefundJob SUCCEEDED + booking CANCELED_BY_USER", async () => {
    setupClaimSucceeds();
    mockJobLoad({ actor: "user:cluser0001", kind: "FULL_CANCEL" });
    mocks.tossClient.cancel.mockResolvedValue({ status: "CANCELED" });
    mocks.transitionStatusTx.mockResolvedValue({} as never);

    const result = await retryRefundJob(JOB_ID);

    expect(result).toEqual({ type: "succeeded", jobId: JOB_ID });
    expect(mocks.tossClient.cancel).toHaveBeenCalledWith({
      paymentKey: TOSS_PAYMENT_KEY,
      cancelReason: "test refund",
      cancelAmount: AMOUNT,
    });
    // Phase 3 Tx 내 세 작업 모두 실행
    expect(mocks.tx.payment.update).toHaveBeenCalledWith({
      where: { id: PAYMENT_ID },
      data: expect.objectContaining({ status: "CANCELED" }),
    });
    expect(mocks.tx.refundJob.update).toHaveBeenCalledWith({
      where: { id: JOB_ID },
      data: { status: "SUCCEEDED" },
    });
    expect(mocks.tx.paymentEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "REFUND_REQUEST",
        providerEventId: expect.stringMatching(/^refund-retry:/),
      }),
    });
    // kind=FULL_CANCEL이면 kind 후처리 Tx 내 transitionStatusTx → CANCELED_BY_USER
    expect(mocks.transitionStatusTx).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({
        bookingId: BOOKING_ID,
        to: "CANCELED_BY_USER",
        skipSeatReturn: true,
      })
    );
  });

  // ── 성공 경로 (admin/system actor, FULL_CANCEL) → booking CANCELED_BY_AGENCY ───
  it("admin actor면 booking CANCELED_BY_AGENCY로 전이", async () => {
    setupClaimSucceeds();
    mockJobLoad({ actor: "admin:adm0001", kind: "FULL_CANCEL" });
    mocks.tossClient.cancel.mockResolvedValue({ status: "CANCELED" });
    mocks.transitionStatusTx.mockResolvedValue({} as never);

    await retryRefundJob(JOB_ID);

    expect(mocks.transitionStatusTx).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({ to: "CANCELED_BY_AGENCY" })
    );
  });

  // ── actor null (legacy row, FULL_CANCEL) → CANCELED_BY_AGENCY fallback ────────
  it("actor null이면 보수적으로 CANCELED_BY_AGENCY (외부 시스템 추정)", async () => {
    setupClaimSucceeds();
    mockJobLoad({ actor: null, kind: "FULL_CANCEL" });
    mocks.tossClient.cancel.mockResolvedValue({ status: "CANCELED" });
    mocks.transitionStatusTx.mockResolvedValue({} as never);

    await retryRefundJob(JOB_ID);

    expect(mocks.transitionStatusTx).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({
        to: "CANCELED_BY_AGENCY",
        actor: "system:cron",
      })
    );
  });

  // ── booking이 이미 CANCELED 상태 (InvalidTransitionError) — silent ─
  it("booking이 이미 종료 상태(InvalidTransitionError)면 환불 자체는 success 유지", async () => {
    setupClaimSucceeds();
    mockJobLoad({ kind: "FULL_CANCEL" });
    mocks.tossClient.cancel.mockResolvedValue({ status: "CANCELED" });
    mocks.transitionStatusTx.mockRejectedValue(
      new InvalidTransitionError("CANCELED_BY_USER", "CANCELED_BY_USER")
    );

    const result = await retryRefundJob(JOB_ID);

    // 환불 자체는 완료됐으므로 succeeded
    expect(result.type).toBe("succeeded");
    // PaymentEvent까지 모두 append됨
    expect(mocks.tx.paymentEvent.create).toHaveBeenCalled();
  });
});

describe("retryRefundJob — 부분 환불 스냅샷", () => {
  beforeEach(() => vi.clearAllMocks());

  // ── Case A: 부분 환불 → cancelAmount=job.amount, Payment=PARTIAL_CANCELED ─
  // refundedAmount(700_000) < paymentAmount(1_000_000) → PARTIAL_CANCELED
  it("Case A: refundedAmount < paymentAmount이면 job.amount로 PG 취소 + Payment PARTIAL_CANCELED", async () => {
    setupClaimSucceeds();
    // Payment 원금 1_000_000, 환불금 700_000, 위약금 300_000
    mockJobLoad({
      paymentStatus: "PAID",
      amount: 700_000,
      penaltyAmount: 300_000,
      paymentAmount: 1_000_000,
      refundedAmount: 700_000, // < 1_000_000 → PARTIAL_CANCELED
      kind: "FULL_CANCEL",
    });
    mocks.tossClient.cancel.mockResolvedValue({ status: "CANCELED" });
    mocks.transitionStatusTx.mockResolvedValue({} as never);

    const result = await retryRefundJob(JOB_ID);

    expect(result).toEqual({ type: "succeeded", jobId: JOB_ID });
    // PG 취소 금액은 job.amount(700_000) — payment.amount(1_000_000)가 아님
    expect(mocks.tossClient.cancel).toHaveBeenCalledWith({
      paymentKey: TOSS_PAYMENT_KEY,
      cancelReason: "test refund",
      cancelAmount: 700_000,
    });
    // Payment 상태는 PARTIAL_CANCELED (refundedAmount < amount)
    expect(mocks.tx.payment.update).toHaveBeenCalledWith({
      where: { id: PAYMENT_ID },
      data: expect.objectContaining({ status: "PARTIAL_CANCELED" }),
    });
    // PaymentEvent audit fields 포함 확인
    expect(mocks.tx.paymentEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payload: expect.objectContaining({
          penaltyAmount: 300_000,
          refundAmount: 700_000,
        }),
      }),
    });
  });

  // ── Case B: 전액 환불 → Payment=CANCELED ─────────────
  // refundedAmount(500_000) >= paymentAmount(500_000) → CANCELED
  it("Case B: refundedAmount >= paymentAmount이면 Payment CANCELED (전액 환불 / cascade 경로)", async () => {
    setupClaimSucceeds();
    mockJobLoad({
      paymentStatus: "PAID",
      amount: 500_000,
      penaltyAmount: 0,
      paymentAmount: 500_000,
      refundedAmount: 500_000, // >= 500_000 → CANCELED
      kind: "FULL_CANCEL",
    });
    mocks.tossClient.cancel.mockResolvedValue({ status: "CANCELED" });
    mocks.transitionStatusTx.mockResolvedValue({} as never);

    const result = await retryRefundJob(JOB_ID);

    expect(result).toEqual({ type: "succeeded", jobId: JOB_ID });
    expect(mocks.tossClient.cancel).toHaveBeenCalledWith(
      expect.objectContaining({ cancelAmount: 500_000 })
    );
    expect(mocks.tx.payment.update).toHaveBeenCalledWith({
      where: { id: PAYMENT_ID },
      data: expect.objectContaining({ status: "CANCELED" }),
    });
  });

  // ── Case C: Payment가 이미 PARTIAL_CANCELED → skipped, PG 호출 0회 ─
  it("Case C: Payment가 이미 PARTIAL_CANCELED면 job SUCCEEDED 정리 + PG 호출 0회", async () => {
    setupClaimSucceeds();
    mockJobLoad({
      paymentStatus: "PARTIAL_CANCELED",
      amount: 700_000,
      penaltyAmount: 300_000,
      paymentAmount: 1_000_000,
    });

    const result = await retryRefundJob(JOB_ID);

    expect(result.type).toBe("skipped");
    if (result.type === "skipped") {
      expect(result.reason).toBe("payment_already_canceled");
    }
    expect(mocks.tossClient.cancel).not.toHaveBeenCalled();
    expect(mocks.db.refundJob.update).toHaveBeenCalledWith({
      where: { id: JOB_ID },
      data: expect.objectContaining({ status: "SUCCEEDED" }),
    });
  });
});
