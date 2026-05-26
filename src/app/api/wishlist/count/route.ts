import { NextResponse } from "next/server";
import { auth } from "@/features/auth/server/auth";
import { countMyWishlist } from "@/entities/wishlist";

// GET /api/wishlist/count
// UserNavIsland 가 hydration 후 헤더 뱃지 카운트를 가져오는 endpoint.
// 이 라우트 + /api/auth/session 분리 fetch 덕분에 layout 이 auth() 의존을
// 0으로 떨어뜨려 PDP 가 ISR `●` 표기로 승격된다 (ADR-0018).
//
// 캐시 정책: 유저별 상태이므로 절대 캐싱하지 않는다 (private, no-store).
// 비로그인은 0 응답 — 뱃지 미표시, /login 우회 흐름은 별도.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { count: 0 },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const count = await countMyWishlist(session.user.id);
  return NextResponse.json(
    { count },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
