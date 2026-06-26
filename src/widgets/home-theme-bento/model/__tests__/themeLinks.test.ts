import { describe, it, expect } from "vitest";
import { THEME_TILES, buildThemeHref } from "../themeLinks";

describe("themeLinks", () => {
  it("각 테마 타일은 검색 쿼리로 인코딩된 href 를 만든다", () => {
    expect(buildThemeHref("가족여행")).toBe("/search?q=%EA%B0%80%EC%A1%B1%EC%97%AC%ED%96%89");
  });

  it("4개 테마 타일을 제공한다", () => {
    expect(THEME_TILES).toHaveLength(4);
    expect(THEME_TILES.map((t) => t.query)).toEqual(["가족여행", "허니문", "나홀로 여행", "주말 근거리"]);
  });

  it("하드코딩 그라데이션(코랄/틸/보라 hex) 색을 더 이상 들고 있지 않다 — 색은 토큰/사진에서만", () => {
    for (const t of THEME_TILES) {
      // 색을 데이터에 박던 className(예: from-[#ff7e5f]) 필드는 제거됨.
      expect(t).not.toHaveProperty("className");
    }
  });

  it("각 타일 image 는 테마 버킷(product-hero/themes/<slug>.jpg) public URL 로 연결된다", () => {
    // recon 매칭표 순서: [0]가족→family, [1]허니문→honeymoon, [2]나홀로→solo, [3]주말근거리→weekend.
    const expectedSlugs = ["family", "honeymoon", "solo", "weekend"];
    THEME_TILES.forEach((t, i) => {
      expect(t.image).toBeDefined();
      expect(t.image).toContain(`product-hero/themes/${expectedSlugs[i]}.jpg`);
    });
  });
});
