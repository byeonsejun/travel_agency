import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({
  tx: { penaltyPolicy: { findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn() } },
  db: { $transaction: vi.fn() },
}));
vi.mock("@/shared/lib/db", () => ({ db: mocks.db }));
import { createPenaltyPolicyVersion } from "../mutations";

describe("createPenaltyPolicyVersion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.$transaction.mockImplementation(async (fn: (tx: typeof mocks.tx) => unknown) => fn(mocks.tx));
  });

  it("기존 활성 버전을 isActive=false로 내리고 version+1 새 행 생성", async () => {
    mocks.tx.penaltyPolicy.findFirst.mockResolvedValue({ version: 3 });
    mocks.tx.penaltyPolicy.create.mockResolvedValue({ id: "p4", key: "k", version: 4 });
    const r = await createPenaltyPolicyVersion({
      key: "k", name: "n", tiers: [{ minDaysBefore: -99999, rate: 0.5 }], actor: "admin:a",
    });
    expect(mocks.tx.penaltyPolicy.updateMany).toHaveBeenCalledWith({
      where: { key: "k", isActive: true }, data: { isActive: false },
    });
    expect(mocks.tx.penaltyPolicy.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ key: "k", version: 4, isActive: true }),
    }));
    expect(r.version).toBe(4);
  });

  it("기존 버전 없으면 version 1로 생성", async () => {
    mocks.tx.penaltyPolicy.findFirst.mockResolvedValue(null);
    mocks.tx.penaltyPolicy.create.mockResolvedValue({ id: "p1", key: "k", version: 1 });
    await createPenaltyPolicyVersion({ key: "k", name: "n", tiers: [{ minDaysBefore: -99999, rate: 0.5 }], actor: "admin:a" });
    expect(mocks.tx.penaltyPolicy.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ version: 1 }),
    }));
  });
});
