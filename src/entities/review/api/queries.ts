import { db } from "@/shared/lib/db";

import { maskAuthorDisplayName } from "../model/displayName";
import type {
  ReviewListPage,
  ReviewStats,
  ReviewWithPhotos,
} from "../model/types";

// PDP 리뷰 카드 grid 용. 커서 기반 페이지네이션 — `(createdAt desc, id desc)`
// 복합 정렬로 동일 ms 내 다중 row 발생해도 안정적 페이지 경계.
// status=PUBLISHED 만 노출 (HIDDEN/REPORTED 는 모더레이션 대기·차단 의도).
// photos 는 단일 query 의 `include` 로 묶어 fetch — Prisma 가 photos 만 별도
// SELECT 한 번 호출(in 절)이라 사진 N개에 비례한 round-trip 0건 = N+1 없음.
export async function listReviewsByProduct(
  productId: string,
  opts: { limit?: number; cursor?: string } = {},
): Promise<ReviewListPage> {
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);

  const rows = await db.review.findMany({
    where: { productId, status: "PUBLISHED" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(opts.cursor && { cursor: { id: opts.cursor }, skip: 1 }),
    select: {
      id: true,
      rating: true,
      content: true,
      createdAt: true,
      // email 은 마스킹 입력으로만 사용 — 본 함수 로컬 범위를 벗어나지 않는다.
      // 반환 타입(`ReviewListItem`)에는 displayName 만 포함되므로 raw email 이
      // 호출부(RSC/widget/client) 로 전달될 경로 자체가 봉쇄된다.
      user: { select: { name: true, email: true, image: true } },
      photos: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          storagePath: true,
          order: true,
          width: true,
          height: true,
        },
      },
    },
  });

  const hasMore = rows.length > limit;
  const sliced = hasMore ? rows.slice(0, limit) : rows;

  // raw email 을 query 함수 밖으로 절대 흘려보내지 않기 위해, 여기서 즉시
  // 마스킹 + ReviewListItem 모양으로 좁힌다. 이후 페이로드/DOM 어느 단계에도
  // raw email 은 존재하지 않는다.
  const items = sliced.map((r) => ({
    id: r.id,
    rating: r.rating,
    content: r.content,
    createdAt: r.createdAt,
    user: {
      displayName: maskAuthorDisplayName({
        email: r.user.email,
        name: r.user.name,
      }),
      image: r.user.image,
    },
    photos: r.photos,
  }));

  return {
    items,
    nextCursor: hasMore ? items[items.length - 1].id : null,
  };
}

// PDP ReviewStatsBar 용. 단일 aggregate 쿼리 — row 페치 없이 DB 가 평균/카운트
// 만 반환. _avg.rating 은 row 0건일 때 null 이므로 0 으로 정규화.
export async function getProductReviewStats(
  productId: string,
): Promise<ReviewStats> {
  const result = await db.review.aggregate({
    where: { productId, status: "PUBLISHED" },
    _avg: { rating: true },
    _count: { _all: true },
  });

  return {
    avg: result._avg.rating ?? 0,
    count: result._count._all,
  };
}

// 마이페이지 예약 카드 그리드용 N+1 차단 헬퍼.
// COMPLETED 카드마다 "후기 작성하기" vs "내 후기 보기" 분기를 위해 booking 마다
// review 존재 여부를 알아야 하는데, 카드 별 단건 쿼리 N회 대신 단일 IN 쿼리로
// Set 을 사전 계산. status 무관 — 작성 자격 게이트와 동일 의미(HIDDEN 도 "이미
// 작성됨"으로 본다).
export async function getReviewedBookingIds(
  bookingIds: string[],
): Promise<Set<string>> {
  if (bookingIds.length === 0) return new Set();
  const rows = await db.review.findMany({
    where: { bookingId: { in: bookingIds } },
    select: { bookingId: true },
  });
  return new Set(rows.map((r) => r.bookingId));
}

// 마이페이지·후기 작성 폼 진입 시 자격 게이트용.
// - null 반환: 해당 booking 에 작성된 리뷰 없음 → '후기 작성' CTA 노출 가능
// - non-null: 이미 작성됨 → '내 후기 보기' CTA 분기
// status 무관(HIDDEN/REPORTED 도 "이미 작성됨"으로 간주해 중복 작성 차단).
// photos 동봉 — 호출부에서 본인 리뷰 미리보기 노출 시 추가 쿼리 없이 사용.
export async function getReviewByBooking(
  bookingId: string,
): Promise<ReviewWithPhotos | null> {
  return db.review.findUnique({
    where: { bookingId },
    include: { photos: { orderBy: { order: "asc" } } },
  });
}
