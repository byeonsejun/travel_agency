/**
 * observability.test.ts — PaymentEvent·RefundJob 관측 쿼리 단위 테스트 (M-OBS Task 11)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    paymentEvent: { findMany: vi.fn() },
    refundJob: { groupBy: vi.fn(), findFirst: vi.fn() },
  },
}));

vi.mock("@/shared/lib/db", () => ({ db: mocks.db }));

import { listRecentPaymentEvents, summarizeRefundJobs } from "../observability";

describe("listRecentPaymentEvents", () => {
  beforeEach(() => {
    mocks.db.paymentEvent.findMany.mockReset();
    mocks.db.paymentEvent.findMany.mockResolvedValue([]);
  });

  it("기본 옵션 → limit=50, orderBy:createdAt desc", async () => {
    await listRecentPaymentEvents();
    expect(mocks.db.paymentEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 50,
        orderBy: { createdAt: "desc" },
      })
    );
  });

  it("limit 오버라이드 → take에 반영", async () => {
    await listRecentPaymentEvents({ limit: 10 });
    expect(mocks.db.paymentEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10 })
    );
  });

  it("type 필터 → where.type 포함", async () => {
    await listRecentPaymentEvents({ type: "CONFIRM_REQUEST" });
    expect(mocks.db.paymentEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ type: "CONFIRM_REQUEST" }),
      })
    );
  });

  it("since 필터 → where.createdAt.gte 포함", async () => {
    const since = new Date("2026-05-01T00:00:00Z");
    await listRecentPaymentEvents({ since });
    expect(mocks.db.paymentEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ createdAt: { gte: since } }),
      })
    );
  });

  it("select에 payload 포함 — raw JSON 보존 확인", async () => {
    await listRecentPaymentEvents();
    const call = mocks.db.paymentEvent.findMany.mock.calls[0][0] as { select: Record<string, boolean> };
    expect(call.select).toMatchObject({
      id: true,
      type: true,
      payload: true,
      result: true,
      createdAt: true,
    });
  });

  it("DB 결과를 그대로 반환", async () => {
    const rows = [
      { id: "evt_1", type: "CONFIRM_REQUEST", result: "PROCESSED", createdAt: new Date() },
    ];
    mocks.db.paymentEvent.findMany.mockResolvedValue(rows);
    const result = await listRecentPaymentEvents({ limit: 1 });
    expect(result).toEqual(rows);
  });
});

describe("summarizeRefundJobs", () => {
  beforeEach(() => {
    mocks.db.refundJob.groupBy.mockReset();
    mocks.db.refundJob.findFirst.mockReset();
  });

  it("groupBy + findFirst를 병렬 실행하여 statusCounts 반환", async () => {
    mocks.db.refundJob.groupBy.mockResolvedValue([
      { status: "PENDING", _count: { id: 2 } },
      { status: "SUCCEEDED", _count: { id: 5 } },
      { status: "FAILED", _count: { id: 1 } },
    ]);
    mocks.db.refundJob.findFirst.mockResolvedValue(null);

    const result = await summarizeRefundJobs();

    expect(result.statusCounts).toEqual({ PENDING: 2, SUCCEEDED: 5, FAILED: 1 });
  });

  it("oldestPending → status:PENDING + nextRunAt asc 정렬로 findFirst 호출", async () => {
    mocks.db.refundJob.groupBy.mockResolvedValue([]);
    const pending = {
      id: "rjob_1",
      bookingId: "book_1",
      amount: 180_000,
      nextRunAt: new Date("2026-05-15T10:00:00Z"),
      attempts: 1,
    };
    mocks.db.refundJob.findFirst.mockResolvedValue(pending);

    const result = await summarizeRefundJobs();

    expect(mocks.db.refundJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "PENDING" },
        orderBy: { nextRunAt: "asc" },
      })
    );
    expect(result.oldestPending).toEqual(pending);
  });

  it("PENDING job 없으면 oldestPending: null 반환", async () => {
    mocks.db.refundJob.groupBy.mockResolvedValue([]);
    mocks.db.refundJob.findFirst.mockResolvedValue(null);

    const result = await summarizeRefundJobs();
    expect(result.oldestPending).toBeNull();
  });
});
