import type { ReviewStatus, ReportReason } from "@prisma/client";

import { db } from "@/shared/lib/db";

import { maskAuthorDisplayName } from "../model/displayName";
import {
  normalizeRatingDistribution,
  type RatingDistribution,
} from "../model/ratingDistribution";
import type {
  AdminReviewDetail,
  AdminReviewListPage,
  AdminReportedReviewListItem,
  AdminReportedReviewListPage,
  ReviewListPage,
  ReviewReportEntry,
  ReviewReportSummary,
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
  opts: { limit?: number; cursor?: string; viewerId?: string } = {},
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
      userId: true,
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
    isOwn: opts.viewerId != null && r.userId === opts.viewerId,
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

// PDP 별점 분포 그래프용. groupBy 단일 집계 — row 페치 0건. PUBLISHED 만.
// 누락 별점(1~5 중 0건인 점수)은 normalizeRatingDistribution 가 0 으로 채운다.
export async function getReviewRatingDistribution(
  productId: string,
): Promise<RatingDistribution> {
  const rows = await db.review.groupBy({
    by: ["rating"],
    where: { productId, status: "PUBLISHED" },
    _count: { _all: true },
  });
  return normalizeRatingDistribution(rows);
}

// admin 모더레이션 목록. status 무관(또는 단일 status 필터) — 숨김/신고도 노출.
// 커서 (createdAt desc, id desc) — PDP 쿼리와 동일 안정 정렬.
// raw email 은 maskAuthorDisplayName 으로 즉시 마스킹 — 호출부로 PII 미유출.
export async function listReviewsForAdmin(
  opts: {
    status?: ReviewStatus;
    cursor?: string;
    limit?: number;
  } = {},
): Promise<AdminReviewListPage> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const rows = await db.review.findMany({
    where: opts.status ? { status: opts.status } : {},
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(opts.cursor && { cursor: { id: opts.cursor }, skip: 1 }),
    select: {
      id: true,
      rating: true,
      status: true,
      createdAt: true,
      productId: true,
      product: { select: { title: true } },
      user: { select: { name: true, email: true } },
      _count: { select: { photos: true } },
    },
  });

  const hasMore = rows.length > limit;
  const sliced = hasMore ? rows.slice(0, limit) : rows;
  const items = sliced.map((r) => ({
    id: r.id,
    rating: r.rating,
    status: r.status,
    createdAt: r.createdAt,
    productId: r.productId,
    productTitle: r.product.title,
    authorDisplayName: maskAuthorDisplayName({
      email: r.user.email,
      name: r.user.name,
    }),
    photoCount: r._count.photos,
  }));

  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

// admin 상세 — 단건 + 사진 전체 + 상품 컨텍스트.
export async function getReviewForAdmin(
  id: string,
): Promise<AdminReviewDetail | null> {
  const r = await db.review.findUnique({
    where: { id },
    select: {
      id: true,
      rating: true,
      status: true,
      content: true,
      createdAt: true,
      productId: true,
      product: { select: { title: true } },
      user: { select: { name: true, email: true } },
      photos: {
        orderBy: { order: "asc" },
        select: { id: true, storagePath: true, order: true },
      },
    },
  });
  if (!r) return null;
  return {
    id: r.id,
    rating: r.rating,
    status: r.status,
    content: r.content,
    createdAt: r.createdAt,
    productId: r.productId,
    productTitle: r.product.title,
    authorDisplayName: maskAuthorDisplayName({
      email: r.user.email,
      name: r.user.name,
    }),
    photos: r.photos,
  };
}

// admin 신고 큐. OPEN 신고가 1건+ 인 리뷰만. OPEN 신고를 relation 으로 동봉해
// JS 에서 건수/대표사유 집계(필터 _count 대신 명시 — 버전 호환 안전).
// 작성자 email 은 maskAuthorDisplayName 으로 즉시 마스킹(PII 미유출).
export async function listReviewsWithOpenReports(
  opts: { cursor?: string; limit?: number } = {},
): Promise<AdminReportedReviewListPage> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const rows = await db.review.findMany({
    // PUBLISHED 리뷰만 큐에 노출 — 이미 숨겨진 리뷰의 잔여 OPEN 신고는 무의미(노출 안 됨)
    // 하므로 제외. 이로써 resolveReportsAction(PUBLISHED→HIDDEN)이 큐 항목에서 항상 유효.
    where: { status: "PUBLISHED", reports: { some: { status: "OPEN" } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(opts.cursor && { cursor: { id: opts.cursor }, skip: 1 }),
    select: {
      id: true,
      rating: true,
      status: true,
      createdAt: true,
      productId: true,
      product: { select: { title: true } },
      user: { select: { name: true, email: true } },
      reports: {
        where: { status: "OPEN" },
        select: { reason: true },
      },
    },
  });

  const hasMore = rows.length > limit;
  const sliced = hasMore ? rows.slice(0, limit) : rows;

  const items: AdminReportedReviewListItem[] = sliced.map((r) => {
    const counts = new Map<ReportReason, number>();
    for (const rep of r.reports) {
      counts.set(rep.reason, (counts.get(rep.reason) ?? 0) + 1);
    }
    let topReason: ReportReason | null = null;
    let topN = 0;
    for (const [reason, n] of counts) {
      if (n > topN) {
        topN = n;
        topReason = reason;
      }
    }
    return {
      id: r.id,
      rating: r.rating,
      status: r.status,
      createdAt: r.createdAt,
      productId: r.productId,
      productTitle: r.product.title,
      authorDisplayName: maskAuthorDisplayName({
        name: r.user.name,
        email: r.user.email,
      }),
      openReportCount: r.reports.length,
      topReason,
    };
  });

  return {
    items,
    nextCursor: hasMore ? sliced[sliced.length - 1].id : null,
  };
}

// 특정 상품에서 viewer 본인이 작성한 리뷰 id 집합. PDP client island 가 신고 버튼
// 노출 제어(본인 리뷰 숨김)에 사용. 타 유저 데이터는 반환하지 않음(PII 경계 보존).
export async function getOwnReviewIdsForProduct(
  productId: string,
  userId: string,
): Promise<string[]> {
  const rows = await db.review.findMany({
    where: { productId, userId },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

// admin 상세 신고 패널. 전체 신고(OPEN+종결) 최신순 + OPEN 사유별 집계.
export async function getReportsForReview(
  reviewId: string,
): Promise<ReviewReportSummary> {
  const rows = await db.reviewReport.findMany({
    where: { reviewId },
    orderBy: { createdAt: "desc" },
    // 상한 100 — 단일 리뷰에 비정상적으로 많은 신고가 쌓여도 admin 패널 쿼리를 유계로 유지.
    take: 100,
    select: {
      id: true,
      reason: true,
      note: true,
      status: true,
      createdAt: true,
      reporter: { select: { name: true, email: true } },
    },
  });

  const reasonCounts: Record<ReportReason, number> = {
    SPAM: 0,
    ABUSIVE: 0,
    IRRELEVANT: 0,
    PRIVACY: 0,
    OTHER: 0,
  };
  let openCount = 0;
  const entries: ReviewReportEntry[] = rows.map((r) => {
    if (r.status === "OPEN") {
      reasonCounts[r.reason] += 1;
      openCount += 1;
    }
    return {
      id: r.id,
      reason: r.reason,
      note: r.note,
      status: r.status,
      createdAt: r.createdAt,
      reporterDisplayName: maskAuthorDisplayName({
        name: r.reporter.name,
        email: r.reporter.email,
      }),
    };
  });

  return { reviewId, openCount, reasonCounts, entries };
}
