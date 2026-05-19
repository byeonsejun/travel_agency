/**
 * geo.test.ts — 지리 계층 사전 + 쿼리 확장 (M-AI-SEARCH geo taxonomy)
 *
 * 검증 축: 사용자의 "국가 vs 권역" 의도 비대칭을 사전이 흡수하는가.
 *  1. 권역어("동남아")  → 하위 국가·도시 전체로 확장 (broad recall)
 *  2. 국가/권역 앵커("일본") → 그 나라 도시 전체로 확장
 *  3. 국가어("태국")    → 자기 + 하위 도시로 확장 (drill-down)
 *  4. 도시어("방콕")    → 자기만 (precision — 발리를 끌어오면 안 됨)
 *  5. 지리 신호 없음     → 빈 배열 (geo 부스트 비활성)
 */

import { describe, it, expect } from "vitest";
import { expandGeoTerms } from "../geo";

describe("expandGeoTerms — 권역어 확장 (region-first)", () => {
  it("'동남아'는 동남아 국가·도시 전체로 확장된다", () => {
    const t = expandGeoTerms("동남아 가성비 휴양");
    expect(t).toEqual(
      expect.arrayContaining(["태국", "베트남", "인도네시아", "필리핀"])
    );
    expect(t).toEqual(
      expect.arrayContaining(["방콕", "다낭", "발리", "세부"])
    );
    // 다른 권역(일본)은 섞이지 않는다
    expect(t).not.toContain("도쿄");
  });

  it("'유럽'은 유럽 국가·도시로 확장된다", () => {
    const t = expandGeoTerms("유럽 일주");
    expect(t).toEqual(
      expect.arrayContaining(["프랑스", "이탈리아", "스위스", "파리", "로마"])
    );
    expect(t).not.toContain("발리");
  });
});

describe("expandGeoTerms — 국가 앵커/국가어", () => {
  it("'일본'은 일본 도시 전체로 확장된다 (country-first 앵커)", () => {
    const t = expandGeoTerms("일본 온천 여행");
    expect(t).toEqual(
      expect.arrayContaining(["일본", "도쿄", "오사카", "교토", "하코네"])
    );
    expect(t).not.toContain("방콕");
  });

  it("'태국'은 자기 + 태국 도시로 확장된다 (drill-down)", () => {
    const t = expandGeoTerms("태국 자유여행");
    expect(t).toEqual(expect.arrayContaining(["태국", "방콕", "푸켓"]));
    // 다른 동남아 국가까지 끌어오지 않는다 (국가 단위 정밀)
    expect(t).not.toContain("발리");
  });
});

describe("expandGeoTerms — 도시어 정밀 / 미매칭", () => {
  it("'방콕' 단독은 방콕만 (발리·세부 끌어오지 않음)", () => {
    const t = expandGeoTerms("방콕 3박");
    expect(t).toContain("방콕");
    expect(t).not.toContain("발리");
    expect(t).not.toContain("태국"); // 도시→국가 역확장 안 함
  });

  it("지리 신호가 없으면 빈 배열", () => {
    expect(expandGeoTerms("따뜻한 효도 여행")).toEqual([]);
  });
});
