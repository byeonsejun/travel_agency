/**
 * router.test.ts — 자연어 쿼리 라우터 (M-AI-SEARCH Task 4, spec §4)
 *
 * 검증 축:
 *  1. 금액 추출 — "20만원 이하" → priceMax 200000
 *  2. 기간 추출 — "3박4일" → durationNights {min:3,max:3}
 *  3. 테마 추출 — 키워드/태그 사전 매칭, 중복 제거
 *  4. 미매칭 폴백 — 신호 없으면 필터 없음 + cleanedQuery = q
 *  5. cleanedQuery — 금액/기간 토큰 제거 후 정제(임베딩용)
 *  6. routeQuery — 비-프로덕션(test)은 규칙 추출기 경로(외부 호출 0)
 *
 * env는 import 시점 파싱되므로 비-프로덕션만 모킹 (embedding.test.ts와 동일).
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@/shared/lib/env", () => ({
  env: { NODE_ENV: "test", ANTHROPIC_API_KEY: undefined },
}));

import { ruleBasedRoute, routeQuery } from "../router";

describe("ruleBasedRoute — 금액 추출", () => {
  it("'20만원 이하' → priceMax 200000", () => {
    const r = ruleBasedRoute("20만원 이하 여행");
    expect(r.priceMax).toBe(200000);
  });

  it("'150만원' → priceMax 1500000", () => {
    expect(ruleBasedRoute("150만원 유럽").priceMax).toBe(1500000);
  });

  it("금액 표현이 없으면 priceMax는 undefined", () => {
    expect(ruleBasedRoute("제주 힐링").priceMax).toBeUndefined();
  });
});

describe("ruleBasedRoute — 기간 추출", () => {
  it("'3박4일' → durationNights {min:3,max:3}", () => {
    expect(ruleBasedRoute("3박4일 패키지").durationNights).toEqual({
      min: 3,
      max: 3,
    });
  });

  it("'5박' 단독도 인식한다", () => {
    expect(ruleBasedRoute("유럽 5박 일주").durationNights).toEqual({
      min: 5,
      max: 5,
    });
  });

  it("기간 표현이 없으면 durationNights는 undefined", () => {
    expect(ruleBasedRoute("방콕 자유여행").durationNights).toBeUndefined();
  });
});

describe("ruleBasedRoute — 테마 추출", () => {
  it("키워드를 정규 태그로 매핑하고 중복 제거한다", () => {
    const r = ruleBasedRoute("부모님 동반 온천 여행");
    expect(r.themeTags).toEqual(
      expect.arrayContaining(["부모님", "온천"])
    );
    expect(new Set(r.themeTags).size).toBe(r.themeTags?.length);
  });

  it("동의어를 정규 태그로 정규화한다 (신혼 → 허니문)", () => {
    expect(ruleBasedRoute("신혼 리조트").themeTags).toEqual(
      expect.arrayContaining(["허니문", "리조트"])
    );
  });

  it("테마 키워드가 없으면 themeTags는 undefined", () => {
    expect(ruleBasedRoute("어딘가 멋진 곳").themeTags).toBeUndefined();
  });
});

describe("ruleBasedRoute — cleanedQuery", () => {
  it("금액/기간 토큰을 제거한 정제 텍스트를 만든다", () => {
    const r = ruleBasedRoute("20만원 이하 3박4일 가족 온천");
    expect(r.cleanedQuery).not.toMatch(/만원/);
    expect(r.cleanedQuery).not.toMatch(/박/);
    expect(r.cleanedQuery).toContain("가족");
    expect(r.cleanedQuery.length).toBeGreaterThan(0);
  });

  it("신호가 전혀 없으면 cleanedQuery = q(trim)", () => {
    expect(ruleBasedRoute("  바다가 보고 싶다  ").cleanedQuery).toBe(
      "바다가 보고 싶다"
    );
  });

  it("토큰만 있고 잔여가 비면 cleanedQuery는 원본 q로 폴백", () => {
    const r = ruleBasedRoute("3박4일");
    expect(r.cleanedQuery).toBe("3박4일");
  });
});

describe("routeQuery — NODE_ENV 분기", () => {
  it("비-프로덕션(test)은 규칙 추출기 결과를 반환한다", async () => {
    const r = await routeQuery("20만원 이하 온천");
    expect(r.priceMax).toBe(200000);
    expect(r.themeTags).toEqual(expect.arrayContaining(["온천"]));
  });
});
