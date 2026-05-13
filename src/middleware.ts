import { auth } from "@/features/auth/server/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isAuthenticated = !!req.auth;
  const role = req.auth?.user?.role;

  if (pathname.startsWith("/admin")) {
    if (!isAuthenticated || role !== "ADMIN") {
      const url = new URL("/login", req.url);
      url.searchParams.set("callbackUrl", req.nextUrl.href);
      return NextResponse.redirect(url);
    }
  }

  const authRequired = ["/mypage", "/booking"];
  if (authRequired.some((p) => pathname.startsWith(p))) {
    if (!isAuthenticated) {
      const url = new URL("/login", req.url);
      url.searchParams.set("callbackUrl", req.nextUrl.href);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/admin/:path*", "/mypage/:path*", "/booking/:path*"],
};
