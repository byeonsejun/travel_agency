import { describe, it, expect } from "vitest";
import {
  MAX_COMPARE,
  parseCompareIds,
  serializeCompareIds,
  addCompareId,
  removeCompareId,
  isInCompare,
} from "../compareIds";

describe("MAX_COMPARE", () => {
  it("최대 비교 개수는 3개로 고정", () => {
    expect(MAX_COMPARE).toBe(3);
  });
});

describe("parseCompareIds", () => {
  it("undefined / null / 빈 문자열은 빈 배열", () => {
    expect(parseCompareIds(undefined)).toEqual([]);
    expect(parseCompareIds("")).toEqual([]);
    expect(parseCompareIds(null as unknown as string)).toEqual([]);
  });

  it("단일 id 문자열", () => {
    expect(parseCompareIds("abc")).toEqual(["abc"]);
  });

  it("쉼표 구분 다중 id", () => {
    expect(parseCompareIds("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("4개 이상은 MAX_COMPARE 만큼 자름", () => {
    expect(parseCompareIds("a,b,c,d,e")).toEqual(["a", "b", "c"]);
  });

  it("빈 토큰(연속 쉼표, trailing comma)은 무시", () => {
    expect(parseCompareIds("a,,b,")).toEqual(["a", "b"]);
  });

  it("중복은 첫 등장만 유지", () => {
    expect(parseCompareIds("a,b,a,c")).toEqual(["a", "b", "c"]);
  });

  it("배열 입력도 처리 (Next searchParams가 string[]일 때)", () => {
    expect(parseCompareIds(["a", "b"])).toEqual(["a", "b"]);
  });
});

describe("addCompareId", () => {
  it("새 id 추가", () => {
    expect(addCompareId(["a", "b"], "c")).toEqual(["a", "b", "c"]);
  });

  it("이미 있는 id 는 no-op", () => {
    expect(addCompareId(["a", "b"], "a")).toEqual(["a", "b"]);
  });

  it("MAX_COMPARE 도달 시 추가 거부 (no-op)", () => {
    expect(addCompareId(["a", "b", "c"], "d")).toEqual(["a", "b", "c"]);
  });
});

describe("removeCompareId", () => {
  it("존재하는 id 제거", () => {
    expect(removeCompareId(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("없는 id 는 no-op", () => {
    expect(removeCompareId(["a"], "z")).toEqual(["a"]);
  });
});

describe("serializeCompareIds", () => {
  it("빈 배열은 빈 문자열", () => {
    expect(serializeCompareIds([])).toBe("");
  });

  it("쉼표 join", () => {
    expect(serializeCompareIds(["a", "b"])).toBe("a,b");
  });
});

describe("isInCompare", () => {
  it("포함 여부 boolean", () => {
    expect(isInCompare(["a", "b"], "b")).toBe(true);
    expect(isInCompare(["a", "b"], "z")).toBe(false);
  });
});
