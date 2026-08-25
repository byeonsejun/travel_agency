import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/features/auth/server";
import { isInWishlist } from "@/entities/wishlist";

// GET /api/wishlist/check?productId=<cuid>
// WishlistHeartIsland 가 hydration 후 자기 상태를 가져오는 엔드포인트.
// 이 라우트 덕분에 PDP RSC 가 auth() + isInWishlist() cookies 의존을 0 으로
// 떨어뜨려 `revalidate=3600` ISR 이 실제로 활성화된다 (A6).
//
// 캐시 정책: 유저별 상태이므로 절대 캐싱하지 않는다 (private, no-store).
// 응답 `loggedIn`: 클라이언트가 비로그인 클릭 시 confirm 모달을 띄울지 즉시
// 토글할지 결정. 비로그인은 inWishlist=false 고정 + loggedIn=false.
const QuerySchema = z.object({ productId: z.string().cuid() });

const NO_CACHE = { "Cache-Control": "private, no-store" } as const;

export async function GET(req: NextRequest) {
  const parsed = QuerySchema.safeParse({
    productId: req.nextUrl.searchParams.get("productId"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_productId" }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { inWishlist: false, loggedIn: false },
      { headers: NO_CACHE },
    );
  }

  const inWishlist = await isInWishlist(session.user.id, parsed.data.productId);
  return NextResponse.json(
    { inWishlist, loggedIn: true },
    { headers: NO_CACHE },
  );
}
