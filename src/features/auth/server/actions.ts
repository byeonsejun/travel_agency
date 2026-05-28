"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn, signOut } from "./auth";
import { withRateLimitAction } from "@/shared/lib/rate-limit";

type OAuthProvider = "kakao" | "google";

/**
 * callbackUrl open-redirect 가드 — 외부 도메인이나 protocol-relative URL은 폴백.
 * NextAuth `redirectTo` 는 같은 host로의 path만 허용하지만,
 * 더 앞 단계에서 명시적으로 차단해 두는 편이 안전.
 */
function safeCallback(raw: string | null | undefined): string {
  if (!raw) return "/";
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//")) return "/"; // protocol-relative 차단
  return raw;
}

/**
 * 소셜 로그인 Server Action 구현체 — Kakao/Google 공통.
 * `<form action={signInWithProvider}>` 패턴에서 hidden input 으로 provider 및
 * callbackUrl 을 전달받는다. AuthError는 `/login?error=...` 로 리다이렉트.
 */
async function signInWithProviderImpl(formData: FormData): Promise<void> {
  const provider = formData.get("provider");
  const callbackUrl = safeCallback(
    typeof formData.get("callbackUrl") === "string"
      ? (formData.get("callbackUrl") as string)
      : null,
  );

  if (provider !== "kakao" && provider !== "google") {
    redirect(
      `/login?error=InvalidProvider&callbackUrl=${encodeURIComponent(callbackUrl)}`,
    );
  }

  try {
    await signIn(provider as OAuthProvider, { redirectTo: callbackUrl });
  } catch (e) {
    if (e instanceof AuthError) {
      redirect(
        `/login?error=${encodeURIComponent(e.type)}&callbackUrl=${encodeURIComponent(callbackUrl)}`,
      );
    }
    throw e;
  }
}

/**
 * Phase 3 B2-C: auth tier — 5 req / 1min per IP (spec §3).
 * Credential stuffing 방어 + half-config provider 차단([ADR-0014])과 직교.
 * 차단 시 `/login?error=RATE_LIMITED&retryAfter=N` 로 리다이렉트 → UI 가 안내.
 */
export const signInWithProvider = withRateLimitAction(
  {
    tier: "auth",
    redirectOnBlock: (retry) =>
      `/login?error=RATE_LIMITED&retryAfter=${retry}`,
  },
  signInWithProviderImpl,
);

// 로그아웃 Server Action. LogoutButton 이 client component(UserNavIsland) 안에서
// import 되므로 inline "use server" 가 아닌 module-level Server Action 으로 정의.
// React 19 form action 에 그대로 dispatch 가능.
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
