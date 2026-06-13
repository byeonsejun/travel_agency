/**
 * types.ts — search-eval fixture 데이터 계약.
 * corpus.fixture.json / queries.fixture.json 의 행 형태.
 */

/** 코퍼스 상품 1건(실 임베딩 박제). tags는 ProductTag.tag 저장형(정규화 형태). */
export interface CorpusProduct {
  title: string;            // 안정 키(slug 부재 → title 사용)
  destination: string;      // 예: "오사카, 일본"
  summary: string;
  tags: string[];           // ProductTag.tag 저장형 배열
  basePriceAdult: number;   // 원 단위 정수(hard filter)
  durationNights: number;   // hard filter
  embedding: number[];      // 1536-dim
}

/** golden 쿼리 1건(routeQuery 결과 + 실 임베딩 박제). */
export interface GoldenQuery {
  query: string;                                  // 원본 쿼리(라벨 조인 키)
  cleanedQuery: string;                           // 임베딩/키워드 매칭용 정제문
  themeTags: string[];                            // toStorageTag 정규화된 태그
  geoTerms: string[];                             // gazetteer 확장 지리어
  priceMax?: number;
  durationNights?: { min?: number; max?: number };
  embedding: number[];                            // 1536-dim (cleanedQuery 임베딩)
}

/** 재정렬 순서 스냅샷 1건 — 쿼리 → 재정렬된 코퍼스 title 순서(corpus는 title이 키). */
export interface RerankSnapshot {
  query: string;
  rerankedTitles: string[];
}

/**
 * LLM-as-judge 라벨 스냅샷 — judge.ts가 생성, run-eval(--catalog)이 소비.
 * labels[query][title] = 0~3 (생략된 title은 0). meta로 재현·드리프트 추적.
 */
export interface JudgeLabelSnapshot {
  meta: {
    model: string; // 판정 LLM(예: claude-haiku-4-5-20251001)
    rubricVersion: string; // judge-rubric.ts RUBRIC_VERSION
    generatedAt: string; // ISO8601
    corpusTitlesHash: string; // 코퍼스 title 집합 해시(코퍼스 변경 감지)
    queryCount: number;
  };
  labels: Record<string, Record<string, number>>;
}
