"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleWishlistAction } from "../server/actions";
import { LOGIN_PROMPT_MESSAGE, buildResumeCallbackUrl } from "../lib/loginPrompt";
import { dispatchWishlistChanged } from "@/entities/wishlist";

type Size = "sm" | "md";

type Props = {
  productId: string;
  inWishlist: boolean;
  loggedIn: boolean;
  returnTo: string;
  size?: Size;
  className?: string;
};

const SIZE_CLASS: Record<Size, { btn: string; svg: string }> = {
  sm: { btn: "h-8 w-8", svg: "h-4 w-4" },
  md: { btn: "h-10 w-10", svg: "h-5 w-5" },
};

// SSR 주입형 하트 버튼. `inWishlist` · `loggedIn` 을 페이지 RSC 가 prop 으로 내려준다.
// 비로그인 클릭 흐름은 PDP `WishlistHeartIsland` 와 동일하게 confirm 인터셉트 →
// /login?callbackUrl=<resume URL> 로 navigation. Server Action 은 호출하지 않는다.
//
// 상태 모델: `useOptimistic` 대신 `useState` + prop sync (렌더 중 조건부 setState).
// 이유 — `useOptimistic` 은 transition 종료 시 base prop 으로 즉시 복귀하지만
// dynamic 페이지(`/products?…`)에서는 `revalidatePath` 가 의미 없고, 프로그램적
// Server Action 호출은 자동 `router.refresh()` 를 트리거하지 않아 base prop 이
// 변하지 않는다. → 클릭→optimistic→복귀(stale)→영원히 stale 의 깜빡임 발생.
// manual useState 는 "revert by default" 가 아닌 "stay until prop changes" 이므로
// 구조적으로 깜빡임이 불가능.
//
// 사이드 이펙트: 토글 완료 후 `dispatchWishlistChanged()` 로 헤더의
// `UserNavIsland` count 뱃지에 알림. router.refresh() 도 호출해 같은 페이지의
// 다른 하트 (e.g. /products 목록의 wishlistIds) 가 동기화되게 함.
export function WishlistHeartButton({
  productId,
  inWishlist,
  loggedIn,
  returnTo,
  size = "sm",
  className = "",
}: Props) {
  const [displayed, setDisplayed] = useState(inWishlist);
  const [prevInWishlist, setPrevInWishlist] = useState(inWishlist);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // 부모 RSC 가 새 inWishlist prop 을 내려주면 동기화. React 공식 "prop 변화 시
  // state 조정" 패턴(렌더 중 조건부 setState) — effect 불필요. 사용자 클릭으로
  // setDisplayed 한 직후 prop 이 같으면 prev===next 라 no-op.
  if (prevInWishlist !== inWishlist) {
    setPrevInWishlist(inWishlist);
    setDisplayed(inWishlist);
  }

  const sz = SIZE_CLASS[size];
  const active = displayed;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!loggedIn) {
          const ok = window.confirm(LOGIN_PROMPT_MESSAGE);
          if (!ok) return;
          const resumeUrl = buildResumeCallbackUrl(productId, returnTo);
          router.push(`/login?callbackUrl=${encodeURIComponent(resumeUrl)}`);
          return;
        }
        const formData = new FormData(e.currentTarget);
        const next = !displayed;
        setDisplayed(next);
        startTransition(async () => {
          await toggleWishlistAction(formData);
          router.refresh();
          dispatchWishlistChanged();
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
