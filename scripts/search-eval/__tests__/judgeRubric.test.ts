/**
 * judgeRubric.test.ts — judge 반순환 가드 + 순수 헬퍼 (오프라인, 키·네트워크 0).
 *
 * 핵심: 루브릭이 임베딩/코사인/벡터 유사도를 판정 근거로 삼지 않음을 강제.
 * judge가 스코어 공식과 독립이라야 nDCG가 가중치 우열을 정직히 측정(순환논증 회피).
 */
import { describe, it, expect } from "vitest";
import {
  JUDGE_SYSTEM_PROMPT,
  buildJudgeUserPayload,
  type JudgeProductView,
} from "../judge-rubric";
import { normalizeLabels, agreementCells, corpusTitlesHash } from "../judge";

describe("judge 루브릭 반순환 가드", () => {
  it("시스템 프롬프트가 임베딩/코사인/벡터 유사도를 언급하지 않는다", () => {
    const forbidden = /임베딩|embedding|코사인|cosine|벡터|vector|유사도/i;
    expect(JUDGE_SYSTEM_PROMPT).not.toMatch(forbidden);
  });

  it("프롬프트는 속성(목적지·테마·요약·기간·가격) 기반 판정을 지시한다", () => {
    expect(JUDGE_SYSTEM_PROMPT).toContain("목적지");
    expect(JUDGE_SYSTEM_PROMPT).toContain("0~3");
  });

  it("user payload에 임베딩/벡터 필드가 새지 않는다", () => {
    const products: JudgeProductView[] = [
      {
        title: "발리 가성비 4박6일",
        destination: "발리, 인도네시아",
        tags: ["#가성비", "#휴양"],
        summary: "휴양 위주",
        durationNights: 4,
        basePriceAdult: 990000,
      },
    ];
    const payload = JSON.parse(buildJudgeUserPayload("휴양", "theme 휴양", products));
    expect(payload.candidates[0]).not.toHaveProperty("embedding");
    expect(payload.candidates[0]).toHaveProperty("destination");
    expect(payload.candidates[0]).toHaveProperty("tags");
    expect(payload.query).toBe("휴양");
  });
});

describe("normalizeLabels", () => {
  const valid = new Set(["A", "B", "C"]);

  it("0~3으로 클램프 + 반올림", () => {
    expect(normalizeLabels({ A: 5, B: 2.4, C: 1.6 }, valid)).toEqual({ A: 3, B: 2, C: 2 });
  });

  it("0(무관)은 생략(수작업 라벨 컨벤션)", () => {
    expect(normalizeLabels({ A: 0, B: 3 }, valid)).toEqual({ B: 3 });
  });

  it("코퍼스에 없는 환각 title 무시", () => {
    expect(normalizeLabels({ A: 2, Z: 3 }, valid)).toEqual({ A: 2 });
  });

  it("음수는 0으로 클램프되어 생략", () => {
    expect(normalizeLabels({ A: -1, B: 1 }, valid)).toEqual({ B: 1 });
  });
});

describe("agreementCells", () => {
  it("비-0 합집합 위에서 exact/within1/meanAbs 산출", () => {
    const hand = { A: 3, B: 2, C: 1 };
    const judge = { A: 3, B: 1, D: 2 }; // C는 judge 0, D는 hand 0
    const r = agreementCells(hand, judge);
    expect(r.total).toBe(4); // A,B,C,D 합집합
    expect(r.exact).toBe(1); // A만 동일(3=3)
    // |A:0|,|B:1|,|C:1|,|D:2| → within1 = A,B,C = 3
    expect(r.within1).toBe(3);
    expect(r.sumAbs).toBe(0 + 1 + 1 + 2);
  });

  it("완전 일치면 exact == total", () => {
    const m = { A: 3, B: 1 };
    const r = agreementCells(m, m);
    expect(r.exact).toBe(r.total);
    expect(r.sumAbs).toBe(0);
  });
});

describe("corpusTitlesHash", () => {
  it("순서 무관 결정론(정렬 후 해시)", () => {
    expect(corpusTitlesHash(["A", "B", "C"])).toBe(corpusTitlesHash(["C", "A", "B"]));
  });

  it("내용이 다르면 해시가 다르다", () => {
    expect(corpusTitlesHash(["A", "B"])).not.toBe(corpusTitlesHash(["A", "B", "C"]));
  });
});
