"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleWishlistAction } from "../server/actions";
import { LOGIN_PROMPT_MESSAGE, buildResumeCallbackUrl } from "../lib/loginPrompt";

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
// (Server Action 자체도 비로그인 시 redirect 하는 안전망을 그대로 유지.)
export function WishlistHeartButton({
  productId,
  inWishlist,
  loggedIn,
  returnTo,
  size = "sm",
  className = "",
}: Props) {
  const [optimistic, applyOptimistic] = useOptimistic<boolean, boolean>(
    inWishlist,
    (_, next) => next,
  );
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const sz = SIZE_CLASS[size];
  const active = optimistic;

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
