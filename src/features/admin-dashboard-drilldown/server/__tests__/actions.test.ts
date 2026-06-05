import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/features/auth/server/auth", () => ({ auth: vi.fn() }));
vi.mock("@/entities/analytics", () => ({
  parseRange: (k: string) => ({ from: new Date(0), to: new Date(), key: k, bucket: "day" }),
  getRevenueRows: vi.fn(async () => ({ rows: [], total: 0, capped: false })),
  getPenaltyRows: vi.fn(async () => ({ rows: [], total: 0, capped: false })),
  getCancellationRows: vi.fn(async () => ({ rows: [], total: 0, capped: false })),
  getOccupancyRows: vi.fn(async () => ({ rows: [], total: 0, capped: false })),
}));

import { auth } from "@/features/auth/server/auth";
import { DrilldownInputSchema, loadDrilldownAction } from "../actions";

const asAdmin = () => (auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });

beforeEach(() => vi.clearAllMocks());

describe("DrilldownInputSchema", () => {
  it("알 수 없는 metric 거부", () => {
    expect(DrilldownInputSchema.safeParse({ metric: "xxx", range: "30d" }).success).toBe(false);
  });
  it("알 수 없는 range 거부", () => {
    expect(DrilldownInputSchema.safeParse({ metric: "revenue", range: "1y" }).success).toBe(false);
  });
  it("정상 입력 허용", () => {
    expect(DrilldownInputSchema.safeParse({ metric: "revenue", range: "30d" }).success).toBe(true);
  });
});

describe("loadDrilldownAction", () => {
  it("비-admin 은 거부", async () => {
    (auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1", role: "USER" } });
    const res = await loadDrilldownAction({ metric: "revenue", range: "30d" });
    expect(res.type).toBe("error");
  });
  it("admin 정상 호출 시 metric 태깅 결과 반환", async () => {
    asAdmin();
    const res = await loadDrilldownAction({ metric: "revenue", range: "30d" });
    expect(res.type).toBe("success");
    if (res.type === "success") expect(res.data.metric).toBe("revenue");
  });
});
