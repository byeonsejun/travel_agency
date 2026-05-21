import { db } from "@/shared/lib/db";
import type { WishlistItemWithProduct } from "../model/types";

// 마이페이지용. 최신 찜 순으로 Product 카드 데이터를 함께 조인.
export async function listMyWishlist(
  userId: string
): Promise<WishlistItemWithProduct[]> {
  const rows = await db.wishlist.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      productId: true,
      createdAt: true,
      product: {
        select: {
          id: true,
          title: true,
          destination: true,
          durationNights: true,
          durationDays: true,
          heroImageUrl: true,
          basePriceAdult: true,
          aiSummary: true,
          tags: { select: { tag: true } },
        },
      },
    },
  });

  return rows.map((r) => ({
    productId: r.productId,
    createdAt: r.createdAt,
    product: { ...r.product },
  }));
}

// 상품 목록 페이지에서 카드별 inWishlist 표시를 N+1 없이 계산하기 위한 헬퍼.
// productId Set 만 받아 ProductCardList 에서 ids.has(p.id) 로 룩업.
export async function getMyWishlistProductIds(
  userId: string
): Promise<Set<string>> {
  const rows = await db.wishlist.findMany({
    where: { userId },
    select: { productId: true },
  });
  return new Set(rows.map((r) => r.productId));
}

// 상품 상세 페이지처럼 단일 productId 만 체크.
export async function isInWishlist(
  userId: string,
  productId: string
): Promise<boolean> {
  const row = await db.wishlist.findUnique({
    where: { userId_productId: { userId, productId } },
    select: { id: true },
  });
  return row !== null;
}
