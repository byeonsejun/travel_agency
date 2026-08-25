import { NextRequest, NextResponse } from "next/server";

import { getProductsByIds } from "@/entities/product";
import { parseCompareIds } from "@/features/product-compare";

// GET /api/compare/products?ids=<cuid>,<cuid>,...
//
// FloatingCompareCart 가 hydration 후 카트 콘텐츠를 client-fetch 하는 엔드포인트.
// 본 엔드포인트가 분리됨으로써 PDP 페이지가 더 이상 `searchParams.compareIds` 에
// 의존하지 않게 되어 ISR 로 복귀 가능 (A4).
//
// 가드: `parseCompareIds` 가 cuid 형식 검증·중복 제거·MAX_COMPARE 캡을 모두
// 강제하므로 별도 Zod 스키마 불필요 — 파싱 자체가 가드 역할. 결과가 빈 배열이면
// 빈 응답 반환.
//
// 캐시: `getProductsByIds` 가 unstable_cache(1h TTL + per-id 태그) 로 메모이즈되어
// 있어 underlying DB hit 은 압축됨. 추가로 Cache-Control 헤더로 브라우저(30s) +
// CDN(5min) + SWR(60s) 캐시 — 사용자가 카트 ids 변경 시 새 URL → 새 cache key →
// 즉시 신선, 동일 URL 재진입은 cache hit.
export async function GET(req: NextRequest) {
  const idsParam = req.nextUrl.searchParams.get("ids") ?? undefined;
  const ids = parseCompareIds(idsParam);

  if (ids.length === 0) {
    return NextResponse.json({ products: [] });
  }

  const products = await getProductsByIds(ids);

  return NextResponse.json(
    {
      products: products.map((p) => ({
        id: p.id,
        title: p.title,
        heroImageUrl: p.heroImageUrl,
      })),
    },
    {
      headers: {
        "Cache-Control":
          "public, max-age=30, s-maxage=300, stale-while-revalidate=60",
      },
    },
  );
}
