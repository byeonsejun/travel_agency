import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  groupBy: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  reportFindMany: vi.fn(),
}));

vi.mock("@/shared/lib/db", () => ({
  db: {
    review: {
      groupBy: mocks.groupBy,
      findMany: mocks.findMany,
      findUnique: mocks.findUnique,
    },
    reviewReport: {
      findMany: mocks.reportFindMany,
    },
  },
}));

import {
  getReviewRatingDistribution,
  listReviewsForAdmin,
  getReviewForAdmin,
  listReviewsWithOpenReports,
  getReportsForReview,
} from "../queries";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getReviewRatingDistribution", () => {
  it("PUBLISHED 만 groupBy 후 1~5 키로 정규화", async () => {
    mocks.groupBy.mockResolvedValue([
      { rating: 5, _count: { _all: 3 } },
      { rating: 3, _count: { _all: 1 } },
    ]);

    const dist = await getReviewRatingDistribution("prod1");

    expect(dist).toEqual({ 1: 0, 2: 0, 3: 1, 4: 0, 5: 3 });
    const arg = mocks.groupBy.mock.calls[0][0];
    expect(arg.where).toEqual({ productId: "prod1", status: "PUBLISHED" });
  });
});

describe("listReviewsForAdmin", () => {
  it("hasMore 시 마지막 1건 잘라내고 nextCursor 설정 + 작성자 마스킹·사진수 매핑", async () => {
    // limit=2 → take=3, 3건 반환 → hasMore
    mocks.findMany.mockResolvedValue([
      {
        id: "r1",
        rating: 5,
        status: "PUBLISHED",
        createdAt: new Date("2026-06-01"),
        productId: "p1",
        product: { title: "도쿄 패키지" },
        user: { name: "홍길동", email: "frontend@gmail.com" },
        _count: { photos: 2 },
      },
      {
        id: "r2",
        rating: 3,
        status: "HIDDEN",
        createdAt: new Date("2026-05-31"),
        productId: "p2",
        product: { title: "방콕 패키지" },
        user: { name: null, email: "ab@x.com" },
        _count: { photos: 0 },
      },
      {
        id: "r3",
        rating: 1,
        status: "PUBLISHED",
        createdAt: new Date("2026-05-30"),
        productId: "p3",
        product: { title: "세부 패키지" },
        user: { name: null, email: "zz@x.com" },
        _count: { photos: 1 },
      },
    ]);

    const page = await listReviewsForAdmin({ limit: 2 });

    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe("r2");
    expect(page.items[0]).toEqual({
      id: "r1",
      rating: 5,
      status: "PUBLISHED",
      createdAt: new Date("2026-06-01"),
      productId: "p1",
      productTitle: "도쿄 패키지",
      authorDisplayName: "fro***",
      photoCount: 2,
    });
  });

  it("status 필터를 where 에 전달, 미지정 시 빈 where", async () => {
    mocks.findMany.mockResolvedValue([]);

    await listReviewsForAdmin({ status: "HIDDEN" });
    expect(mocks.findMany.mock.calls[0][0].where).toEqual({ status: "HIDDEN" });

    await listReviewsForAdmin();
    expect(mocks.findMany.mock.calls[1][0].where).toEqual({});
  });

  it("rows ≤ limit 이면 nextCursor=null", async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: "r1",
        rating: 4,
        status: "PUBLISHED",
        createdAt: new Date("2026-06-01"),
        productId: "p1",
        product: { title: "T" },
        user: { name: null, email: "ab@x.com" },
        _count: { photos: 0 },
      },
    ]);

    const page = await listReviewsForAdmin({ limit: 20 });
    expect(page.nextCursor).toBeNull();
    expect(page.items).toHaveLength(1);
  });
});

describe("getReviewForAdmin", () => {
  it("부재 시 null", async () => {
    mocks.findUnique.mockResolvedValue(null);
    expect(await getReviewForAdmin("nope")).toBeNull();
  });

  it("본문·사진·상품 컨텍스트 매핑 + 작성자 마스킹", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "r1",
      rating: 5,
      status: "PUBLISHED",
      content: "최고의 여행",
      createdAt: new Date("2026-06-01"),
      productId: "p1",
      product: { title: "도쿄 패키지" },
      user: { name: "홍길동", email: "frontend@gmail.com" },
      photos: [{ id: "ph1", storagePath: "review-photos/r1/0.webp", order: 0 }],
    });

    const detail = await getReviewForAdmin("r1");

    expect(detail).toEqual({
      id: "r1",
      rating: 5,
      status: "PUBLISHED",
      content: "최고의 여행",
      createdAt: new Date("2026-06-01"),
      productId: "p1",
      productTitle: "도쿄 패키지",
      authorDisplayName: "fro***",
      photos: [{ id: "ph1", storagePath: "review-photos/r1/0.webp", order: 0 }],
    });
  });
});

describe("listReviewsWithOpenReports", () => {
  it("OPEN 신고 있는 리뷰만 + 건수/대표사유 집계 + 작성자 마스킹", async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: "r1",
        rating: 2,
        status: "PUBLISHED",
        createdAt: new Date("2026-06-01"),
        productId: "p1",
        product: { title: "방콕 4일" },
        user: { name: "홍길동", email: "hong@test.com" },
        reports: [{ reason: "SPAM" }, { reason: "SPAM" }, { reason: "ABUSIVE" }],
      },
    ]);

    const page = await listReviewsWithOpenReports({ limit: 20 });

    expect(mocks.findMany.mock.calls[0][0].where).toEqual({
      reports: { some: { status: "OPEN" } },
    });
    expect(page.items[0].openReportCount).toBe(3);
    expect(page.items[0].topReason).toBe("SPAM");
    expect(page.items[0].productTitle).toBe("방콕 4일");
    // raw email 미유출
    expect(JSON.stringify(page.items[0])).not.toContain("hong@test.com");
    expect(page.nextCursor).toBeNull();
  });
});

describe("getReportsForReview", () => {
  it("사유별 OPEN 집계 + entries 마스킹", async () => {
    mocks.reportFindMany.mockResolvedValue([
      {
        id: "rep1",
        reason: "SPAM",
        note: null,
        status: "OPEN",
        createdAt: new Date(),
        reporter: { name: "김철수", email: "kim@test.com" },
      },
      {
        id: "rep2",
        reason: "PRIVACY",
        note: "전화번호",
        status: "DISMISSED",
        createdAt: new Date(),
        reporter: { name: null, email: "lee@test.com" },
      },
    ]);

    const summary = await getReportsForReview("r1");

    expect(summary.openCount).toBe(1);
    expect(summary.reasonCounts.SPAM).toBe(1);
    expect(summary.reasonCounts.PRIVACY).toBe(0); // DISMISSED 는 OPEN 집계 제외
    expect(summary.entries).toHaveLength(2);
    expect(JSON.stringify(summary)).not.toContain("kim@test.com");
  });
});
