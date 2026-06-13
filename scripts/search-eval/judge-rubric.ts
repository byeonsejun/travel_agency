/**
 * judge-rubric.ts — LLM-as-judge 관련성 루브릭 (라벨 생성 프롬프트 SSOT).
 *
 * 🛑 반순환 원칙(Non-circular): 이 루브릭은 상품의 **속성**(목적지·태그·요약·기간·가격)을
 *    사용자 의도에 비추어 판정한다. 임베딩/코사인 유사도/벡터 점수를 **절대** 판정 근거로
 *    삼지 않는다 — 판정이 스코어 공식(scoreReplica/SQL)과 독립이어야 nDCG가 "공식이
 *    의도를 얼마나 잘 반영하나"를 정직하게 측정한다(순환논증 회피, 설계 §3·전제).
 *    judgeRubric.test.ts가 프롬프트에 금칙어(embedding/cosine/vector)가 없음을 강제.
 *
 * 출력 계약: 입력 상품 title → 0~3 정수. 모든 상품을 정확히 한 번씩 채점.
 * 결정론: temperature 0 + 고정 루브릭. RUBRIC_VERSION 변경 시 라벨 스냅샷 재생성.
 */

/** 루브릭 개정 버전 — 라벨 스냅샷 meta에 박제(재현·드리프트 추적). */
export const RUBRIC_VERSION = "v1";

/** 판정 대상 상품의 속성 뷰(임베딩 제외 — judge는 의미 벡터를 보지 않는다). */
export interface JudgeProductView {
  title: string;
  destination: string;
  tags: string[];
  summary: string;
  durationNights: number;
  basePriceAdult: number;
}

/**
 * 0~3 관련성 루브릭 시스템 프롬프트. 여행 도메인 전문가 페르소나로
 * "이 상품이 사용자 의도를 얼마나 충족하나"를 등급화한다.
 */
export const JUDGE_SYSTEM_PROMPT = [
  "너는 여행 상품 검색의 관련성 평가 전문가다.",
  "사용자 검색 의도와 각 후보 상품의 속성(목적지·테마태그·요약·기간·가격)을 비교해,",
  "상품이 그 의도를 얼마나 잘 충족하는지 0~3 정수로 등급한다.",
  "",
  "등급 기준:",
  "  3 (완벽): 의도의 핵심 축을 모두 충족. 사용자가 1순위로 보길 기대하는 상품.",
  "  2 (좋음): 핵심 의도를 대체로 충족하나 일부 축이 약하거나 부분적.",
  "  1 (약간): 한 축만 걸치거나 느슨하게 관련. 있어도 되지만 상위는 아님.",
  "  0 (무관): 의도와 무관하거나 제약(기간·가격·지역)을 위배.",
  "",
  "판정 규칙:",
  "  - 오직 상품 속성과 사용자 의도의 의미적 부합만으로 판정한다.",
  "  - 지역 의도가 있으면 목적지 부합을 우선 고려(예: '동남아'는 태국·베트남·인니·필리핀).",
  "  - 테마 의도가 있으면 테마태그·요약의 부합을 고려(다중 테마는 더 많이 맞을수록 높게).",
  "  - 기간/가격 제약이 명시되면 이를 위배하는 상품은 0으로 강등한다.",
  "  - 추상적/무신호 의도('조용히 쉬고 싶어' 등)는 요약·테마의 분위기로 의미 추론한다.",
  "  - 후보 풀 내 상대평가가 아니라 의도 충족도의 절대 등급을 부여한다.",
  "  - 확신이 없으면 보수적으로 낮춰 잡는다(거짓 양성 억제).",
  "",
  "응답 형식: JSON만. {\"labels\":{\"<상품 title>\":<0~3 정수>, ...}}.",
  "입력의 모든 상품 title을 정확히 한 번씩 포함하고, 설명·코드블록을 쓰지 마라.",
].join("\n");

/** 한 쿼리에 대한 judge 호출 user payload(JSON 문자열) 조립. */
export function buildJudgeUserPayload(
  query: string,
  intent: string,
  products: JudgeProductView[],
): string {
  return JSON.stringify({
    query,
    intentHint: intent,
    candidates: products.map((p) => ({
      title: p.title,
      destination: p.destination,
      tags: p.tags,
      summary: p.summary,
      durationNights: p.durationNights,
      priceKRW: p.basePriceAdult,
    })),
  });
}
