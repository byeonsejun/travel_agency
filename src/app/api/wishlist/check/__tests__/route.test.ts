import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// ── vi.hoisted: vi.mock factory 실행 전 mocks 객체 확보 ─────────────
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  isInWishlist: vi.fn(),
}));

vi.mock("@/features/auth/server/auth", () => ({ auth: mocks.auth }));
vi.mock("@/entities/wishlist", () => ({ isInWishlist: mocks.isInWishlist }));

import { GET } from "../route";

// cuid v1 형식 (c + 24자 소문자/숫자)
const VALID_CUID = "clh1234567890abcdefghijk";
const BASE_URL = "http://localhost:3000/api/wishlist/check";

describe("GET /api/wishlist/check", () => {
  beforeEach(() => {
    mocks.auth.mockReset();
    mocks.isInWishlist.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── (a) 잘못된 productId ─────────────────────────────────────────
  it("잘못된 productId → 400 + {error: 'invalid_productId'}", async () => {
    const req = new NextRequest(`${BASE_URL}?productId=not-a-cuid`);
    const res = await GET(req);
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe("invalid_productId");
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.isInWishlist).not.toHaveBeenCalled();
  });

  // ── (b) productId 누락 ────────────────────────────────────────────
  it("productId 누락 → 400 + {error: 'invalid_productId'}", async () => {
    const req = new NextRequest(BASE_URL);
    const res = await GET(req);
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe("invalid_productId");
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  // ── (c) 비로그인 ─────────────────────────────────────────────────
  it("비로그인(auth → null) → 200 + {inWishlist:false, loggedIn:false}, isInWishlist 미호출", async () => {
    mocks.auth.mockResolvedValue(null);

    const req = new NextRequest(`${BASE_URL}?productId=${VALID_CUID}`);
    const res = await GET(req);
    const body = (await res.json()) as { inWishlist: boolean; loggedIn: boolean };

    expect(res.status).toBe(200);
    expect(body.inWishlist).toBe(false);
    expect(body.loggedIn).toBe(false);
    expect(mocks.isInWishlist).not.toHaveBeenCalled();
  });

  // ── (c-2) 세션은 있지만 user.id 없는 경우도 비로그인 처리 ─────────
  it("세션 user.id 없음 → 200 + {inWishlist:false, loggedIn:false}", async () => {
    mocks.auth.mockResolvedValue({ user: {} });

    const req = new NextRequest(`${BASE_URL}?productId=${VALID_CUID}`);
    const res = await GET(req);
    const body = (await res.json()) as { inWishlist: boolean; loggedIn: boolean };

    expect(res.status).toBe(200);
    expect(body.inWishlist).toBe(false);
    expect(body.loggedIn).toBe(false);
    expect(mocks.isInWishlist).not.toHaveBeenCalled();
  });

  // ── (d) 로그인 + 찜 존재 ────────────────────────────────────────
  it("로그인 + 찜 → 200 + {inWishlist:true, loggedIn:true}, isInWishlist(userId, productId) 호출", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-abc" } });
    mocks.isInWishlist.mockResolvedValue(true);

    const req = new NextRequest(`${BASE_URL}?productId=${VALID_CUID}`);
    const res = await GET(req);
    const body = (await res.json()) as { inWishlist: boolean; loggedIn: boolean };

    expect(res.status).toBe(200);
    expect(body.inWishlist).toBe(true);
    expect(body.loggedIn).toBe(true);
    expect(mocks.isInWishlist).toHaveBeenCalledOnce();
    expect(mocks.isInWishlist).toHaveBeenCalledWith("user-abc", VALID_CUID);
  });

  // ── (d-2) 로그인 + 찜 없음 ────────────────────────────────────────
  it("로그인 + 찜 없음 → 200 + {inWishlist:false, loggedIn:true}", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-abc" } });
    mocks.isInWishlist.mockResolvedValue(false);

    const req = new NextRequest(`${BASE_URL}?productId=${VALID_CUID}`);
    const res = await GET(req);
    const body = (await res.json()) as { inWishlist: boolean; loggedIn: boolean };

    expect(res.status).toBe(200);
    expect(body.inWishlist).toBe(false);
    expect(body.loggedIn).toBe(true);
  });

  // ── 응답 헤더: private, no-store ─────────────────────────────────
  it("Cache-Control 헤더는 'private, no-store'", async () => {
    mocks.auth.mockResolvedValue(null);

    const req = new NextRequest(`${BASE_URL}?productId=${VALID_CUID}`);
    const res = await GET(req);

    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  // ── 로그인 상태에서도 Cache-Control 동일 ──────────────────────────
  it("로그인 상태에서도 Cache-Control: private, no-store", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-abc" } });
    mocks.isInWishlist.mockResolvedValue(true);

    const req = new NextRequest(`${BASE_URL}?productId=${VALID_CUID}`);
    const res = await GET(req);

    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});
