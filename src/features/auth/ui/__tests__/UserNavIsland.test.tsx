import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { Root } from "react-dom/client";

// LogoutButton 은 Server Action import 가 있어 vitest 가 그대로 로딩하면
// 'use server' 환경에서 fail-fast. 본 island 테스트에서는 LogoutButton 의
// 시각적 존재 여부만 검증하므로 가벼운 stub 으로 대체.
vi.mock("../LogoutButton", () => ({
  LogoutButton: () => <button type="button">로그아웃</button>,
}));

import { UserNavIsland } from "../UserNavIsland";

describe("<UserNavIsland />", () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root!.unmount();
      });
    }
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // fetch mock: URL 별 응답 분기
  function makeFetch(opts: {
    session?: unknown;
    count?: number;
    countOk?: boolean;
  }) {
    return vi.fn((url: string) => {
      if (url === "/api/auth/session") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(opts.session ?? null),
        });
      }
      if (url === "/api/wishlist/count") {
        return Promise.resolve({
          ok: opts.countOk ?? true,
          json: () => Promise.resolve({ count: opts.count ?? 0 }),
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });
  }

  // ── (a) mount 시 2 endpoint 병렬 fetch ─────────────────────────────
  it("(a) mount 시 /api/auth/session + /api/wishlist/count 를 각 1회 호출", async () => {
    const fetchMock = makeFetch({ session: null, count: 0 });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root = createRoot(container);
      root.render(<UserNavIsland />);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/session",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/wishlist/count",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  // ── (b) 비로그인 → "로그인" 링크 ──────────────────────────────────
  it("(b) 비로그인(session: null) → '로그인' 링크 렌더", async () => {
    vi.stubGlobal("fetch", makeFetch({ session: null, count: 0 }));

    await act(async () => {
      root = createRoot(container);
      root.render(<UserNavIsland />);
    });

    const loginLink = container.querySelector('a[href="/login"]');
    expect(loginLink).not.toBeNull();
    expect(loginLink?.textContent).toContain("로그인");
  });

  // ── (c) 로그인 + count > 0 → 사용자명·마이페이지·뱃지·로그아웃 ─────
  it("(c) 로그인(user 있음) + count 7 → 사용자명/마이페이지/뱃지/로그아웃 렌더", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetch({
        session: { user: { id: "u1", name: "Hong", email: "h@e.com" } },
        count: 7,
      }),
    );

    await act(async () => {
      root = createRoot(container);
      root.render(<UserNavIsland />);
    });

    expect(container.textContent).toContain("Hong");
    const myPage = container.querySelector('a[href="/mypage"]');
    expect(myPage).not.toBeNull();
    expect(myPage?.textContent).toContain("7");
    expect(container.textContent).toContain("로그아웃");
  });

  // ── (d) 로그인 + count === 0 → 뱃지 미표시 ────────────────────────
  it("(d) 로그인 + count 0 → 뱃지 미표시 (aria-label '찜한 상품' 부재)", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetch({
        session: { user: { id: "u1", name: "Hong", email: "h@e.com" } },
        count: 0,
      }),
    );

    await act(async () => {
      root = createRoot(container);
      root.render(<UserNavIsland />);
    });

    const badge = container.querySelector('[aria-label^="찜한 상품"]');
    expect(badge).toBeNull();
  });

  // ── (e) unmount 시 단일 AbortController.abort() 호출 ─────────────
  it("(e) unmount 시 단일 AbortController.abort() 호출 → 2 fetch 모두 취소", async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, "abort");
    // pending 영구
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

    await act(async () => {
      root = createRoot(container);
      root.render(<UserNavIsland />);
    });

    expect(abortSpy).not.toHaveBeenCalled();

    await act(async () => {
      root!.unmount();
    });
    root = null;

    // 단일 AbortController 가 2 fetch 를 묶었으므로 abort() 는 정확히 1회
    expect(abortSpy).toHaveBeenCalledOnce();
  });

  // ── (f) 초기 로딩 skeleton dimensions (CLS 0 보장) ────────────────
  it("(f) mount 직후 skeleton 마크업 존재 (aria-hidden 컨테이너)", async () => {
    // fetch 영구 pending 으로 skeleton 단계 고정
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

    await act(async () => {
      root = createRoot(container);
      root.render(<UserNavIsland />);
    });

    const skeleton = container.querySelector('[aria-hidden="true"]');
    expect(skeleton).not.toBeNull();
    // dimensions class 검증 — 비로그인 버튼 폭과 동일
    expect(skeleton?.className).toMatch(/\bh-7\b/);
  });
});
