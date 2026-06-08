import type { Prisma, ReviewStatus, ReportReason, ReportStatus } from "@prisma/client";

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

// admin 모더레이션 목록 row. raw email/name 은 displayName 으로 사전 마스킹.
export type AdminReviewListItem = {
  id: string;
  rating: number;
  status: ReviewStatus;
  createdAt: Date;
  productId: string;
  productTitle: string;
  authorDisplayName: string;
  photoCount: number;
};

export type AdminReviewListPage = {
  items: AdminReviewListItem[];
  nextCursor: string | null;
};

// admin 신고 큐 row. OPEN 신고가 있는 리뷰만. 작성자는 displayName 으로 마스킹.
export type AdminReportedReviewListItem = {
  id: string;
  rating: number;
  status: ReviewStatus;
  createdAt: Date;
  productId: string;
  productTitle: string;
  authorDisplayName: string;
  openReportCount: number;
  topReason: ReportReason | null; // 가장 많이 지목된 OPEN 사유
};

export type AdminReportedReviewListPage = {
  items: AdminReportedReviewListItem[];
  nextCursor: string | null;
};

// admin 상세 신고 패널. 신고자는 displayName 으로 마스킹.
export type ReviewReportEntry = {
  id: string;
  reason: ReportReason;
  note: string | null;
  status: ReportStatus;
  createdAt: Date;
  reporterDisplayName: string;
};

export type ReviewReportSummary = {
  reviewId: string;
  openCount: number;
  reasonCounts: Record<ReportReason, number>; // OPEN 신고만 집계
  entries: ReviewReportEntry[]; // 전체(OPEN+종결) 최신순
};

// admin 상세 — 본문·사진 전체·상품 컨텍스트.
export type AdminReviewDetail = {
  id: string;
  rating: number;
  status: ReviewStatus;
  content: string;
  createdAt: Date;
  productId: string;
  productTitle: string;
  authorDisplayName: string;
  photos: Array<{ id: string; storagePath: string; order: number }>;
};
