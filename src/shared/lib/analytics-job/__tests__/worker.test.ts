import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    analyticsJob: { findMany: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    booking: { findUnique: vi.fn() },
    refundJob: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
  sendToGa4: vi.fn(),
}));

vi.mock("@/shared/lib/db", () => ({ db: mocks.db }));
vi.mock("@/shared/lib/observability", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  metrics: { incr: vi.fn() },
  captureException: vi.fn(),
}));
vi.mock("../mp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../mp")>()),
  sendToGa4: mocks.sendToGa4,
}));

import { processAnalyticsJobBatch } from "../worker";

const NOW = Date.now();
const BOOKING = {
  id: "clbk1",
  totalPrice: 2_000_000,
  gaClientId: "123.456",
  departure: { product: { id: "p1", title: "오사카", destination: "오사카, 일본" } },
  travelers: [
    { paxType: "ADULT", unitPrice: 1_000_000 },
    { paxType: "ADULT", unitPrice: 1_000_000 },
  ],
};

function job(over: Record<string, unknown> = {}) {
  return {
    id: "claj1",
    type: "PURCHASE",
    bookingId: "clbk1",
    refundJobId: null,
    occurredAt: new Date(NOW - 60_000),
    attempts: 0,
    ...over,
  };
}

function wireClaim(count = 1) {
  mocks.db.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({ analyticsJob: { updateMany: vi.fn().mockResolvedValue({ count }) } }),
  );
}

describe("processAnalyticsJobBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wireClaim(1);
    mocks.db.analyticsJob.findMany.mockResolvedValue([{ id: "claj1" }]);
    mocks.db.booking.findUnique.mockResolvedValue(BOOKING);
    mocks.sendToGa4.mockResolvedValue({ mode: "sent" });
  });

  it("PURCHASE: booking hydrate → purchase 이벤트(value=totalPrice, 귀속=gaClientId) 발송 → SUCCEEDED", async () => {
    mocks.db.analyticsJob.findUniqueOrThrow.mockResolvedValue(job());
    const res = await processAnalyticsJobBatch({ limit: 10 });

    const body = mocks.sendToGa4.mock.calls[0][0];
    expect(body.client_id).toBe("123.456");
    expect(body.events[0]).toMatchObject({
      name: "purchase",
      params: { transaction_id: "clbk1", value: 2_000_000, currency: "KRW" },
    });
    expect(body.events[0].params.items).toEqual([
      expect.objectContaining({ item_id: "p1", price: 1_000_000, quantity: 2, item_variant: "adult" }),
    ]);
    expect(mocks.db.analyticsJob.update).toHaveBeenCalledWith({
      where: { id: "claj1" },
      data: { status: "SUCCEEDED", lastError: null },
    });
    expect(res).toEqual({ processed: 1, succeeded: 1, failed: 0, skipped: 0 });
  });

  it("REFUND: RefundJob.amount(동결 스냅샷)로 refund 이벤트 발송", async () => {
    mocks.db.analyticsJob.findUniqueOrThrow.mockResolvedValue(job({ type: "REFUND", refundJobId: "clrj1" }));
    mocks.db.refundJob.findUnique.mockResolvedValue({ amount: 300_000 });
    await processAnalyticsJobBatch({ limit: 10 });
    expect(mocks.sendToGa4.mock.calls[0][0].events[0]).toEqual({
      name: "refund",
      params: { transaction_id: "clbk1", value: 300_000, currency: "KRW", engagement_time_msec: 1 },
    });
  });

  it("occurredAt 이 72h 초과 → 발송 없이 SKIPPED (MP 가 거부하는 백데이트)", async () => {
    mocks.db.analyticsJob.findUniqueOrThrow.mockResolvedValue(
      job({ occurredAt: new Date(NOW - 73 * 3_600_000) }),
    );
    const res = await processAnalyticsJobBatch({ limit: 10 });
    expect(mocks.sendToGa4).not.toHaveBeenCalled();
    expect(mocks.db.analyticsJob.update).toHaveBeenCalledWith({
      where: { id: "claj1" },
      data: { status: "SKIPPED", lastError: expect.stringContaining("72h") },
    });
    expect(res.skipped).toBe(1);
  });

  it("hydration 실패(booking 삭제됨) → FAILED, 발송 없음", async () => {
    mocks.db.analyticsJob.findUniqueOrThrow.mockResolvedValue(job());
    mocks.db.booking.findUnique.mockResolvedValue(null);
    const res = await processAnalyticsJobBatch({ limit: 10 });
    expect(mocks.sendToGa4).not.toHaveBeenCalled();
    expect(mocks.db.analyticsJob.update.mock.calls[0][0].data.status).toBe("FAILED");
    expect(res.failed).toBe(1);
  });

  it("발송 실패 → attempts+1, PENDING 으로 되돌리고 백오프", async () => {
    mocks.db.analyticsJob.findUniqueOrThrow.mockResolvedValue(job());
    mocks.sendToGa4.mockRejectedValue(new Error("GA4 MP HTTP 503"));
    await processAnalyticsJobBatch({ limit: 10 });
    const data = mocks.db.analyticsJob.update.mock.calls[0][0].data;
    expect(data.status).toBe("PENDING");
    expect(data.attempts).toEqual({ increment: 1 });
    expect(data.nextRunAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("최대 시도 도달 시 FAILED 로 종결", async () => {
    mocks.db.analyticsJob.findUniqueOrThrow.mockResolvedValue(job({ attempts: 4 }));
    mocks.sendToGa4.mockRejectedValue(new Error("boom"));
    await processAnalyticsJobBatch({ limit: 10 });
    expect(mocks.db.analyticsJob.update.mock.calls[0][0].data.status).toBe("FAILED");
  });

  it("claim 실패(다른 인스턴스가 선점) → skipped, 발송 없음", async () => {
    wireClaim(0);
    const res = await processAnalyticsJobBatch({ limit: 10 });
    expect(mocks.sendToGa4).not.toHaveBeenCalled();
    expect(res).toEqual({ processed: 1, succeeded: 0, failed: 0, skipped: 1 });
  });

  it("한 건의 예외가 배치를 죽이지 않는다(per-job 격리)", async () => {
    mocks.db.analyticsJob.findMany.mockResolvedValue([{ id: "claj1" }, { id: "claj2" }]);
    mocks.db.analyticsJob.findUniqueOrThrow
      .mockRejectedValueOnce(new Error("db glitch"))
      .mockResolvedValueOnce(job({ id: "claj2" }));
    const res = await processAnalyticsJobBatch({ limit: 10 });
    expect(res).toEqual({ processed: 2, succeeded: 1, failed: 1, skipped: 0 });
  });

  it("대기 job 0건이면 즉시 반환", async () => {
    mocks.db.analyticsJob.findMany.mockResolvedValue([]);
    expect(await processAnalyticsJobBatch({ limit: 10 })).toEqual({
      processed: 0, succeeded: 0, failed: 0, skipped: 0,
    });
  });
});
