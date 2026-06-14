import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  tx: {
    refundJob: { findFirst: vi.fn(), create: vi.fn() },
    payment: { findUniqueOrThrow: vi.fn() },
  },
  reserveRefund: vi.fn(),
}));

// ledger는 단위 격리 — reserve 호출 인자를 정밀 단언하기 위해 mock.
vi.mock("../ledger", () => ({ reserveRefund: mocks.reserveRefund }));

import { enqueueRefundJob } from "../enqueueRefundJob";
import { PaymentError } from "../errors";
import type { Prisma } from "@prisma/client";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reserveRefund.mockResolvedValue(true);
  // 기본: 미환불 payment (현 cascade 실동작 케이스 — refundedAmount=0)
  mocks.tx.payment.findUniqueOrThrow.mockResolvedValue({ refundedAmount: 0 });
});

const args = {
  bookingId: "b1",
  paymentId: "p1",
  amount: 1_000_000, // payment 총액
  actor: "admin:a1",
  reason: "departure canceled",
  cancellationBatchId: "batch1",
};

const tx = () => mocks.tx as unknown as Prisma.TransactionClient;

describe("enqueueRefundJob", () => {
  it("active job 없으면 reserve(잔여전액) 후 PENDING 생성 + batchId 보존", async () => {
    mocks.tx.refundJob.findFirst.mockResolvedValue(null);
    mocks.tx.refundJob.create.mockResolvedValue({ id: "rj1" });

    const res = await enqueueRefundJob(tx(), args);

    expect(res.enqueued).toBe(true);
    // refundedAmount=0 → 잔여 = 전액. saga refund.ts:65 Phase 1 미러: reserve(총액, 잔여).
    expect(mocks.reserveRefund).toHaveBeenCalledWith(mocks.tx, {
      paymentId: "p1",
      amount: 1_000_000,
      requestedRefund: 1_000_000,
    });
    // job.amount(= cron Toss cancelAmount) = 잔여액. 전액 케이스라 기존 값(전액)과 동일.
    expect(mocks.tx.refundJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bookingId: "b1",
          paymentId: "p1",
          amount: 1_000_000,
          actor: "admin:a1",
          status: "PENDING",
          cancellationBatchId: "batch1",
        }),
      }),
    );
  });

  it("부분환불 잔액 존재 시 잔여액만 예약·환불(과환불 차단)", async () => {
    mocks.tx.refundJob.findFirst.mockResolvedValue(null);
    mocks.tx.payment.findUniqueOrThrow.mockResolvedValue({ refundedAmount: 300_000 });
    mocks.tx.refundJob.create.mockResolvedValue({ id: "rj2" });

    await enqueueRefundJob(tx(), args);

    // 잔여 = 1_000_000 − 300_000 = 700_000 만 예약(상한 lte 가드는 reserveRefund 내부).
    expect(mocks.reserveRefund).toHaveBeenCalledWith(mocks.tx, {
      paymentId: "p1",
      amount: 1_000_000,
      requestedRefund: 700_000,
    });
    expect(mocks.tx.refundJob.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 700_000 }) }),
    );
  });

  it("active job(PENDING/IN_PROGRESS/SUCCEEDED) 있으면 skip — reserve·create 미호출 (이중 환불 차단)", async () => {
    mocks.tx.refundJob.findFirst.mockResolvedValue({ id: "existing" });

    const res = await enqueueRefundJob(tx(), args);

    expect(res.enqueued).toBe(false);
    expect(mocks.reserveRefund).not.toHaveBeenCalled();
    expect(mocks.tx.refundJob.create).not.toHaveBeenCalled();
  });

  it("reserve 실패(경합/한도초과 count=0) 시 PaymentError throw + 잡 미생성 (배치 전체 롤백)", async () => {
    mocks.tx.refundJob.findFirst.mockResolvedValue(null);
    mocks.reserveRefund.mockResolvedValue(false);

    await expect(enqueueRefundJob(tx(), args)).rejects.toBeInstanceOf(PaymentError);
    expect(mocks.tx.refundJob.create).not.toHaveBeenCalled();
  });
});
