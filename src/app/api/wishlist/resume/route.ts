import { NextResponse } from "next/server";
import { auth } from "@/features/auth/server";
import { db } from "@/shared/lib/db";
import { safeReturnTo } from "@/entities/wishlist";

// 비로그인 유저가 하트 클릭 → /login 으로 우회됐다가 로그인 성공 후
// callbackUrl 로 들어오면 여기로 라우팅되어 자동 add 수행 → returnTo 로 redirect.
//
// 별도 API route 인 이유: RSC 헬퍼로 처리하면 페이지가 searchParams 의존이 되어
// PDP/홈의 ISR 정책(`revalidate = 3600` 등)이 dynamic 으로 떨어진다.
// 라우트 핸들러는 그 영향 없음.
//
// 멱등성: db.wishlist.upsert(update: {}) — 이미 찜한 상품이면 no-op. 토글 X.
// 새로고침·뒤로가기로 같은 URL 이 재호출돼도 안전.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const productId = url.searchParams.get("productId");
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"));

  if (!productId) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  const session = await auth();
  if (!session?.user?.id) {
    // 안전망: 세션 없이 진입 시 로그인부터.
    const callbackUrl = `/api/wishlist/resume?productId=${encodeURIComponent(productId)}&returnTo=${encodeURIComponent(returnTo)}`;
    return NextResponse.redirect(
      new URL(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`, req.url),
    );
  }

  await db.wishlist.upsert({
    where: {
      userId_productId: { userId: session.user.id, productId },
    },
    create: { userId: session.user.id, productId },
    update: {},
  });

  return NextResponse.redirect(new URL(returnTo, req.url));
}
