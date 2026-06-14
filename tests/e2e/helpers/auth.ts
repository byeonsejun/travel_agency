/**
 * E2E 인증 헬퍼 — JWT 세션 쿠키 주입 (옵션 A).
 *
 * 기존 prod 인증을 *전혀 약화시키지 않는다*: src에 테스트용 바이패스 라우트나
 * credentials provider를 추가하지 않고, 운영과 동일한 `AUTH_SECRET` + Auth.js의
 * `encode`로 시드 customer의 세션 토큰을 만들어 Playwright `addCookies`로 주입한다.
 * 미들웨어의 `auth()`가 평소처럼 이 쿠키를 복호화해 인증 상태를 인식한다.
 *
 * 쿠키명/salt는 NextAuth v5가 dev(http) 환경에서 기대하는 형태:
 *   - 비보안(http) 세션 쿠키명 = `authjs.session-token`
 *   - JWE salt = 쿠키명과 동일 (decode 기본값과 일치)
 */

import { encode } from "next-auth/jwt";
import type { Cookie } from "@playwright/test";
import { loadEnvFromDotenv } from "./loadEnv";

/** dev(http) 환경의 NextAuth v5 세션 쿠키명. https라면 `__Secure-` 접두사가 붙는다. */
const SESSION_COOKIE_NAME = "authjs.session-token";

/** 시드 customer (prisma/seed.ts) — 결정적 픽스처. */
export const SEED_CUSTOMER = {
  id: "cseedcustomer0000000000001",
  email: "customer@nextour.test",
  name: "테스트 고객",
  role: "CUSTOMER",
} as const;

const SESSION_MAX_AGE = 60 * 60; // 1h — 테스트 1회 실행에 충분

/**
 * 시드 customer 세션을 담은 Playwright 쿠키 객체를 생성한다.
 * `context.addCookies([await createSessionCookie(baseURL)])`로 주입.
 */
export async function createSessionCookie(baseURL: string): Promise<Cookie> {
  loadEnvFromDotenv();

  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "AUTH_SECRET 미설정 — .env 로드에 실패했습니다(쿠키 서명 불가).",
    );
  }

  // jwt 콜백이 첫 로그인 시 token에 박는 필드(id/role) + 표준 클레임을 미러.
  // session 콜백은 token.id / token.role을 session.user로 투영한다.
  const token = await encode({
    salt: SESSION_COOKIE_NAME,
    secret,
    maxAge: SESSION_MAX_AGE,
    token: {
      sub: SEED_CUSTOMER.id,
      id: SEED_CUSTOMER.id,
      role: SEED_CUSTOMER.role,
      name: SEED_CUSTOMER.name,
      email: SEED_CUSTOMER.email,
    },
  });

  const { hostname } = new URL(baseURL);

  return {
    name: SESSION_COOKIE_NAME,
    value: token,
    domain: hostname,
    path: "/",
    httpOnly: true,
    secure: false, // dev는 http — secure 쿠키명/플래그를 쓰지 않는다
    sameSite: "Lax",
    expires: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE,
  };
}
