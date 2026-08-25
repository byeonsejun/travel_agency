import { describe, it, expect, vi, beforeEach } from "vitest";
import { encrypt } from "@/shared/lib/crypto";
import { maskPassportNo } from "@/entities/user";

const authMock = vi.fn();
const findUniqueMock = vi.fn();
const passportFindUniqueMock = vi.fn();

vi.mock("@/features/auth/server/auth", () => ({
  auth: () => authMock(),
}));

vi.mock("@/shared/lib/db", () => ({
  db: {
    user: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
    passportProfile: {
      findUnique: (...args: unknown[]) => passportFindUniqueMock(...args),
    },
  },
}));

import { getCurrentUser, getUserById, getPassportProfile } from "../queries";

const SAFE_USER = {
  id: "user_1",
  name: "테스트 고객",
  email: "customer@nextour.test",
  image: null,
  role: "CUSTOMER" as const,
};

describe("getCurrentUser", () => {
  beforeEach(() => {
    authMock.mockReset();
    findUniqueMock.mockReset();
  });

  it("returns null when session is missing", async () => {
    authMock.mockResolvedValue(null);
    const result = await getCurrentUser();
    expect(result).toBeNull();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("returns null when session has no user id", async () => {
    authMock.mockResolvedValue({ user: {} });
    const result = await getCurrentUser();
    expect(result).toBeNull();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("returns SafeUser when session is valid and user exists", async () => {
    authMock.mockResolvedValue({ user: { id: "user_1" } });
    findUniqueMock.mockResolvedValue(SAFE_USER);
    const result = await getCurrentUser();
    expect(result).toEqual(SAFE_USER);
    expect(findUniqueMock).toHaveBeenCalledWith({
      where: { id: "user_1" },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        role: true,
      },
    });
  });

  it("returns null when session exists but user row is missing", async () => {
    authMock.mockResolvedValue({ user: { id: "user_ghost" } });
    findUniqueMock.mockResolvedValue(null);
    const result = await getCurrentUser();
    expect(result).toBeNull();
  });
});

describe("getUserById", () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
  });

  it("returns null when user does not exist", async () => {
    findUniqueMock.mockResolvedValue(null);
    const result = await getUserById("missing");
    expect(result).toBeNull();
  });

  it("returns SafeUser when user exists", async () => {
    findUniqueMock.mockResolvedValue(SAFE_USER);
    const result = await getUserById("user_1");
    expect(result).toEqual(SAFE_USER);
    expect(findUniqueMock).toHaveBeenCalledWith({
      where: { id: "user_1" },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        role: true,
      },
    });
  });
});

describe("getPassportProfile", () => {
  beforeEach(() => {
    passportFindUniqueMock.mockReset();
  });

  it("returns null when passport profile does not exist", async () => {
    passportFindUniqueMock.mockResolvedValue(null);
    const result = await getPassportProfile("user_1");
    expect(result).toBeNull();
  });

  it("(a) decrypts then masks passportNo for encrypted rows", async () => {
    const encryptedNo = encrypt("M12345678");
    passportFindUniqueMock.mockResolvedValue({
      id: "pp_1",
      userId: "user_1",
      passportNo: encryptedNo,
      lastNameEn: "HONG",
      firstNameEn: "GILDONG",
      gender: "MALE",
      birthDate: new Date("1990-01-15"),
      expireDate: new Date("2030-06-30"),
      nationality: "KR",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const result = await getPassportProfile("user_1");
    expect(result).not.toBeNull();
    // 복호화 후 마스킹이 적용된 값과 동일해야 한다
    expect(result!.passportNo).toBe(maskPassportNo("M12345678"));
  });

  it("(b) legacy plaintext passportNo passes through decrypt unchanged and masks correctly", async () => {
    // enc:v1: prefix 없는 레거시 평문 행 — decrypt()가 그대로 반환 (하위 호환)
    passportFindUniqueMock.mockResolvedValue({
      id: "pp_2",
      userId: "user_2",
      passportNo: "M12345678",
      lastNameEn: "KIM",
      firstNameEn: "CHULSOO",
      gender: "MALE",
      birthDate: new Date("1985-03-20"),
      expireDate: new Date("2028-12-31"),
      nationality: "KR",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const result = await getPassportProfile("user_2");
    expect(result).not.toBeNull();
    // 레거시 평문도 동일하게 마스킹되어야 한다
    expect(result!.passportNo).toBe(maskPassportNo("M12345678"));
  });
});
