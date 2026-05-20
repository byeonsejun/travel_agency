import { auth } from "@/features/auth/server/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  // Edge runtime — ALS/Prisma import 금지. crypto.randomUUID()만 사용.
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

  // 다운스트림 route handler로 x-trace-id 전파
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-trace-id", traceId);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-trace-id", traceId);
  return response;
});

export const config = {
  matcher: [
    "/admin/:path*",
    "/mypage/:path*",
    "/booking/:path*",
    "/bookings/:path*",        // 예약 상세·성공·실패 페이지 보호
    "/products/:id/checkout",  // 체크아웃 이중 방어 (page auth() 가드와 병행)
  ],
};
