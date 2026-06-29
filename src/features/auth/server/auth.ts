import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Resend from "next-auth/providers/resend";
import Kakao from "next-auth/providers/kakao";
import Google from "next-auth/providers/google";
import { db } from "@/shared/lib/db";
import { env } from "@/shared/lib/env";
import { logger } from "@/shared/lib/logger";
import { renderMagicLinkEmail } from "@/shared/email/magicLink";
import { sendMagicLinkEmail } from "@/shared/email/smtp";
import type { UserRole } from "@prisma/client";

// dev/test 환경에서는 항상 콘솔 폴백. production에서만 실제 Gmail SMTP 발송.
// 로컬에서 실수로 자격증명이 설정되어 있어도 외부 발송이 일어나지 않도록 보장한다.
const useDevConsoleFallback = env.NODE_ENV !== "production";

// Resend provider의 설정 필드용 — 매직링크 토큰/URL 생성 플로우(Auth.js Email
// provider 메커니즘)를 구동하기 위해 type상 필요. 실제 발송 transport는
// sendVerificationRequest 오버라이드에서 Gmail SMTP로 교체했으므로 이 값들은
// 발송에 쓰이지 않는다(아웃박스 Resend 경로는 provider.ts가 env를 직접 읽음).
const resendApiKey = env.RESEND_API_KEY ?? "DEV_ONLY";
const resendFrom = env.RESEND_FROM_EMAIL ?? "Nextour <noreply@nextour.example>";

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
      apiKey: resendApiKey,
      from: resendFrom,
      // 매직링크 메일을 Nextour 브랜드로 발송. URL/토큰은 Auth.js가 생성한 값을
      // 그대로 연결만 한다(인증 흐름·토큰·URL 생성 로직 무변경). 발송 transport는
      // Gmail SMTP(smtp.ts) — 도메인 인증 없이 임의 수신자에게 발송하기 위함.
      // 렌더 템플릿/subject/본문은 동일하게 재사용.
      async sendVerificationRequest({ identifier, url }) {
        // dev/test: 실 발송 금지 — 매직링크 URL을 콘솔로 출력(로컬 로그인 수단).
        if (useDevConsoleFallback) {
          logger.info("auth.magiclink.dev", { email: identifier, url });
          console.log(`\n📧 [DEV] Magic link for ${identifier}:\n${url}\n`);
          return;
        }

        const rendered = await renderMagicLinkEmail(url);
        await sendMagicLinkEmail(identifier, rendered);
      },
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
