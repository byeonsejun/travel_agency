import { describe, it, expect, vi, beforeEach } from "vitest";

const cancel = vi.fn().mockResolvedValue(undefined);
vi.mock("@/shared/lib/toss", () => ({ tossClient: { cancel: (...a: unknown[]) => cancel(...a) } }));
const transitionStatus = vi.fn();
vi.mock("@/entities/booking", () => ({ transitionStatus: (...a: unknown[]) => transitionStatus(...a) }));
vi.mock("@/shared/lib/observability", () => ({
  logger: { error: vi.fn() }, metrics: { incr: vi.fn() }, captureException: vi.fn(),
}));
vi.mock("@/shared/lib/email-job/enqueue", () => ({ enqueueEmailJob: vi.fn().mockResolvedValue(undefined) }));

const reserveCount = { value: 1 };
const existingJob = { value: null as null | { id: string } };
vi.mock("@/shared/lib/db", () => {
  const tx = {
    payment: {
      updateMany: vi.fn().mockImplementation(() => Promise.resolve({ count: reserveCount.value })),
      update: vi.fn().mockResolvedValue({}),
    },
    refundJob: {
      findUnique: vi.fn().mockImplementation(() => Promise.resolve(existingJob.value)),
      create: vi.fn().mockResolvedValue({ id: "rj1", attempts: 0 }),
      update: vi.fn().mockResolvedValue({}),
    },
    paymentEvent: { create: vi.fn() },
    traveler: { updateMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    booking: { findUnique: vi.fn() },
  };
  return {
    db: {
      $transaction: vi.fn().mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      payment: { findFirst: vi.fn().mockResolvedValue({ id: "p1", amount: 1000, refundedAmount: 0, tossPaymentKey: "pk1" }) },
    },
  };
});

import { refundDiscretionary } from "../refund";

describe("refundDiscretionary", () => {
  beforeEach(() => { reserveCount.value = 1; existingJob.value = null; cancel.mockClear(); });

  it("재량 환불은 booking 전이 없이 PG cancel(요청액)만 수행", async () => {
    await refundDiscretionary({ bookingId: "bk1", paymentId: "p1", amount: 300, actor: "admin:1", requestId: "r1" });
    expect(cancel).toHaveBeenCalledWith(expect.objectContaining({ cancelAmount: 300 }));
    expect(transitionStatus).not.toHaveBeenCalled();
  });

  it("한도초과(reserve count=0) → REFUND_EXCEEDS_REFUNDABLE, PG 미호출", async () => {
    reserveCount.value = 0;
    await expect(
      refundDiscretionary({ bookingId: "bk1", paymentId: "p1", amount: 300, actor: "admin:1", requestId: "r2" })
    ).rejects.toThrow(/REFUND_EXCEEDS_REFUNDABLE/);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("멱등: 동일 idempotencyKey 기존 Job 존재 → no-op(PG 미호출)", async () => {
    existingJob.value = { id: "rj-existing" };
    await refundDiscretionary({ bookingId: "bk1", paymentId: "p1", amount: 300, actor: "admin:1", requestId: "r1" });
    expect(cancel).not.toHaveBeenCalled();
  });
});
