/**
 * schemas.test.ts — 검색 입력·라우팅 결과 Zod 스키마 (M-AI-SEARCH Task 3)
 *
 * 검증 축 (spec §4.1 / D7):
 *  1. SearchParamsSchema — q trim, 빈 문자열·과길이 거부
 *  2. RoutedQuerySchema — 정상 구조 파싱, 필드 단위 .catch 무필터 폴백
 *  3. parseRoutedQuery — 전체 실패 시 필터 없이 cleanedQuery=q 폴백
 *     (LLM 비결정성·악성 입력 방어 — 항상 검색 가능)
 */

import { describe, it, expect } from "vitest";
import {
  SearchParamsSchema,
  RoutedQuerySchema,
  parseRoutedQuery,
} from "../schemas";

describe("SearchParamsSchema", () => {
  it("앞뒤 공백을 trim한다", () => {
    const r = SearchParamsSchema.parse({ q: "  오사카 여행  " });
    expect(r.q).toBe("오사카 여행");
  });

  it("빈 문자열(공백뿐)은 거부한다", () => {
    expect(SearchParamsSchema.safeParse({ q: "   " }).success).toBe(false);
  });

  it("200자 초과는 거부한다", () => {
    expect(
      SearchParamsSchema.safeParse({ q: "가".repeat(201) }).success
    ).toBe(false);
  });
});

describe("RoutedQuerySchema — 정상 파싱", () => {
  it("완전한 라우팅 결과를 파싱한다", () => {
    const r = RoutedQuerySchema.parse({
      priceMax: 200000,
      durationNights: { min: 3, max: 3 },
      themeTags: ["온천", "가족"],
      cleanedQuery: "온천 가족 여행",
    });
    expect(r.priceMax).toBe(200000);
    expect(r.durationNights).toEqual({ min: 3, max: 3 });
    expect(r.themeTags).toEqual(["온천", "가족"]);
    expect(r.cleanedQuery).toBe("온천 가족 여행");
  });

  it("필터 없는 최소 결과(cleanedQuery만)도 유효하다", () => {
    const r = RoutedQuerySchema.parse({ cleanedQuery: "제주 한달살기" });
    expect(r.priceMax).toBeUndefined();
    expect(r.themeTags).toBeUndefined();
  });
});

describe("RoutedQuerySchema — 필드 단위 .catch 무필터 폴백", () => {
  it("priceMax가 잘못된 타입이면 undefined로 떨어지고 cleanedQuery는 유지된다", () => {
    const r = RoutedQuerySchema.parse({
      priceMax: "비쌈", // 잘못된 타입
      cleanedQuery: "유럽 여행",
    });
    expect(r.priceMax).toBeUndefined();
    expect(r.cleanedQuery).toBe("유럽 여행");
  });

  it("durationNights 구조가 깨져도 undefined로 폴백된다", () => {
    const r = RoutedQuerySchema.parse({
      durationNights: "3박4일",
      cleanedQuery: "온천",
    });
    expect(r.durationNights).toBeUndefined();
  });

  it("cleanedQuery가 없으면 전체 파싱은 실패한다", () => {
    expect(RoutedQuerySchema.safeParse({ priceMax: 100000 }).success).toBe(
      false
    );
  });
});

describe("parseRoutedQuery — 전체 폴백", () => {
  it("파싱 불가능한 raw면 필터 없이 cleanedQuery=q(trim)로 폴백한다", () => {
    const r = parseRoutedQuery("not json at all", "  부모님 온천  ");
    expect(r).toEqual({ cleanedQuery: "부모님 온천" });
  });

  it("정상 raw는 그대로 파싱한다", () => {
    const r = parseRoutedQuery(
      { priceMax: 150000, cleanedQuery: "방콕" },
      "방콕 15만원"
    );
    expect(r.priceMax).toBe(150000);
    expect(r.cleanedQuery).toBe("방콕");
  });

  it("부분 손상 raw는 손상 필드만 버리고 나머지는 유지한다", () => {
    const r = parseRoutedQuery(
      { priceMax: -5, themeTags: ["온천"], cleanedQuery: "온천 여행" },
      "온천 여행"
    );
    expect(r.priceMax).toBeUndefined(); // 음수 → catch
    expect(r.themeTags).toEqual(["온천"]);
    expect(r.cleanedQuery).toBe("온천 여행");
  });
});
