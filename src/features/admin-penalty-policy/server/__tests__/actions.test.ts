import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createPenaltyPolicyVersion: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/features/auth/server/auth", () => ({ auth: mocks.auth }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
// 부분 모킹: 실제 Zod(PenaltyTiersSchema) 는 유지하고 DB mutation 만 스텁.
vi.mock("@/entities/penalty-policy", async (orig) => ({
  ...(await orig<typeof import("@/entities/penalty-policy")>()),
  createPenaltyPolicyVersion: mocks.createPenaltyPolicyVersion,
}));

import { savePenaltyPolicyAction } from "../actions";

const validInput = {
  key: "peak_season",
  name: "성수기 정책",
  tiers: [
    { minDaysBefore: 30, rate: 0 },
    { minDaysBefore: -99999, rate: 1 }, // 100% 위약 catch-all (D4 허용)
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
  mocks.createPenaltyPolicyVersion.mockResolvedValue({
    id: "p1",
    key: "peak_season",
    version: 2,
  });
});

describe("savePenaltyPolicyAction", () => {
  it("미인증 → 거부 + mutation 미호출", async () => {
    mocks.auth.mockResolvedValue(null);
    const res = await savePenaltyPolicyAction(null, validInput);
    expect(res.type).toBe("error");
    expect(mocks.createPenaltyPolicyVersion).not.toHaveBeenCalled();
  });

  it("비관리자(USER) → 거부 + mutation 미호출", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1", role: "USER" } });
    const res = await savePenaltyPolicyAction(null, validInput);
    expect(res.type).toBe("error");
    expect(mocks.createPenaltyPolicyVersion).not.toHaveBeenCalled();
  });

  it("잘못된 tiers(rate>1) → INVALID_INPUT + mutation 미호출", async () => {
    const res = await savePenaltyPolicyAction(null, {
      ...validInput,
      tiers: [{ minDaysBefore: -99999, rate: 1.5 }],
    });
    expect(res.type).toBe("error");
    expect(mocks.createPenaltyPolicyVersion).not.toHaveBeenCalled();
  });

  it("잘못된 key(대문자/공백) → 거부 + mutation 미호출", async () => {
    const res = await savePenaltyPolicyAction(null, {
      ...validInput,
      key: "Peak Season",
    });
    expect(res.type).toBe("error");
    expect(mocks.createPenaltyPolicyVersion).not.toHaveBeenCalled();
  });

  it("정상 입력 → createPenaltyPolicyVersion(actor 포함) + revalidate + success", async () => {
    const res = await savePenaltyPolicyAction(null, validInput);
    expect(mocks.createPenaltyPolicyVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "peak_season",
        name: "성수기 정책",
        actor: "admin:admin1",
      }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/penalty-policies");
    expect(res).toMatchObject({ type: "success", key: "peak_season", version: 2 });
  });

  it("mutation 예외 → 사용자향 에러 메시지로 sanitize", async () => {
    mocks.createPenaltyPolicyVersion.mockRejectedValue(new Error("db down"));
    const res = await savePenaltyPolicyAction(null, validInput);
    expect(res.type).toBe("error");
    if (res.type === "error") expect(res.message).not.toContain("db down");
  });
});
