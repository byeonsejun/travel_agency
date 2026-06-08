import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/features/auth/server/auth";
import { getOwnReviewIdsForProduct } from "@/entities/review";

export const dynamic = "force-dynamic";

const QuerySchema = z.object({ productId: z.string().cuid() });

// PDP 리뷰 피드의 viewer 컨텍스트: 로그인 여부 + 본인 작성 리뷰 id 집합.
// 페이지 RSC 에서 auth() 를 부르면 PDP ISR 이 깨지므로(ADR-0018), client island 가
// 마운트 후 이 라우트를 호출해 신고 버튼 노출을 제어한다.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({ productId: url.searchParams.get("productId") });
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ authenticated: false, ownReviewIds: [] });
  }

  const ownReviewIds = await getOwnReviewIdsForProduct(parsed.data.productId, userId);
  return NextResponse.json({ authenticated: true, ownReviewIds });
}
