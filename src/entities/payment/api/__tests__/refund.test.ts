import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted: vi.mock factory 실행 전 mocks 객체를 먼저 준비
const mocks = vi.hoisted(() => {
  const tx = {
    refundJob: {
      findUnique: vi.fn(),   // idempotencyKey 멱등 검사 (신규 runRefundSaga 방식)
      findFirstOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    payment: {
      updateMany: vi.fn(),   // reserveRefund 조건부 차감
      update: vi.fn(),
    },
    paymentEvent: { create: vi.fn() },
    traveler: { updateMany: vi.fn() },
    departure: { updateMany: vi.fn() },
    emailJob: { findUnique: vi.fn(), create: vi.fn() },
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
    transitionStatusTx: vi.fn(),
    releaseSeats: vi.fn(),
    enqueueEmailJob: vi.fn(),
  };
});

vi.mock("@/shared/lib/db", () => ({ db: mocks.db }));
vi.mock("@/shared/lib/toss", () => ({ tossClient: mocks.tossClient }));
vi.mock("@/entities/booking", () => ({
  transitionStatusTx: mocks.transitionStatusTx,
  releaseSeats: mocks.releaseSeats,
}));
vi.mock("@/shared/lib/observability", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  metrics: { incr: vi.fn() },
  captureException: vi.fn(),
}));
vi.mock("@/shared/lib/email-job/enqueue", () => ({
  enqueueEmailJob: mocks.enqueueEmailJob,
}));
// penalty-policy: 순수 computePenalty/OVERSEAS_PENALTY_TIERS 는 실제 유지, DB read 인
// getTiersBySnapshot 만 stub (시스템 기본 tiers 반환 → 기존 위약금 단가 검증 불변).
// 주의: 팩토리는 hoist 되므로 top-level import 바인딩을 참조하면 TDZ. orig 에서 직접 꺼낸다.
vi.mock("@/entities/penalty-policy", async (orig) => {
  const actual = await orig<typeof import("@/entities/penalty-policy")>();
  return {
    ...actual,
    getTiersBySnapshot: vi.fn().mockResolvedValue(actual.OVERSEAS_PENALTY_TIERS),
  };
});

import { refundBooking, backoff, refundTraveler } from "../refund";

// ── 공통 픽스처 ────────────────────────────────────────────────
const BOOKING_ID = "booking_refund_testid001";
const PAYMENT_ID = "payment_refund_testid002";
const TOSS_PAYMENT_KEY = "tpayments_sk_test_refund_key";
const AMOUNT = 200_000;
const JOB_ID = "refundjob_testid_001";

/** 오늘 날짜 기준 N일 후 UTC 자정 Date (Prisma @db.Date 형식과 동일) */
function futureDateUtcMidnight(daysFromNow: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d;
}

/** 기본 픽스처: departure.departureDate 포함 (기존 테스트 호환용 — 40일 후로 위약금 0%) */
const DEPARTURE_DATE_FAR = futureDateUtcMidnight(40);

const TRAVELER_ID_1 = "traveler_t1";
const TRAVELER_ID_2 = "traveler_t2";

// refundBooking (첫 번째 findUnique — traveler ids 조회용)
const mockBookingForWrapper = {
  travelers: [{ id: TRAVELER_ID_1 }, { id: TRAVELER_ID_2 }],
};

// refundTraveler 내부에서 사용하는 상세 booking
const mockPaidBookingFull = {
  id: BOOKING_ID,
  status: "PAID" as const,
  departureId: "dep1",
  penaltyPolicyKey: null,
  penaltyPolicyVersion: null,
  departure: { departureDate: DEPARTURE_DATE_FAR },
  travelers: [
    { id: TRAVELER_ID_1, paxType: "ADULT" as const, unitPrice: 100_000, canceledAt: null },
    { id: TRAVELER_ID_2, paxType: "ADULT" as const, unitPrice: 100_000, canceledAt: null },
  ],
};
const mockReadyBookingFull = {
  ...mockPaidBookingFull,
  status: "READY" as const,
};

