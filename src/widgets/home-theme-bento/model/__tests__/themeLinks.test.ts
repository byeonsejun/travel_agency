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
});
