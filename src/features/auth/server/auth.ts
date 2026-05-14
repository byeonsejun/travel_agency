import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Resend from "next-auth/providers/resend";
import Kakao from "next-auth/providers/kakao";
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
    ...(env.AUTH_KAKAO_ID && env.AUTH_KAKAO_SECRET
      ? [
          Kakao({
            clientId: env.AUTH_KAKAO_ID,
            clientSecret: env.AUTH_KAKAO_SECRET,
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
