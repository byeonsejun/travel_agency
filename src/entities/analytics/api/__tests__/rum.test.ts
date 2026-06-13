import { describe, it, expect, vi, beforeEach } from "vitest";

const queryRawMock = vi.fn();
vi.mock("@/shared/lib/db", () => ({ db: { $queryRaw: (...a: unknown[]) => queryRawMock(...a) } }));
// next/cache(cacheTag/cacheLife/unstable_cache)는 vitest.setup.ts의 전역 모킹이 no-op
// 처리한다([ADR-0053]). use cache 전환 후 cacheTag/cacheLife 호출도 전역 모킹이 흡수.

describe("RUM read-model 매핑", () => {
  beforeEach(() => queryRawMock.mockReset());

  it("getWebVitalSummary: bigint count → number, p75 변환", async () => {
    queryRawMock.mockResolvedValue([{ metric: "LCP", p75: 2300, count: 42n }]);
    const { getWebVitalSummary } = await import("../rum");
    const res = await getWebVitalSummary();
    expect(res).toEqual([{ metric: "LCP", p75: 2300, sampleCount: 42 }]);
  });

  it("getWebVitalByRoute: route별 매핑", async () => {
    queryRawMock.mockResolvedValue([{ route: "/products/[id]", metric: "INP", p75: 180, count: 10n }]);
    const { getWebVitalByRoute } = await import("../rum");
    const res = await getWebVitalByRoute();
    expect(res).toEqual([{ route: "/products/[id]", metric: "INP", p75: 180, sampleCount: 10 }]);
  });

  it("getWebVitalTrend: Date day → YYYY-MM-DD 문자열", async () => {
    queryRawMock.mockResolvedValue([{ day: new Date("2026-06-10T00:00:00Z"), metric: "LCP", p75: 2100 }]);
    const { getWebVitalTrend } = await import("../rum");
    const res = await getWebVitalTrend();
    expect(res).toEqual([{ date: "2026-06-10", metric: "LCP", p75: 2100 }]);
  });
});
