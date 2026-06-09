import { describe, it, expect } from "vitest";
import { filterByDestination, buildRegionTabs } from "../filterByRegion";

type Item = { id: string; destination: string };
const items: Item[] = [
  { id: "a", destination: "일본 · 도쿄" },
  { id: "b", destination: "베트남 · 다낭" },
  { id: "c", destination: "일본 · 오사카" },
];

describe("filterByDestination", () => {
  it("'전체' 는 모든 항목을 반환", () => {
    expect(filterByDestination(items, "전체")).toHaveLength(3);
  });
  it("선택한 destination 라벨로 시작하는 항목만 반환", () => {
    expect(filterByDestination(items, "일본").map((i) => i.id)).toEqual(["a", "c"]);
  });
});

describe("buildRegionTabs", () => {
  it("'전체' 를 맨 앞에 두고 distinct 라벨을 붙인다", () => {
    expect(
      buildRegionTabs([
        { label: "일본" },
        { label: "베트남" },
        { label: "일본" },
      ]),
    ).toEqual(["전체", "일본", "베트남"]);
  });
});
