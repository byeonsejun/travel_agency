import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getPublishedProductIndex: vi.fn(),
}));

vi.mock("@/shared/lib/env", () => ({ env: { VERCEL_ENV: undefined } }));
vi.mock("@/entities/product", () => ({
  getPublishedProductIndex: mocks.getPublishedProductIndex,
}));

import { buildRobots } from "../app/robots";
import sitemap from "../app/sitemap";

const BASE = "https://travel-agency-sooty-mu.vercel.app";

describe("buildRobots", () => {
  it("운영: 전체 허용, /api/ 만 막고 사이트맵을 알린다", () => {
    expect(buildRobots(false)).toEqual({
      rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }],
      sitemap: `${BASE}/sitemap.xml`,
    });
  });

  it("미리보기: 전부 막고 사이트맵은 없다", () => {
    const robots = buildRobots(true);
    expect(robots.rules).toEqual([{ userAgent: "*", disallow: "/" }]);
    expect(robots).not.toHaveProperty("sitemap");
  });
});

describe("sitemap", () => {
  beforeEach(() => {
    mocks.getPublishedProductIndex.mockReset();
  });

  it("공개 화면 3개와 상품 상세만 절대 주소로 나열한다", async () => {
    const u1 = new Date("2026-11-01T00:00:00Z");
    const u2 = new Date("2026-11-10T00:00:00Z");
    mocks.getPublishedProductIndex.mockResolvedValue([
      { id: "p1", title: "a", destination: "d", durationNights: 1, durationDays: 2, basePriceAdult: 1, updatedAt: u1 },
      { id: "p2", title: "b", destination: "d", durationNights: 1, durationDays: 2, basePriceAdult: 1, updatedAt: u2 },
    ]);

    const entries = await sitemap();

    expect(entries.map((e) => e.url)).toEqual([
      `${BASE}/`,
      `${BASE}/products`,
      `${BASE}/search`,
      `${BASE}/products/p1`,
      `${BASE}/products/p2`,
    ]);
    const urls = entries.map((e) => e.url).join("\n");
    expect(urls).not.toMatch(/compare|login|mypage/);
    expect(entries.find((e) => e.url.endsWith("/p1"))?.lastModified).toEqual(u1);
    expect(entries.find((e) => e.url.endsWith("/p2"))?.lastModified).toEqual(u2);
  });
});