const mockPaidPayment = {
  id: PAYMENT_ID,
  amount: AMOUNT,
  refundedAmount: 0,
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

    // refundBooking (wrapper) — travelers 목록 조회
    // refundTraveler — 상세 booking 조회 (두 번 호출됨)
    mocks.db.booking.findUnique
      .mockResolvedValueOnce(mockBookingForWrapper)   // refundBooking 래퍼
      .mockResolvedValueOnce(mockPaidBookingFull);    // refundTraveler 내부

    mocks.db.payment.findFirst.mockResolvedValue(mockPaidPayment);

    // Phase 1 tx: 멱등 검사 없음 + reserveRefund 성공 + create
    mocks.tx.refundJob.findUnique.mockResolvedValue(null);
    mocks.tx.payment.updateMany.mockResolvedValue({ count: 1 }); // reserveRefund OK
    mocks.tx.refundJob.create.mockResolvedValue(mockRefundJob);
    mocks.tx.refundJob.findFirstOrThrow.mockResolvedValue({ id: JOB_ID });

    // Phase 3 tx
    mocks.tx.payment.update.mockResolvedValue({});
    mocks.tx.refundJob.update.mockResolvedValue({});
    mocks.tx.paymentEvent.create.mockResolvedValue({ id: "pevt_refund_1" });
    mocks.tx.traveler.updateMany.mockResolvedValue({ count: 2 });

    // onSettled tx (traveler 표식 + 좌석 환원 + terminal 전이)
    mocks.releaseSeats.mockResolvedValue(undefined);
    mocks.transitionStatusTx.mockResolvedValue({ id: BOOKING_ID, status: "CANCELED_BY_USER" });

    // Phase 2 기본: cancel 성공
    mocks.tossClient.cancel.mockResolvedValue({
      paymentKey: TOSS_PAYMENT_KEY,
      status: "CANCELED",
      cancels: [],
    });

    // Phase 2 실패 경로 (tx 밖 refundJob update)
    mocks.db.refundJob.update.mockResolvedValue({});

    // enqueueEmailJob 기본: 성공
    mocks.enqueueEmailJob.mockResolvedValue(undefined);
  });

  // ── 시나리오 1: PAID 정상 환불 → CANCELED_BY_USER ───────────
  it("PAID booking 정상 환불: Payment CANCELED, RefundJob SUCCEEDED, booking CANCELED_BY_USER", async () => {
    await refundBooking({ bookingId: BOOKING_ID, actor: "user:test123", reason: "단순 변심", applyPenalty: false });

    // Phase 3: Payment CANCELED (전액 환불 — 위약금 0)
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

    // onSettled: booking terminal 전이 — FULL_CANCEL(마지막 여행자), skipSeatReturn: true
    expect(mocks.transitionStatusTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        bookingId: BOOKING_ID,
        to: "CANCELED_BY_USER",
        actor: "user:test123",
        skipSeatReturn: true,
      })
    );

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
    mocks.db.booking.findUnique
      .mockReset()
      .mockResolvedValueOnce(mockBookingForWrapper)
      .mockResolvedValueOnce(mockReadyBookingFull);

    await refundBooking({ bookingId: BOOKING_ID, actor: "admin:manager01", applyPenalty: false });

    expect(mocks.transitionStatusTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        to: "CANCELED_BY_AGENCY",
        actor: "admin:manager01",
      })
    );
  });

  // ── 시나리오 3: 이중 환불 요청 → 멱등 종료(no-op) ─────────────
  // 신규 구조: idempotencyKey 기반 멱등. findUnique가 기존 job을 반환하면 no-op.
  it("멱등: 동일 idempotencyKey 기존 Job 존재 → no-op(PG 미호출)", async () => {
    mocks.tx.refundJob.findUnique.mockResolvedValue({ id: "existing_job_id" });

    // no-op이므로 정상 완료(throw 없음)
    await refundBooking({ bookingId: BOOKING_ID, actor: "user:test123", applyPenalty: false });

    expect(mocks.tossClient.cancel).not.toHaveBeenCalled();
    expect(mocks.transitionStatusTx).not.toHaveBeenCalled();
    expect(mocks.tx.payment.update).not.toHaveBeenCalled();
  });

  // ── 시나리오 4: PG cancel 실패 → RefundJob PENDING + REFUND_DEFERRED ─
  it("PG cancel 실패: RefundJob PENDING 재적재 + nextRunAt 미래, booking 미전이", async () => {
    mocks.tossClient.cancel.mockRejectedValue(new Error("Toss API 500 Internal Server Error"));

    await expect(
      refundBooking({ bookingId: BOOKING_ID, actor: "user:test123", applyPenalty: false })
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
    expect(mocks.transitionStatusTx).not.toHaveBeenCalled();

    // Phase 3 (Payment CANCELED) 미실행
    expect(mocks.tx.payment.update).not.toHaveBeenCalled();
  });

  // ── 시나리오 5: 환불 불가 상태 (RECEIVED) → BOOKING_NOT_REFUNDABLE ─
  it("RECEIVED booking: BOOKING_NOT_REFUNDABLE throw, payment 조회 미호출", async () => {
    mocks.db.booking.findUnique
      .mockReset()
      .mockResolvedValueOnce(mockBookingForWrapper)
      .mockResolvedValueOnce({
        id: BOOKING_ID,
        status: "RECEIVED",
        departureId: "dep1",
        penaltyPolicyKey: null,
        penaltyPolicyVersion: null,
        departure: { departureDate: DEPARTURE_DATE_FAR },
        travelers: [
          { id: TRAVELER_ID_1, paxType: "ADULT", unitPrice: 100_000, canceledAt: null },
        ],
      });

    await expect(
      refundBooking({ bookingId: BOOKING_ID, actor: "user:test123", applyPenalty: false })
    ).rejects.toMatchObject({ code: "BOOKING_NOT_REFUNDABLE" });

    expect(mocks.db.payment.findFirst).not.toHaveBeenCalled();
    expect(mocks.tossClient.cancel).not.toHaveBeenCalled();
  });

  // ── 시나리오 6: PAID Payment 없음 → PAID_PAYMENT_NOT_FOUND ───
  it("PAID Payment 없음: PAID_PAYMENT_NOT_FOUND throw", async () => {
    mocks.db.payment.findFirst.mockResolvedValue(null);

    await expect(
      refundBooking({ bookingId: BOOKING_ID, actor: "user:test123", applyPenalty: false })
    ).rejects.toMatchObject({ code: "PAID_PAYMENT_NOT_FOUND" });

    expect(mocks.tossClient.cancel).not.toHaveBeenCalled();
  });

  // ── 시나리오 7: actor "system:" → CANCELED_BY_AGENCY ─────────
  it("system actor: CANCELED_BY_AGENCY 전이", async () => {
    await refundBooking({ bookingId: BOOKING_ID, actor: "system:admin-cron", applyPenalty: false });

    expect(mocks.transitionStatusTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ to: "CANCELED_BY_AGENCY" })
    );
  });
});

