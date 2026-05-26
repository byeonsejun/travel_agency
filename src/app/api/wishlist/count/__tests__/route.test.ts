import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── vi.hoisted: vi.mock factory 실행 전 mocks 객체 확보 ─────────────
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  countMyWishlist: vi.fn(),
}));

vi.mock("@/features/auth/server/auth", () => ({ auth: mocks.auth }));
vi.mock("@/entities/wishlist", () => ({ countMyWishlist: mocks.countMyWishlist }));

import { GET } from "../route";

describe("GET /api/wishlist/count", () => {
  beforeEach(() => {
    mocks.auth.mockReset();
    mocks.countMyWishlist.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── (a) 비로그인 ─────────────────────────────────────────────────
  it("비로그인(auth → null) → 200 + {count: 0}, countMyWishlist 미호출", async () => {
    mocks.auth.mockResolvedValue(null);

    const res = await GET();
    const body = (await res.json()) as { count: number };

    expect(res.status).toBe(200);
    expect(body.count).toBe(0);
    expect(mocks.countMyWishlist).not.toHaveBeenCalled();
  });

  // ── (b) 세션은 있으나 user.id 없음 ────────────────────────────────
  it("세션 user.id 없음 → 200 + {count: 0}, countMyWishlist 미호출", async () => {
    mocks.auth.mockResolvedValue({ user: {} });

    const res = await GET();
    const body = (await res.json()) as { count: number };

    expect(res.status).toBe(200);
    expect(body.count).toBe(0);
    expect(mocks.countMyWishlist).not.toHaveBeenCalled();
  });

  // ── (c) 로그인 + 찜 N개 ──────────────────────────────────────────
  it("로그인 + 찜 7개 → 200 + {count: 7}, countMyWishlist(userId) 정확 호출", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-abc" } });
    mocks.countMyWishlist.mockResolvedValue(7);

    const res = await GET();
    const body = (await res.json()) as { count: number };

    expect(res.status).toBe(200);
    expect(body.count).toBe(7);
    expect(mocks.countMyWishlist).toHaveBeenCalledOnce();
    expect(mocks.countMyWishlist).toHaveBeenCalledWith("user-abc");
  });

  // ── (c-2) 로그인 + 찜 0개 ────────────────────────────────────────
  it("로그인 + 찜 0개 → 200 + {count: 0}", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-abc" } });
    mocks.countMyWishlist.mockResolvedValue(0);

    const res = await GET();
    const body = (await res.json()) as { count: number };

    expect(res.status).toBe(200);
    expect(body.count).toBe(0);
  });

  // ── (d-1) Cache-Control 비로그인 ─────────────────────────────────
  it("Cache-Control 헤더는 'private, no-store' (비로그인)", async () => {
    mocks.auth.mockResolvedValue(null);

    const res = await GET();

    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  // ── (d-2) Cache-Control 로그인 ───────────────────────────────────
  it("Cache-Control 헤더는 'private, no-store' (로그인)", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-abc" } });
    mocks.countMyWishlist.mockResolvedValue(3);

    const res = await GET();

    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});
