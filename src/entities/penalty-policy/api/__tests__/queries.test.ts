import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({
  db: { penaltyPolicy: { findFirst: vi.fn(), findMany: vi.fn() } },
}));
vi.mock("@/shared/lib/db", () => ({ db: mocks.db }));
import { getActivePenaltyTiers, getTiersBySnapshot } from "../queries";

beforeEach(() => vi.clearAllMocks());

describe("getActivePenaltyTiers", () => {
  it("활성 버전 tiers 반환", async () => {
    mocks.db.penaltyPolicy.findFirst.mockResolvedValue({
      version: 2, tiers: [{ minDaysBefore: -99999, rate: 0.5 }],
    });
    const r = await getActivePenaltyTiers("standard_overseas");
    expect(r).toEqual({ version: 2, tiers: [{ minDaysBefore: -99999, rate: 0.5 }] });
  });
  it("없으면 시스템 기본 상수(version 0)", async () => {
    mocks.db.penaltyPolicy.findFirst.mockResolvedValue(null);
    const r = await getActivePenaltyTiers("missing");
    expect(r.version).toBe(0);
    expect(r.tiers.length).toBeGreaterThan(0);
  });
});

describe("getTiersBySnapshot", () => {
  it("snapshot version의 tiers 반환", async () => {
    mocks.db.penaltyPolicy.findFirst.mockResolvedValue({ tiers: [{ minDaysBefore: -99999, rate: 0.3 }] });
    const r = await getTiersBySnapshot("k", 1);
    expect(r[0].rate).toBe(0.3);
  });
  it("snapshot 없음(legacy null) → 시스템 기본 상수", async () => {
    const r = await getTiersBySnapshot(null, null);
    expect(r.length).toBeGreaterThan(0);
  });
});
