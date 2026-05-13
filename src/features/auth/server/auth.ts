import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Resend from "next-auth/providers/resend";
import Kakao from "next-auth/providers/kakao";
import { db } from "@/shared/lib/db";
import { env } from "@/shared/lib/env";
import { logger } from "@/shared/lib/logger";
import type { UserRole } from "@prisma/client";

const useDevConsoleFallback =
  env.NODE_ENV !== "production" && !env.RESEND_API_KEY;

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
  session: { strategy: "database" },
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      session.user.role = (user as unknown as { role: UserRole }).role;
      return session;
    },
  },
  pages: {
    signIn: "/login",
    verifyRequest: "/login/verify",
    error: "/login/error",
  },
});
