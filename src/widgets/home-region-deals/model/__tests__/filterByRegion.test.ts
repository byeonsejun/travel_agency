import { describe, it, expect } from "vitest";
import { regionOf, filterByRegion, buildRegionTabs, ALL_TAB } from "../filterByRegion";

type Item = { id: string; destination: string };
// 실제 데이터 포맷: "도시, 국가" (국가가 suffix). 콤마 없으면 전체가 국가.
const items: Item[] = [
  { id: "a", destination: "오사카, 일본" },
  { id: "b", destination: "다낭, 베트남" },
  { id: "c", destination: "도쿄, 일본" },
  { id: "d", destination: "스위스" },
  { id: "e", destination: "파리·로마, 유럽" },
];

describe("regionOf", () => {
  it("'도시, 국가' 에서 국가(suffix)를 추출한다", () => {
    expect(regionOf("오사카, 일본")).toBe("일본");
    expect(regionOf("파리·로마, 유럽")).toBe("유럽");
  });
  it("콤마가 없으면 전체 문자열이 국가", () => {
    expect(regionOf("스위스")).toBe("스위스");
  });
});

describe("filterByRegion", () => {
  it("'전체' 는 모든 항목을 반환", () => {
    expect(filterByRegion(items, ALL_TAB)).toHaveLength(5);
  });
  it("선택한 국가에 속하는 항목만 반환 (도시 무관)", () => {
    expect(filterByRegion(items, "일본").map((i) => i.id)).toEqual(["a", "c"]);
  });
});

describe("buildRegionTabs", () => {
  it("'전체' 를 맨 앞에 두고 items 의 distinct 국가를 붙인다", () => {
    expect(buildRegionTabs(items)).toEqual(["전체", "일본", "베트남", "스위스", "유럽"]);
  });
});
