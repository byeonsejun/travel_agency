"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { subscribeWishlistChanged } from "@/entities/wishlist";
import { LogoutButton } from "./LogoutButton";

type SessionUser = {
  id?: string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
};

type SessionResponse = { user?: SessionUser } | null;

type State =
  | { phase: "loading" }
  | { phase: "ready"; user: SessionUser | null; wishlistCount: number };

// layout cookies 의존을 0 으로 만들기 위해 UserNav 의 auth() + countMyWishlist
// 호출을 client island 로 옮긴 컴포넌트. mount 후 /api/auth/session +
// /api/wishlist/count 를 단일 AbortController + Promise.all 로 묶어 fetch.
// 결과: 부모 layout 이 cookies 의존 0 → 자식 페이지 (/products/[id] 등) 가
// ISR `●` 표기로 승격 (ADR-0018).
//
// 헤더 카운트 뱃지 라이브 동기화: WishlistHeartButton/Island 가 토글 완료 후
// dispatchWishlistChanged() 로 알리면, 본 island 가 listener 에서
// /api/wishlist/count 만 재호출해 뱃지를 갱신. (layout 은 re-render 되지 않
// 으므로 RSC refresh 로는 해결 불가.)
//
// CLS: skeleton 은 비로그인 "로그인" 버튼 dimensions (h-7 w-20 ≈ 28×80px) 와
// 동일. 로그인 사용자만 hydration 후 width 확장 1회 발생 — ADR-0012/0017
// island 깜빡임 정책과 동질의 본질 비용.
export function UserNavIsland() {
  const [state, setState] = useState<State>({ phase: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    Promise.all([
      fetch("/api/auth/session", { signal }).then(
        (r) => r.json() as Promise<SessionResponse>,
      ),
      fetch("/api/wishlist/count", { signal })
        .then((r) =>
          r.ok ? (r.json() as Promise<{ count: number }>) : { count: 0 },
        )
        .catch(() => ({ count: 0 })),
    ])
      .then(([session, countRes]) => {
        if (signal.aborted) return;
        const user = session?.user?.id ? session.user : null;
        setState({ phase: "ready", user, wishlistCount: countRes.count });
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        // 조용히 실패 — 안전 디폴트 (비로그인 표시).
        setState({ phase: "ready", user: null, wishlistCount: 0 });
      });

    return () => controller.abort();
  }, []);

  // 위시리스트 토글 알림 → count 만 재호출 (session 은 변하지 않음).
  // loading 상태에서 들어온 알림은 무시 — 초기 fetch 가 곧 count 를 세팅.
  useEffect(() => {
    return subscribeWishlistChanged(() => {
      void (async () => {
        try {
          const res = await fetch("/api/wishlist/count");
          if (!res.ok) return;
          const data = (await res.json()) as { count: number };
          setState((prev) =>
            prev.phase === "ready"
              ? { ...prev, wishlistCount: data.count }
              : prev,
          );
        } catch {
          // 조용히 실패 — 다음 토글에 다시 시도
        }
      })();
    });
  }, []);

  if (state.phase === "loading") {
    // skeleton: 비로그인 버튼과 동일 dimensions 로 CLS 0 (다수 트래픽 우선).
    return (
      <div
        aria-hidden="true"
        className="h-7 w-20 animate-pulse rounded-md bg-gray-100"
      />
    );
  }

  if (state.user === null) {
    return (
      <Link
        href="/login"
        className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
      >
        로그인
      </Link>
    );
  }

  const { user, wishlistCount } = state;

  return (
    <>
      <span className="text-sm text-gray-600">{user.name ?? user.email}</span>
      {user.role === "ADMIN" && (
        <Link
          href="/admin/dashboard"
          className="rounded-md bg-red-50 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-100 transition-colors"
        >
          관리자
        </Link>
      )}
      <Link
        href="/mypage"
        className="relative rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900 transition-colors"
      >
        마이페이지
        {wishlistCount > 0 && (
          <span
            aria-label={`찜한 상품 ${wishlistCount}개`}
            className="ml-1.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-semibold leading-none text-white"
          >
            {wishlistCount > 99 ? "99+" : wishlistCount}
          </span>
        )}
      </Link>
      <LogoutButton />
    </>
  );
}
