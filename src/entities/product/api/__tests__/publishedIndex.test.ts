import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  db: { product: { findMany: vi.fn() } },
}));

vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));
vi.mock("@/shared/lib/db", () => ({ db: mocks.db }));

import { getPublishedProductIndex } from "../queries";

describe("getPublishedProductIndex", () => {
  beforeEach(() => {
    mocks.db.product.findMany.mockReset();
  });

  it("공개 상품만, 필요한 7개 필드만, 등록순으로 조회하고 결과를 그대로 돌려준다", async () => {
    const rows = [
      {
        id: "p1",
        title: "오사카 3박 4일",
        destination: "오사카, 일본",
        durationNights: 3,
        durationDays: 4,
        basePriceAdult: 890000,
        updatedAt: new Date("2026-11-01T00:00:00Z"),
      },
    ];
    mocks.db.product.findMany.mockResolvedValue(rows);

    const result = await getPublishedProductIndex();

    expect(mocks.db.product.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.db.product.findMany).toHaveBeenCalledWith({
      where: { status: "PUBLISHED" },
      select: {
        id: true,
        title: true,
        destination: true,
        durationNights: true,
        durationDays: true,
        basePriceAdult: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "asc" },
    });
    expect(result).toEqual(rows);
  });
});
