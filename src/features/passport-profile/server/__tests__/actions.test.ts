import { describe, it, expect, vi, beforeEach } from "vitest";

const authMock = vi.fn();
const upsertMock = vi.fn();
const revalidatePathMock = vi.fn();

// withRateLimitAction을 투명 passthrough로 처리 — 액션 로직 단위 테스트에서 rate-limit 계층 분리
vi.mock("@/shared/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/lib/rate-limit")>();
  return {
    ...actual,
    withRateLimitAction: <Args extends unknown[], R>(
      _opts: unknown,
      handler: (...args: Args) => Promise<R>,
    ) => handler,
  };
});

vi.mock("@/features/auth/server/auth", () => ({ auth: () => authMock() }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePathMock(...a) }));
vi.mock("@/shared/lib/db", () => ({
  db: { passportProfile: { upsert: (...a: unknown[]) => upsertMock(...a) } },
}));

import { updatePassportProfile } from "../actions";

function makeFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const base: Record<string, string> = {
    lastNameEn: "HONG",
    firstNameEn: "GILDONG",
    gender: "MALE",
    birthDate: "1990-01-15",
    passportNo: "M12345678",
    expireDate: "2030-06-30",
    nationality: "KR",
    ...overrides,
  };
  for (const [k, v] of Object.entries(base)) fd.set(k, v);
  return fd;
}

describe("updatePassportProfile", () => {
  beforeEach(() => {
    authMock.mockReset();
    upsertMock.mockReset();
    revalidatePathMock.mockReset();
  });

  it("returns error when not authenticated", async () => {
    authMock.mockResolvedValue(null);
    const result = await updatePassportProfile(null, makeFormData());
    expect(result).toEqual({ success: false, error: "로그인이 필요합니다." });
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("returns error on Zod validation failure (bad passportNo)", async () => {
    authMock.mockResolvedValue({ user: { id: "user_1" } });
    const result = await updatePassportProfile(
      null,
      makeFormData({ passportNo: "bad" })
    );
    expect(result).toMatchObject({ success: false });
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("upserts and revalidates on valid input", async () => {
    authMock.mockResolvedValue({ user: { id: "user_1" } });
    upsertMock.mockResolvedValue({});
    const result = await updatePassportProfile(null, makeFormData());
    expect(result).toEqual({ success: true });
    expect(upsertMock).toHaveBeenCalledOnce();
    expect(revalidatePathMock).toHaveBeenCalledWith("/mypage");
  });

  it("passes userId into upsert where clause", async () => {
    authMock.mockResolvedValue({ user: { id: "user_abc" } });
    upsertMock.mockResolvedValue({});
    await updatePassportProfile(null, makeFormData());
    const call = upsertMock.mock.calls[0][0];
    expect(call.where).toEqual({ userId: "user_abc" });
    expect(call.create).toMatchObject({ userId: "user_abc", lastNameEn: "HONG" });
  });
});
