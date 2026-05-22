import type { Prisma } from "@prisma/client";

// Prisma row + photos relation 의 결합형. server-side에서 사진까지 함께 fetch
// 한 결과의 정확한 타입을 GetPayload 로 도출 — schema 변경 시 자동 추종.
export type ReviewWithPhotos = Prisma.ReviewGetPayload<{
  include: { photos: true };
}>;

// PDP·마이페이지 카드 뷰가 필요로 하는 최소 표면.
// **보안 invariant**: 작성자의 raw email·raw name 은 본 타입에 절대 포함하지
// 않는다. query 레이어에서 `maskAuthorDisplayName` 으로 즉시 마스킹된
// `displayName` 만 노출 — 미래 어떤 컴포넌트가 이 prop 을 받아도 raw PII
// 누설 경로 자체가 type 으로 봉쇄된다.
export type ReviewListItem = {
  id: string;
  rating: number;
  content: string;
  createdAt: Date;
  user: {
    displayName: string;
    image: string | null;
  };
  photos: Array<{
    id: string;
    storagePath: string;
    order: number;
    width: number | null;
    height: number | null;
  }>;
};

// PDP 상단 ReviewStatsBar 가 받는 단순 집계 결과.
// 리뷰 0개 상품의 avg 는 null 대신 0 으로 정규화 — UI 가드 분기 최소화.
export type ReviewStats = {
  avg: number;
  count: number;
};

// 커서 기반 페이지네이션 응답. nextCursor === null 이면 더 불러올 페이지 없음.
export type ReviewListPage = {
  items: ReviewListItem[];
  nextCursor: string | null;
};
