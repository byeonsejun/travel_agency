import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { Root } from "react-dom/client";

import { SessionPoll } from "../SessionPoll";

/**
 * 원래 탭(매직링크 요청 탭)의 헤더 로그인 반영 회귀 테스트.
 *
 * 버그: 세션 감지 후 router.replace + router.refresh 로 SPA 이동하면, 헤더의
 * UserNavIsland(mount 시 1회만 세션 fetch 하는 client island)가 재mount 되지
 * 않아 헤더가 로그아웃 상태로 고착됐다. 전체 페이지 이동(window.location.assign)
 * 으로 island 를 재mount 시켜 로그인 헤더가 반영되게 한다.
 */
describe("<SessionPoll />", () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let assignMock: ReturnType<typeof vi.fn>;
  let originalLocation: Location;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
    vi.useFakeTimers();
    assignMock = vi.fn();
    originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { assign: assignMock, href: "http://localhost/" },
    });
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root!.unmount();
      });
    }
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("세션 감지 시 callbackUrl 로 하드 내비게이션(window.location.assign)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ user: { id: "user_1" } }),
      })),
    );

    await act(async () => {
      root = createRoot(container);
      root.render(<SessionPoll callbackUrl="/mypage" email="a@b.com" />);
    });

    // 첫 폴링 주기(2500ms) 경과 → fetch 해소 → assign 호출.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });

    expect(assignMock).toHaveBeenCalledWith("/mypage");
  });

  it("email 이 없으면 폴링하지 않는다(직접 진입 안전장치)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root = createRoot(container);
      root.render(<SessionPoll callbackUrl="/" />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(assignMock).not.toHaveBeenCalled();
  });
});
