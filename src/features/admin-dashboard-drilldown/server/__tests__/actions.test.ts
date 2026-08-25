import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/features/auth/server/auth", () => ({ auth: vi.fn() }));
vi.mock("@/entities/analytics", () => ({
  // parseFilter 는 입력을 그대로 통과시키는 가짜(서버 재도출 경로만 검증).
  parseFilter: (i: Record<string, unknown>) => ({
    from: new Date(0),
    to: new Date(),
    bucket: "day",
    productId: (i.productId as string) ?? null,
    cacheKey: { startDay: "2026-05-01", endDay: "2026-05-31", product: "all" },
  }),
  getRevenueRows: vi.fn(async () => ({ rows: [], total: 0, capped: false })),
  getPenaltyRows: vi.fn(async () => ({ rows: [], total: 0, capped: false })),
  getCancellationRows: vi.fn(async () => ({ rows: [], total: 0, capped: false })),
  getOccupancyRows: vi.fn(async () => ({ rows: [], total: 0, capped: false })),
}));

import { auth } from "@/features/auth/server";
import { loadDrilldownAction } from "../actions";
import { DrilldownInputSchema } from "../schema";

const asAdmin = () => (auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });

beforeEach(() => vi.clearAllMocks());

describe("DrilldownInputSchema", () => {
  it("알 수 없는 metric 거부", () => {
    expect(DrilldownInputSchema.safeParse({ metric: "xxx", start: "2026-05-01" }).success).toBe(false);
  });
  it("metric 만 있어도 허용 (start/end/productId 는 optional)", () => {
    expect(DrilldownInputSchema.safeParse({ metric: "revenue" }).success).toBe(true);
  });
  it("정상 필터 입력 허용", () => {
    expect(
      DrilldownInputSchema.safeParse({
        metric: "revenue",
        start: "2026-05-01",
        end: "2026-05-31",
        productId: "p1",
      }).success,
    ).toBe(true);
  });
});

describe("loadDrilldownAction", () => {
  it("비-admin 은 거부", async () => {
    (auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1", role: "USER" } });
    const res = await loadDrilldownAction({ metric: "revenue", start: "2026-05-01", end: "2026-05-31" });
    expect(res.type).toBe("error");
  });
  it("admin 정상 호출 시 metric 태깅 결과 반환", async () => {
    asAdmin();
    const res = await loadDrilldownAction({ metric: "revenue", start: "2026-05-01", end: "2026-05-31" });
    expect(res.type).toBe("success");
    if (res.type === "success") expect(res.data.metric).toBe("revenue");
  });
});
