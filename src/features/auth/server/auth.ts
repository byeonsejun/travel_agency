import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Resend from "next-auth/providers/resend";
import Kakao from "next-auth/providers/kakao";
import Google from "next-auth/providers/google";
import { db } from "@/shared/lib/db";
import { env } from "@/shared/lib/env";
import { logger } from "@/shared/lib/logger";
import type { UserRole } from "@prisma/client";

// dev/test 환경에서는 RESEND_API_KEY 존재 여부와 무관하게 항상 콘솔 폴백.
// production에서만 실제 Resend API 호출. 로컬에서 실수로 테스트 키가
// 설정되어 있어도 외부 발송이 일어나지 않도록 보장한다.
const useDevConsoleFallback = env.NODE_ENV !== "production";

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(db),
  // [Auth.js v5] 프로덕션 OAuth — Vercel/프록시 뒤의 Host 헤더를 신뢰해
  // redirect_uri 를 올바른 배포 도메인으로 생성한다. trustHost 가 없으면
  // 프로덕션에서 host 인식이 불안정해 `UntrustedHost` 로 OAuth(Google/Kakao)가
  // 전부 차단될 수 있다. 로컬(localhost)은 원래 자동 신뢰라 무변동.
  // 정확한 origin 고정이 필요하면 `AUTH_URL` 환경변수로 지정(v5 자동 인식).
  trustHost: true,
  providers: [
    Resend({
      apiKey: env.RESEND_API_KEY ?? "DEV_ONLY",
      from: env.RESEND_FROM_EMAIL ?? "Nextour <noreply@nextour.example>",
      ...(useDevConsoleFallback
        ? {
            async sendVerificationRequest({ identifier, url }) {
              logger.info("auth.magiclink.dev", { email: identifier, url });
              console.log(
                `\n📧 [DEV] Magic link for ${identifier}:\n${url}\n`,
              );
            },
          }
        : {}),
    }),
    // OAuth providers — 매직링크와 동일 이메일로 가입한 사용자는 자동 병합.
    // `allowDangerousEmailAccountLinking`: Kakao/Google은 자체적으로 이메일을
    // 검증하는 신뢰 IdP이므로 verified email 기반 자동 link가 안전하다.
    // 이 플래그명에 "Dangerous" 가 붙은 이유는 이메일을 검증하지 않는 IdP에서
    // spoof 위험이 있어서 — 두 provider 모두 해당 위험에서 배제된다.
    ...(env.AUTH_KAKAO_ID && env.AUTH_KAKAO_SECRET
      ? [
          Kakao({
            clientId: env.AUTH_KAKAO_ID,
            clientSecret: env.AUTH_KAKAO_SECRET,
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
    ...(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET
      ? [
          Google({
            clientId: env.AUTH_GOOGLE_ID,
            clientSecret: env.AUTH_GOOGLE_SECRET,
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
  ],
  // Next.js middleware는 Edge runtime에서 실행되며, PrismaAdapter는
  // Edge에서 동작하지 않는다. database 전략은 middleware에서 세션을
  // 인식하지 못해 보호 라우트 무한 리다이렉트를 유발한다.
  // JWT 전략 + PrismaAdapter(User/Account/VerificationToken 저장용) 조합이
  // NextAuth v5의 표준 패턴이며 매직링크·Kakao 모두 호환된다.
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, user }) {
      // 첫 로그인 시 user 객체가 들어옴. 이후엔 token만.
      if (user) {
        token.id = user.id;
        token.role = (user as unknown as { role: UserRole }).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        if (typeof token.id === "string") session.user.id = token.id;
        if (token.role) session.user.role = token.role as UserRole;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
    verifyRequest: "/login/verify",
    error: "/login/error",
  },
});