// ── 위약금 분기 테스트 ────────────────────────────────────────────
describe("refundBooking — 부분 환불(위약금)", () => {
  const PENALTY_JOB_ID = "refundjob_penalty_001";
  const mockPenaltyRefundJob = { id: PENALTY_JOB_ID, attempts: 0 };

  function setupPenaltyTransaction(): void {
    mocks.db.$transaction.mockImplementation(
      async (arg: ((tx: typeof mocks.tx) => unknown) | Array<Promise<unknown>>) => {
        if (typeof arg === "function") return arg(mocks.tx);
        if (Array.isArray(arg)) return Promise.all(arg);
      }
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    setupPenaltyTransaction();

    // Phase 1 tx 기본: 중복 없음
    mocks.tx.refundJob.findUnique.mockResolvedValue(null);
    mocks.tx.payment.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.refundJob.create.mockResolvedValue(mockPenaltyRefundJob);
    mocks.tx.refundJob.findFirstOrThrow.mockResolvedValue({ id: PENALTY_JOB_ID });

    // Phase 3 tx 기본
    mocks.tx.payment.update.mockResolvedValue({});
    mocks.tx.refundJob.update.mockResolvedValue({});
    mocks.tx.paymentEvent.create.mockResolvedValue({ id: "pevt_penalty_1" });
    mocks.tx.traveler.updateMany.mockResolvedValue({ count: 2 });

    // Phase 2: cancel 성공
    mocks.tossClient.cancel.mockResolvedValue({ status: "PARTIAL_CANCELED" });

    // onSettled
    mocks.releaseSeats.mockResolvedValue(undefined);
    mocks.transitionStatusTx.mockResolvedValue({ id: BOOKING_ID, status: "CANCELED_BY_USER" });

    // Phase 2 실패 경로 (tx 밖 refundJob update)
    mocks.db.refundJob.update.mockResolvedValue({});
  });

  // ── Case A: applyPenalty=true, D≈3 → 30%, amount=1,000,000 ─────
  it("Case A: D=3일(30% 위약금), amount=1000000 → PARTIAL_CANCELED", async () => {
    const departureDate = futureDateUtcMidnight(3);
    const paymentAmount = 1_000_000;

    mocks.db.booking.findUnique
      .mockResolvedValueOnce({ travelers: [{ id: TRAVELER_ID_1 }] })
      .mockResolvedValueOnce({
        id: BOOKING_ID,
        status: "PAID" as const,
        departureId: "dep1",
        penaltyPolicyKey: null,
        penaltyPolicyVersion: null,
        departure: { departureDate },
        travelers: [
          { id: TRAVELER_ID_1, paxType: "ADULT", unitPrice: paymentAmount, canceledAt: null },
        ],
      });
    mocks.db.payment.findFirst.mockResolvedValue({
      id: PAYMENT_ID,
      amount: paymentAmount,
      refundedAmount: 0,
      tossPaymentKey: TOSS_PAYMENT_KEY,
    });

    await refundBooking({
      bookingId: BOOKING_ID,
      actor: "user:test123",
      reason: "단순 변심",
      applyPenalty: true,
    });

    // Phase 1: RefundJob 생성 — amount=700000, penaltyAmount=300000
    expect(mocks.tx.refundJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: 700_000,
          penaltyAmount: 300_000,
        }),
      })
    );

    // Phase 2: Toss cancel — cancelAmount=700000 (위약금 차감 후 환불액)
    expect(mocks.tossClient.cancel).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentKey: TOSS_PAYMENT_KEY,
        cancelAmount: 700_000,
      })
    );

    // Phase 3: Payment PARTIAL_CANCELED (refundedAmount(0) + refundAmount(700000) < amount(1000000))
    expect(mocks.tx.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PAYMENT_ID },
        data: expect.objectContaining({ status: "PARTIAL_CANCELED" }),
      })
    );
  });

  // ── Case B: applyPenalty=true, D=40일(0% 위약금), amount=500,000 ─
  it("Case B: D=40일(0% 위약금), amount=500000 → CANCELED (전액 환불)", async () => {
    const departureDate = futureDateUtcMidnight(40);
    const paymentAmount = 500_000;

    mocks.db.booking.findUnique
      .mockResolvedValueOnce({ travelers: [{ id: TRAVELER_ID_1 }] })
      .mockResolvedValueOnce({
        id: BOOKING_ID,
        status: "PAID" as const,
        departureId: "dep1",
        penaltyPolicyKey: null,
        penaltyPolicyVersion: null,
        departure: { departureDate },
        travelers: [
          { id: TRAVELER_ID_1, paxType: "ADULT", unitPrice: paymentAmount, canceledAt: null },
        ],
      });
    mocks.db.payment.findFirst.mockResolvedValue({
      id: PAYMENT_ID,
      amount: paymentAmount,
      refundedAmount: 0,
      tossPaymentKey: TOSS_PAYMENT_KEY,
    });

    await refundBooking({
      bookingId: BOOKING_ID,
      actor: "user:test123",
      applyPenalty: true,
    });

    // Phase 1: RefundJob — penaltyAmount=0, amount=500000
    expect(mocks.tx.refundJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: 500_000,
          penaltyAmount: 0,
        }),
      })
    );

    // Phase 2: Toss cancel — cancelAmount=500000 (전액)
    expect(mocks.tossClient.cancel).toHaveBeenCalledWith(
      expect.objectContaining({ cancelAmount: 500_000 })
    );

    // Phase 3: penaltyAmount=0, refundedAmount(0)+refundAmount(500000)=amount(500000) → CANCELED
    expect(mocks.tx.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PAYMENT_ID },
        data: expect.objectContaining({ status: "CANCELED" }),
      })
    );
  });

  // ── Case C: applyPenalty=false, D=2일(위약금 면제), amount=500,000 ─
  it("Case C: applyPenalty=false, D=2일이어도 위약금 0 → 전액 환불 + CANCELED", async () => {
    const departureDate = futureDateUtcMidnight(2); // D-2, 적용 시 30%이지만 applyPenalty=false
    const paymentAmount = 500_000;

    mocks.db.booking.findUnique
      .mockResolvedValueOnce({ travelers: [{ id: TRAVELER_ID_1 }] })
      .mockResolvedValueOnce({
        id: BOOKING_ID,
        status: "PAID" as const,
        departureId: "dep1",
        penaltyPolicyKey: null,
        penaltyPolicyVersion: null,
        departure: { departureDate },
        travelers: [
          { id: TRAVELER_ID_1, paxType: "ADULT", unitPrice: paymentAmount, canceledAt: null },
        ],
      });
    mocks.db.payment.findFirst.mockResolvedValue({
      id: PAYMENT_ID,
      amount: paymentAmount,
      refundedAmount: 0,
      tossPaymentKey: TOSS_PAYMENT_KEY,
    });

    await refundBooking({
      bookingId: BOOKING_ID,
      actor: "admin:manager01",
      reason: "관리자 면제",
      applyPenalty: false,
    });

    // Phase 1: RefundJob — penaltyAmount=0, amount=500000 (전액)
    expect(mocks.tx.refundJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: 500_000,
          penaltyAmount: 0,
        }),
      })
    );

    // Phase 2: Toss cancel — cancelAmount=500000 (전액)
    expect(mocks.tossClient.cancel).toHaveBeenCalledWith(
      expect.objectContaining({ cancelAmount: 500_000 })
    );

    // Phase 3: penaltyAmount=0 → CANCELED
    expect(mocks.tx.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PAYMENT_ID },
        data: expect.objectContaining({ status: "CANCELED" }),
      })
    );
  });
});

