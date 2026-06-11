import { describe, it, expect } from "vitest";
import { buildClarifyingChips } from "../clarifyingChips";
import type { RoutedQuery } from "../schemas";

const base: RoutedQuery = { cleanedQuery: "x" };

describe("buildClarifyingChips", () => {
  it("price·duration 미지정이면 예산·기간 칩을 제안한다", () => {
    const routed: RoutedQuery = { ...base, geoTerms: ["오사카"], themeTags: ["가족"] };
    const chips = buildClarifyingChips(routed, "오사카 가족여행");
    const texts = chips.map((c) => c.appendText);
    expect(texts).toContain("100만원");
    expect(texts).toContain("3박4일");
    expect(chips.length).toBeLessThanOrEqual(4);
  });

  it("이미 themeTags에 있는 테마는 칩으로 다시 제안하지 않는다", () => {
    const routed: RoutedQuery = { ...base, themeTags: ["온천"] };
    const chips = buildClarifyingChips(routed, "도쿄 여행 온천");
    expect(chips.map((c) => c.appendText)).not.toContain("온천");
  });

  it("쿼리에 이미 들어있는 토큰은 중복 제외한다", () => {
    const routed: RoutedQuery = { ...base };
    const chips = buildClarifyingChips(routed, "여행 100만원");
    expect(chips.map((c) => c.appendText)).not.toContain("100만원");
  });

  it("price·duration·theme가 모두 특정되면 빈 배열(완전 특정)", () => {
    const routed: RoutedQuery = {
      ...base,
      priceMax: 1000000,
      durationNights: { min: 3, max: 3 },
      themeTags: ["온천"],
    };
    expect(buildClarifyingChips(routed, "도쿄 온천 100만원 3박4일")).toEqual([]);
  });

  it("ClarifyingChip는 label과 appendText를 가진다", () => {
    const chips = buildClarifyingChips(base, "여행");
    for (const c of chips) {
      expect(typeof c.label).toBe("string");
      expect(typeof c.appendText).toBe("string");
    }
  });
});
