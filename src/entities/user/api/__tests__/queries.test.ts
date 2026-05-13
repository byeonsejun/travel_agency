import { describe, it, expect, vi, beforeEach } from "vitest";

const authMock = vi.fn();
const findUniqueMock = vi.fn();

vi.mock("@/features/auth/server/auth", () => ({
  auth: () => authMock(),
}));

vi.mock("@/shared/lib/db", () => ({
  db: {
    user: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
  },
}));

import { getCurrentUser, getUserById } from "../queries";

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