// ── 부분 환불 이메일 아웃박스 enqueue 테스트 ──────────────────────────────────
describe("runRefundSaga — PARTIAL_REFUND_COMPLETED enqueue", () => {
  const DISC_JOB_ID = "refundjob_disc_email_001";
  const DISC_BOOKING_ID = "booking_disc_email_001";
  const DISC_PAYMENT_ID = "payment_disc_email_001";

  function setupEmailTransaction(): void {
    mocks.db.$transaction.mockImplementation(
      async (arg: ((tx: typeof mocks.tx) => unknown) | Array<Promise<unknown>>) => {
        if (typeof arg === "function") return arg(mocks.tx);
        if (Array.isArray(arg)) return Promise.all(arg);
      }
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    setupEmailTransaction();

    mocks.tx.refundJob.findUnique.mockResolvedValue(null);
    mocks.tx.payment.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.refundJob.create.mockResolvedValue({ id: DISC_JOB_ID, attempts: 0 });
    mocks.tx.payment.update.mockResolvedValue({});
    mocks.tx.refundJob.update.mockResolvedValue({});
    mocks.tx.paymentEvent.create.mockResolvedValue({ id: "pevt_disc_1" });
    mocks.tx.traveler.updateMany.mockResolvedValue({ count: 0 });
    mocks.tx.emailJob.findUnique.mockResolvedValue(null);
    mocks.tx.emailJob.create.mockResolvedValue({ id: "emailjob_disc_1" });
    mocks.db.refundJob.update.mockResolvedValue({});
    mocks.tossClient.cancel.mockResolvedValue({ status: "CANCELED" });
    mocks.releaseSeats.mockResolvedValue(undefined);
    mocks.transitionStatusTx.mockResolvedValue({});
    mocks.enqueueEmailJob.mockResolvedValue(undefined);
  });

  // ── DISCRETIONARY: enqueueEmailJob 호출됨 ─────────────────────────
  it("DISCRETIONARY 환불 성공 시 enqueueEmailJob(PARTIAL_REFUND_COMPLETED) 호출", async () => {
    mocks.db.payment.findFirst.mockResolvedValue({
      id: DISC_PAYMENT_ID,
      amount: 100_000,
      refundedAmount: 0,
      tossPaymentKey: "tpayments_test_disc_key",
    });

    const { refundDiscretionary } = await import("../refund");
    await refundDiscretionary({
      bookingId: DISC_BOOKING_ID,
      paymentId: DISC_PAYMENT_ID,
      amount: 50_000,
      actor: "admin:mgr01",
      requestId: "req_disc_001",
    });

    expect(mocks.enqueueEmailJob).toHaveBeenCalledOnce();
    expect(mocks.enqueueEmailJob).toHaveBeenCalledWith(
      expect.anything(), // tx
      expect.objectContaining({
        type: "PARTIAL_REFUND_COMPLETED",
        dedupeKey: `partial-refund-completed:${DISC_JOB_ID}`,
        bookingId: DISC_BOOKING_ID,
        refundJobId: DISC_JOB_ID,
      })
    );
  });

  // ── TRAVELER_CANCEL (not-last): enqueueEmailJob 호출됨 ────────────
  it("TRAVELER_CANCEL(not-last) 성공 시 enqueueEmailJob(PARTIAL_REFUND_COMPLETED) 호출", async () => {
    const TRAV_JOB_ID = "refundjob_trav_email_001";
    mocks.tx.refundJob.create.mockResolvedValue({ id: TRAV_JOB_ID, attempts: 0 });
    mocks.tx.refundJob.findFirstOrThrow.mockResolvedValue({ id: TRAV_JOB_ID });

    mocks.db.booking.findUnique.mockResolvedValue({
      id: DISC_BOOKING_ID,
      status: "PAID",
      departureId: "dep_trav_1",
      penaltyPolicyKey: null,
      penaltyPolicyVersion: null,
      departure: { departureDate: futureDateUtcMidnight(40) },
      travelers: [
        { id: "traveler_A", paxType: "ADULT", unitPrice: 100_000, canceledAt: null },
        { id: "traveler_B", paxType: "ADULT", unitPrice: 100_000, canceledAt: null },
      ],
    });
    mocks.db.payment.findFirst.mockResolvedValue({
      id: DISC_PAYMENT_ID,
      amount: 200_000,
      refundedAmount: 0,
      tossPaymentKey: "tpayments_test_trav_key",
    });

    const { refundTraveler } = await import("../refund");
    await refundTraveler({
      bookingId: DISC_BOOKING_ID,
      travelerIds: ["traveler_A"],  // not-last (traveler_B remains)
      actor: "admin:mgr01",
      applyPenalty: false,
    });

    expect(mocks.enqueueEmailJob).toHaveBeenCalledOnce();
    expect(mocks.enqueueEmailJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: "PARTIAL_REFUND_COMPLETED",
        dedupeKey: `partial-refund-completed:${TRAV_JOB_ID}`,
        bookingId: DISC_BOOKING_ID,
        refundJobId: TRAV_JOB_ID,
      })
    );
  });

  // ── FULL_CANCEL: enqueueEmailJob 호출되지 않음 ────────────────────
  it("FULL_CANCEL(refundBooking) 성공 시 enqueueEmailJob 미호출 (FULL_CANCEL 제외)", async () => {
    const FC_JOB_ID = "refundjob_fc_email_001";
    mocks.tx.refundJob.create.mockResolvedValue({ id: FC_JOB_ID, attempts: 0 });
    mocks.tx.refundJob.findFirstOrThrow.mockResolvedValue({ id: FC_JOB_ID });

    mocks.db.booking.findUnique
      .mockResolvedValueOnce({ travelers: [{ id: "traveler_A" }] })  // refundBooking 래퍼
      .mockResolvedValueOnce({
        id: DISC_BOOKING_ID,
        status: "PAID",
        departureId: "dep_fc_1",
        penaltyPolicyKey: null,
        penaltyPolicyVersion: null,
        departure: { departureDate: futureDateUtcMidnight(40) },
        travelers: [
          { id: "traveler_A", paxType: "ADULT", unitPrice: 100_000, canceledAt: null },
        ],
      });
    mocks.db.payment.findFirst.mockResolvedValue({
      id: DISC_PAYMENT_ID,
      amount: 100_000,
      refundedAmount: 0,
      tossPaymentKey: "tpayments_test_fc_key",
    });

    const { refundBooking: refundBookingFn } = await import("../refund");
    await refundBookingFn({
      bookingId: DISC_BOOKING_ID,
      actor: "user:usr001",
      applyPenalty: false,
    });

    // FULL_CANCEL이므로 partial 메일 enqueue 없음
    expect(mocks.enqueueEmailJob).not.toHaveBeenCalled();
  });
});

