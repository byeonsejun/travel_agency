"use client";

import { useEffect, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleWishlistAction } from "../server/actions";

type Size = "sm" | "md";

type Props = {
  productId: string;
  returnTo: string;
  size?: Size;
  className?: string;
};

const SIZE_CLASS: Record<Size, { btn: string; svg: string }> = {
  sm: { btn: "h-8 w-8", svg: "h-4 w-4" },
  md: { btn: "h-10 w-10", svg: "h-5 w-5" },
};

const LOGIN_PROMPT_MESSAGE =
  "로그인 후 이용하실 수 있습니다.\n로그인하시겠습니까?";

// PDP 전용 island. 부모 RSC(PDP)가 auth()/isInWishlist() 호출을 안 해도 되도록
// mount 후 GET /api/wishlist/check 로 자기 상태(inWishlist + loggedIn) 를
// 자체 결정. PDP ISR 활성 (A6).
//
// 비로그인 클릭 흐름:
//   1. window.confirm 안내 → 사용자 동의
//   2. 동의 시 /login?callbackUrl=/api/wishlist/resume?... 로 navigation
//   3. 취소 시 아무 동작 없음 (이전엔 Server Action 이 무조건 redirect 했음)
export function WishlistHeartIsland({
  productId,
  returnTo,
  size = "sm",
  className = "",
}: Props) {
  const [inWishlist, setInWishlist] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [optimistic, applyOptimistic] = useOptimistic<boolean, boolean>(
    inWishlist,
    (_, next) => next,
  );
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/wishlist/check?productId=${encodeURIComponent(productId)}`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
      .then((d: { inWishlist: boolean; loggedIn: boolean }) => {
        setInWishlist(d.inWishlist);
        setLoggedIn(d.loggedIn);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        // 조용히 실패 — outline 유지, 토글 클릭은 Server Action 이 권위
      });
    return () => controller.abort();
  }, [productId]);

  const sz = SIZE_CLASS[size];
  const active = optimistic;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!loggedIn) {
          // 비로그인: confirm 후 분기. server action 호출하지 않음.
          const ok = window.confirm(LOGIN_PROMPT_MESSAGE);
          if (!ok) return;
          const resumeUrl = `/api/wishlist/resume?productId=${encodeURIComponent(productId)}&returnTo=${encodeURIComponent(returnTo)}`;
          router.push(`/login?callbackUrl=${encodeURIComponent(resumeUrl)}`);
          return;
        }
        const formData = new FormData(e.currentTarget);
        startTransition(() => {
          applyOptimistic(!active);
          void toggleWishlistAction(formData);
        });
      }}
      className={className}
    >
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <button
        type="submit"
        disabled={isPending}
        aria-pressed={active}
        aria-label={active ? "찜 해제" : "찜하기"}
        className={[
          "flex items-center justify-center rounded-full",
          "bg-white/90 shadow-sm ring-1 ring-black/5 backdrop-blur",
          "transition hover:bg-white",
          "disabled:opacity-60",
          sz.btn,
        ].join(" ")}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill={active ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth={active ? 0 : 1.8}
          className={[
            sz.svg,
            active ? "text-rose-500" : "text-gray-500",
            "transition-colors",
          ].join(" ")}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 21s-7.5-4.35-9.5-9.5C1.4 8.5 3.5 5 6.8 5c1.9 0 3.4 1 4.2 2.2C11.8 6 13.3 5 15.2 5 18.5 5 20.6 8.5 21.5 11.5 19.5 16.65 12 21 12 21z"
          />
        </svg>
      </button>
    </form>
  );
}
