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

  // ── (g) wishlist-changed 이벤트 → /api/wishlist/count 재호출 → 뱃지 갱신 ─
  it("(g) wishlist-changed 이벤트 발행 시 count 재호출 후 뱃지 숫자 갱신 (3 → 7)", async () => {
    // 첫 fetch: count=3, 두 번째 fetch (재호출): count=7
    const countSeq = [3, 7];
    let countIdx = 0;
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/auth/session") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ user: { id: "u1", name: "Hong", email: "h@e.com" } }),
        });
      }
      if (url === "/api/wishlist/count") {
        const count = countSeq[countIdx++] ?? 0;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ count }),
        });
      }
      return Promise.reject(new Error(`unexpected: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root = createRoot(container);
      root.render(<UserNavIsland />);
    });

    // 초기 fetch 후 뱃지 = 3
    const badge1 = container.querySelector('[aria-label^="찜한 상품"]');
    expect(badge1?.textContent).toBe("3");

    // 이벤트 발행 → count 재호출 (idx 1, count=7)
    await act(async () => {
      window.dispatchEvent(new CustomEvent("wishlist-changed"));
    });
    // 비동기 fetch + setState 정착을 위해 마이크로태스크 한 사이클 더
    await act(async () => {
      await Promise.resolve();
    });

    // /api/wishlist/count 호출이 mount(1) + 이벤트(1) = 2회
    const countCalls = fetchMock.mock.calls.filter(
      (c) => c[0] === "/api/wishlist/count",
    );
    expect(countCalls.length).toBe(2);

    const badge2 = container.querySelector('[aria-label^="찜한 상품"]');
    expect(badge2?.textContent).toBe("7");
  });

  // ── (i) ADMIN role → '관리자' 링크(/admin/dashboard) 노출 ───────────
  it("(i) role ADMIN → '관리자' 링크(/admin/dashboard) 렌더", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetch({
        session: {
          user: { id: "a1", name: "관리자", email: "a@e.com", role: "ADMIN" },
        },
        count: 0,
      }),
    );

    await act(async () => {
      root = createRoot(container);
      root.render(<UserNavIsland />);
    });

    const adminLink = container.querySelector('a[href="/admin/dashboard"]');
    expect(adminLink).not.toBeNull();
    expect(adminLink?.textContent).toContain("관리자");
  });

  // ── (j) 비-ADMIN(CUSTOMER) → '관리자' 링크 미노출 ──────────────────
  it("(j) role CUSTOMER → '관리자' 링크 미렌더", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetch({
        session: {
          user: { id: "u1", name: "Hong", email: "h@e.com", role: "CUSTOMER" },
        },
        count: 0,
      }),
    );

    await act(async () => {
      root = createRoot(container);
      root.render(<UserNavIsland />);
    });

    const adminLink = container.querySelector('a[href="/admin/dashboard"]');
    expect(adminLink).toBeNull();
  });

  // ── (h) unmount 후 wishlist-changed 이벤트는 무시 (listener cleanup) ─
  it("(h) unmount 후 wishlist-changed 이벤트는 fetch 재호출하지 않음", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/auth/session") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ user: { id: "u1", name: "H" } }),
        });
      }
      if (url === "/api/wishlist/count") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ count: 0 }),
        });
      }
      return Promise.reject(new Error(`unexpected: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root = createRoot(container);
      root.render(<UserNavIsland />);
    });

    // mount 후 호출 횟수
    const before = fetchMock.mock.calls.filter(
      (c) => c[0] === "/api/wishlist/count",
    ).length;

    await act(async () => {
      root!.unmount();
    });
    root = null;

    // unmount 후 이벤트 발행 → fetch 추가 호출 없음
    window.dispatchEvent(new CustomEvent("wishlist-changed"));
    await Promise.resolve();

    const after = fetchMock.mock.calls.filter(
      (c) => c[0] === "/api/wishlist/count",
    ).length;
    expect(after).toBe(before);
  });
});
