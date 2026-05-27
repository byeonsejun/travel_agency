import { auth } from "@/features/auth/server/auth";
import { NextResponse } from "next/server";
import { buildCspHeader, CSP_NONCE_HEADER } from "@/shared/lib/security";
import {
  buildRateLimitHeaders,
  enforce,
  identify,
  isBypassPath,
  type RateLimitVerdict,
} from "@/shared/lib/rate-limit";

export default auth(async (req) => {
  // Edge runtime — ALS/Prisma import 금지. crypto.randomUUID() / getRandomValues() 만 사용.
  const traceId =
    req.headers.get("x-trace-id") ??
    crypto.randomUUID().replace(/-/g, "").slice(0, 16);

  const { pathname } = req.nextUrl;
  const isAuthenticated = !!req.auth;
  const role = req.auth?.user?.role;

  // 상대 경로로 callbackUrl을 전달 — login 페이지의 startsWith("/") 검증과
  // 정합화. href(절대 URL)를 넘기면 open-redirect 가드에서 거부되어 사용자가
  // 홈으로 떨어지는 데이터 연속성 누수가 발생한다 (Phase 3 골든패스 회귀 방지).
  const callbackTarget = `${pathname}${req.nextUrl.search}`;

  // ─── Rate Limit (global tier) — Edge baseline (spec §4 Hybrid 통합) ────────
  // `/api/*` 한정 + bypass list 제외. shadow 모드면 차단 없이 통과.
  // 차단 시 즉시 응답하므로 아래 auth/CSP 로직보다 *먼저* 평가한다 — 콜드스타트
  // 비용 절약 목적이 본 통합의 이유.
  let rateLimitVerdict: RateLimitVerdict | null = null;
  if (pathname.startsWith("/api/") && !isBypassPath(pathname)) {
    const userId = req.auth?.user?.id ?? null;
    const id = identify(req as unknown as Request, "userFirst", userId);
    rateLimitVerdict = await enforce("global", id);
    if (!rateLimitVerdict.ok) {
      const headers = buildRateLimitHeaders(rateLimitVerdict);
      headers["Retry-After"] = String(rateLimitVerdict.retryAfterSeconds);
      headers["x-trace-id"] = traceId;
      return NextResponse.json(
        {
          error: "RATE_LIMITED",
          tier: "global",
          retryAfterSeconds: rateLimitVerdict.retryAfterSeconds,
          traceId,
        },
        { status: 429, headers },
      );
    }
  }

  // ─── Auth redirects (unchanged) ───────────────────────────────────────────
  if (pathname.startsWith("/login") && isAuthenticated) {
    const res = NextResponse.redirect(new URL("/", req.url));
    res.headers.set("x-trace-id", traceId);
    return res;
  }

  if (pathname.startsWith("/admin")) {
    if (!isAuthenticated || role !== "ADMIN") {
      const url = new URL("/login", req.url);
      url.searchParams.set("callbackUrl", callbackTarget);
      const res = NextResponse.redirect(url);
      res.headers.set("x-trace-id", traceId);
      return res;
    }
  }

  // /bookings 추가 (기존 /booking 단수 경로 + 복수 경로 동시 보호)
  const authRequired = ["/mypage", "/booking", "/bookings"];
  if (authRequired.some((p) => pathname.startsWith(p))) {
    if (!isAuthenticated) {
      const url = new URL("/login", req.url);
      url.searchParams.set("callbackUrl", callbackTarget);
      const res = NextResponse.redirect(url);
      res.headers.set("x-trace-id", traceId);
      return res;
    }
  }

  // ─── CSP nonce + traceId (unchanged) ──────────────────────────────────────
  // 요청별 nonce — 16바이트 base64 (Edge runtime 호환).
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  const nonce = btoa(String.fromCharCode(...nonceBytes));

  // 요청 헤더에 traceId + nonce 박제 → RSC tree 가 headers() API 로 회수.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-trace-id", traceId);
  requestHeaders.set(CSP_NONCE_HEADER, nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-trace-id", traceId);

  // Rate Limit 헤더 박제 (api path 통과 시 — quota 가시화).
  if (rateLimitVerdict) {
    for (const [k, v] of Object.entries(buildRateLimitHeaders(rateLimitVerdict))) {
      response.headers.set(k, v);
    }
  }

  // CSP 헤더 박제 — CSP_MODE=enforce 가 아니면 Report-Only 가 기본 (롤아웃 게이트).
  const csp = buildCspHeader({
    nonce,
    reportOnly: process.env.CSP_MODE !== "enforce",
  });
  response.headers.set(csp.headerName, csp.value);

  return response;
});

export const config = {
  // CSP nonce 는 모든 HTML 응답에 박혀야 함.
  // _next/static, _next/image, favicon, /api/csp-report (재귀 방지) 만 제외.
  // missing 조건은 Next 의 RSC prefetch 호출에서 middleware 가 nonce 를 다시 생성하지 않도록 함.
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|api/csp-report).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
