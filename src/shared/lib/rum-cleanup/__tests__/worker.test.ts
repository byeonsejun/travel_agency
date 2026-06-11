import { describe, it, expect, vi, beforeEach } from "vitest";

const deleteManyMock = vi.fn();
vi.mock("@/shared/lib/db", () => ({ db: { webVitalEvent: { deleteMany: (...a: unknown[]) => deleteManyMock(...a) } } }));

describe("rum-cleanup worker", () => {
  beforeEach(() => deleteManyMock.mockReset());

  it("30일 초과 이벤트를 삭제하고 삭제 건수를 반환", async () => {
    deleteManyMock.mockResolvedValue({ count: 7 });
    const { processRumCleanup } = await import("../worker");
    const res = await processRumCleanup();
    expect(res).toEqual({ deleted: 7 });
    const arg = deleteManyMock.mock.calls[0][0];
    expect(arg.where.createdAt.lt).toBeInstanceOf(Date);
    // 경계가 대략 30일 전인지(±1일) 확인
    const cutoff = arg.where.createdAt.lt.getTime();
    const expected = Date.now() - 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoff - expected)).toBeLessThan(24 * 60 * 60 * 1000);
  });

  it("삭제 대상 0건이어도 정상(멱등)", async () => {
    deleteManyMock.mockResolvedValue({ count: 0 });
    const { processRumCleanup } = await import("../worker");
    const res = await processRumCleanup();
    expect(res).toEqual({ deleted: 0 });
  });
});