// ── refundAmount===0 Toss-skip 가드 테스트 ───────────────────────────────
describe("refundTraveler — refundAmount===0 Toss-skip 가드", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.$transaction.mockImplementation(
      async (arg: ((tx: typeof mocks.tx) => unknown) | Array<Promise<unknown>>) => {
        if (typeof arg === "function") return arg(mocks.tx);
        if (Array.isArray(arg)) return Promise.all(arg);
      }
    );
    mocks.tx.refundJob.findUnique.mockResolvedValue(null);
    mocks.tx.payment.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.refundJob.create.mockResolvedValue({ id: "rj0", attempts: 0 });
    mocks.tx.refundJob.findFirstOrThrow.mockResolvedValue({ id: "rj0" });
    mocks.tx.payment.update.mockResolvedValue({});
    mocks.tx.refundJob.update.mockResolvedValue({});
    mocks.tx.paymentEvent.create.mockResolvedValue({ id: "pevt_zero_1" });
    mocks.tx.traveler.updateMany.mockResolvedValue({ count: 1 });
    mocks.releaseSeats.mockResolvedValue(undefined);
    mocks.transitionStatusTx.mockResolvedValue({ id: "bk0", status: "CANCELED_BY_AGENCY" });
    mocks.db.refundJob.update.mockResolvedValue({});
    mocks.enqueueEmailJob.mockResolvedValue(undefined);
  });

  it("refundAmount===0(100% 위약금)이면 tossClient.cancel을 호출하지 않고 settle한다", async () => {
    // unitPrice=0인 여행자 → canceledBase=0 → refundAmount=0
    mocks.db.booking.findUnique.mockResolvedValue({
      id: "bk0", status: "PAID", departureId: "dp0",
      penaltyPolicyKey: null, penaltyPolicyVersion: null,
      departure: { departureDate: new Date("2026-12-25") },
      travelers: [{ id: "t0", paxType: "ADULT", unitPrice: 0, canceledAt: null }],
    });
    mocks.db.payment.findFirst.mockResolvedValue({
      id: "pay0", amount: 100000, refundedAmount: 0, tossPaymentKey: "tk0",
    });

    await refundTraveler({ bookingId: "bk0", travelerIds: ["t0"], actor: "admin:a", applyPenalty: false });

    expect(mocks.tossClient.cancel).not.toHaveBeenCalled();
    // settle은 수행 — refundJob SUCCEEDED 업데이트가 일어남
    expect(mocks.tx.refundJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "SUCCEEDED" }) }),
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
