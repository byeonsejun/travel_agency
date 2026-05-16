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

  if (pathname.startsWith("/admin")) {
    if (!isAuthenticated || role !== "ADMIN") {
      const url = new URL("/login", req.url);
      url.searchParams.set("callbackUrl", req.nextUrl.href);
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
      url.searchParams.set("callbackUrl", req.nextUrl.href);
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
