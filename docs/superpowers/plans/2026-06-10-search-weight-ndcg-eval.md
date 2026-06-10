# 검색 가중치 nDCG eval 하네스 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 현 검색 가중치(벡터 0.5 / 키워드 0.2 / geo 0.2 / 테마 0.1)를 실벡터 fixture + 수작업 등급 라벨 golden 셋으로 nDCG 정량 평가하고, 가중치 sweep으로 더 나은 후보를 리포트하는 오프라인 결정론 하네스를 구축한다.

**Architecture:** 실 임베딩(OpenAI)을 1회 추출해 JSON fixture로 박제 → 이후 eval은 키·DB·네트워크 0으로 완전 오프라인 실행. 프로덕션 SQL 스코어 공식을 순수 TS로 미러(`scoreReplica`)하되, 가중치 상수와 `themeBoost`는 `entities/product`의 단일 SSOT(`searchWeights.ts`)에서 import해 drift를 차단한다. 운영 가중치는 변경하지 않고 리포트만 한다(적용은 ADR 수동).

**Tech Stack:** TypeScript, tsx(스크립트 러너), Vitest, OpenAI `text-embedding-3-small`(1회), Prisma(추출 시 코퍼스 로드).

**참조 스펙:** `docs/superpowers/specs/2026-06-10-search-weight-ndcg-eval-design.md`

---

## File Structure

```
src/entities/product/
  model/searchWeights.ts          # 신규: SEARCH_WEIGHTS SSOT + themeBoost(ceiling 주입) — Task 1
  model/__tests__/searchWeights.test.ts   # 신규 — Task 1
  api/searchByVector.ts           # 수정: 상수/themeBoost를 searchWeights에서 import — Task 1
  index.ts                        # 수정: SEARCH_WEIGHTS/SearchWeights/themeBoost re-export — Task 1

scripts/search-eval/
  types.ts                        # CorpusProduct / GoldenQuery 타입 — Task 3
  scoreReplica.ts                 # SQL 스코어 순수 TS 미러 — Task 3
  ndcg.ts                         # nDCG@k 순수 수학 — Task 2
  golden-queries.ts               # 정답 셋(쿼리 + 수작업 등급 라벨) + CORPUS_TITLES — Task 4
  extract-fixtures.ts             # 1회용: OpenAI 임베딩 추출 → fixture JSON — Task 5
  corpus.fixture.json             # 박제(커밋) — Task 5
  queries.fixture.json            # 박제(커밋) — Task 5
  run-eval.ts                     # 러너: baseline / --sweep — Task 6
  __tests__/ndcg.test.ts          # Task 2
  __tests__/scoreReplica.test.ts  # Task 3
  __tests__/sweep.test.ts         # simplex 그리드 검증 — Task 6

package.json                      # 수정: "search:eval" 스크립트 — Task 6
```

---

## Task 1: SEARCH_WEIGHTS SSOT 추출 + themeBoost ceiling 주입 (동작 보존 리팩터)

현재 4개 가중치 상수와 `themeBoost`가 `searchByVector.ts`에 사적으로 박혀 있어 eval이 주입·재사용할 수 없다. 순수 모듈로 분리하고 `themeBoost`에 천장(ceiling) 파라미터를 추가해 sweep 시 테마 가중치도 주입 가능하게 한다. **운영 동작은 0 변화**(값 동일, 묶음만).

**Files:**
- Create: `src/entities/product/model/searchWeights.ts`
- Create: `src/entities/product/model/__tests__/searchWeights.test.ts`
- Modify: `src/entities/product/api/searchByVector.ts` (상수 41-44, themeBoost 58-62, buildGeoScore 113, buildThemeScore 134)
- Modify: `src/entities/product/index.ts` (배럴 re-export)

- [x] **Step 1: 기존 themeBoost import 사용처 파악**

Run: `grep -rn "themeBoost" src | grep -v searchByVector.ts`
Expected: import 하는 파일 목록 출력(테스트 등). 이후 Step에서 import 경로를 배럴(`@/entities/product`)로 맞춘다.

- [x] **Step 2: searchWeights.ts 작성 (SSOT)**

```ts
/**
 * searchWeights.ts — 하이브리드 검색 가중치 SSOT + 테마 부스트 공식.
 *
 * 가중치(합 1.0)와 themeBoost 공식의 단일 출처. searchByVector.ts의 SQL,
 * eval 하네스(scoreReplica)가 모두 여기를 import한다 → 3중 surface drift 차단.
 *
 * ⚠️ buildThemeScore(searchByVector.ts)의 SQL 산술이 themeBoost를 미러한다.
 *    한쪽을 바꾸면 반드시 다른 쪽도 갱신할 것.
 */

export interface SearchWeights {
  vector: number;
  keyword: number;
  geo: number;
  theme: number;
}

/** 운영 기본 가중치(합 1.0). 변경은 ADR 검토 후. */
export const SEARCH_WEIGHTS: SearchWeights = {
  vector: 0.5,
  keyword: 0.2,
  geo: 0.2,
  theme: 0.1,
};

/**
 * 테마 부스트 (graduated soft boost). 요청 태그 커버리지 비율 × 천장.
 *   requested ≤ 0 ? 0 : ceiling × (matchCount / requested)
 *
 * ceiling 기본값은 운영 가중치(SEARCH_WEIGHTS.theme). eval sweep은 가변
 * 천장을 주입한다. matchCount ∈ [0, requested] 보장(ProductTag @@unique)이라
 * 반환값은 [0, ceiling] — cap 불필요.
 */
export function themeBoost(
  matchCount: number,
  requested: number,
  ceiling: number = SEARCH_WEIGHTS.theme,
): number {
  // !(requested > 0)는 0·음수·NaN을 모두 차단.
  if (!(requested > 0)) return 0;
  return ceiling * (matchCount / requested);
}
```

- [x] **Step 3: searchWeights.test.ts 작성 (FAIL 예정)**

```ts
import { describe, it, expect } from "vitest";
import { SEARCH_WEIGHTS, themeBoost } from "../searchWeights";

describe("SEARCH_WEIGHTS", () => {
  it("운영 가중치는 0.5/0.2/0.2/0.1, 합은 1.0", () => {
    expect(SEARCH_WEIGHTS).toEqual({ vector: 0.5, keyword: 0.2, geo: 0.2, theme: 0.1 });
    const sum = SEARCH_WEIGHTS.vector + SEARCH_WEIGHTS.keyword + SEARCH_WEIGHTS.geo + SEARCH_WEIGHTS.theme;
    expect(sum).toBeCloseTo(1.0, 10);
  });
});

describe("themeBoost", () => {
  it("requested 0/음수/NaN은 0 반환", () => {
    expect(themeBoost(0, 0)).toBe(0);
    expect(themeBoost(3, -1)).toBe(0);
    expect(themeBoost(1, Number.NaN)).toBe(0);
  });

  it("기본 천장(0.1)으로 커버리지 비율 가산", () => {
    expect(themeBoost(1, 2)).toBeCloseTo(0.05, 10);
    expect(themeBoost(2, 2)).toBeCloseTo(0.1, 10);
  });

  it("ceiling 주입 시 가변 천장 적용(sweep 경로)", () => {
    expect(themeBoost(1, 2, 0.3)).toBeCloseTo(0.15, 10);
    expect(themeBoost(2, 2, 0.3)).toBeCloseTo(0.3, 10);
  });
});
```

- [x] **Step 4: 테스트 FAIL 확인**

Run: `npx vitest run src/entities/product/model/__tests__/searchWeights.test.ts`
Expected: FAIL — `Cannot find module '../searchWeights'` (Step 2 파일이 아직 인식 안 되거나 import 오류).

- [x] **Step 5: searchByVector.ts에서 상수/themeBoost 제거 + import 전환**

`searchByVector.ts` 상단 import에 추가:
```ts
import { SEARCH_WEIGHTS, themeBoost } from "../model/searchWeights";
export { themeBoost } from "../model/searchWeights";
```

기존 41-62줄의 `const VECTOR_WEIGHT … THEME_WEIGHT`와 `export function themeBoost(...) { ... }` 블록을 **삭제**한다.

`buildGeoScore`(약 113줄)의 `${GEO_WEIGHT}` → `${SEARCH_WEIGHTS.geo}`:
```ts
  return Prisma.sql`(CASE WHEN p.destination ILIKE ANY(${patterns}::text[])
                          THEN ${SEARCH_WEIGHTS.geo} ELSE 0 END)`;
```

`buildThemeScore`(약 134줄)의 `${THEME_WEIGHT}` → `${SEARCH_WEIGHTS.theme}`:
```ts
  return Prisma.sql`(${SEARCH_WEIGHTS.theme} * (
    SELECT count(*) FROM "ProductTag" pt
    WHERE pt."productId" = p.id AND pt.tag = ANY(${tags})
  )::float / ${tags.length})`;
```

메인 쿼리(약 256-260줄)의 `${VECTOR_WEIGHT}` → `${SEARCH_WEIGHTS.vector}`, `${KEYWORD_WEIGHT}` → `${SEARCH_WEIGHTS.keyword}`:
```ts
        (1 - (e.vector <=> ${vecLiteral}::vector)) * ${SEARCH_WEIGHTS.vector}
        + (CASE WHEN p.title ILIKE ${like}
                  OR p.destination ILIKE ${like}
                  OR p.summary ILIKE ${like}
                THEN ${SEARCH_WEIGHTS.keyword} ELSE 0 END)
```

- [x] **Step 6: 배럴 re-export 추가**

`src/entities/product/index.ts`의 `searchProductsByVector` export(58-59줄) 부근에 추가:
```ts
export { SEARCH_WEIGHTS } from "./model/searchWeights";
export type { SearchWeights } from "./model/searchWeights";
export { themeBoost } from "./model/searchWeights";
```
(`searchByVector.ts`가 `themeBoost`를 import하는 테스트가 있었다면 Step 1 결과에 따라 그 import를 `@/entities/product`로 변경.)

- [x] **Step 7: 전체 검증 (리팩터 무손상 확인)**

Run: `npx vitest run src/entities/product && npm run typecheck`
Expected: PASS — searchWeights 신규 테스트 + 기존 searchByVector 관련 테스트 전부 통과(동작 보존), 타입 에러 0.

- [x] **Step 8: 커밋**

```bash
git add src/entities/product/model/searchWeights.ts src/entities/product/model/__tests__/searchWeights.test.ts src/entities/product/api/searchByVector.ts src/entities/product/index.ts
git commit -m "refactor(product): extract SEARCH_WEIGHTS SSOT + themeBoost ceiling param

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: nDCG@k 순수 수학 모듈

DCG/IDCG/nDCG를 순수 함수로 구현. 외부 의존 0이라 fixture·키 없이 단독 테스트 가능.

**Files:**
- Create: `scripts/search-eval/ndcg.ts`
- Create: `scripts/search-eval/__tests__/ndcg.test.ts`

- [ ] **Step 1: ndcg.test.ts 작성 (FAIL 예정)**

```ts
import { describe, it, expect } from "vitest";
import { dcgAtK, ndcgAtK } from "../ndcg";

describe("dcgAtK", () => {
  it("랭크1=log2(2)=1로 나눠 첫 항은 (2^rel - 1)", () => {
    // rel=[3] → (2^3-1)/log2(2) = 7/1 = 7
    expect(dcgAtK([3], 1)).toBeCloseTo(7, 10);
  });

  it("k가 길이보다 크면 길이까지만 합산", () => {
    expect(dcgAtK([1, 1], 5)).toBeCloseTo(1 / Math.log2(2) + 1 / Math.log2(3), 10);
  });
});

describe("ndcgAtK", () => {
  it("이상 정렬은 1.0", () => {
    expect(ndcgAtK([3, 2, 1, 0], 4)).toBeCloseTo(1.0, 10);
  });

  it("역순 정렬은 1.0 미만", () => {
    expect(ndcgAtK([0, 1, 2, 3], 4)).toBeLessThan(1.0);
  });

  it("전부 무관(라벨 0)이면 IDCG 0 → 0 반환", () => {
    expect(ndcgAtK([0, 0, 0], 3)).toBe(0);
  });

  it("빈 결과는 0", () => {
    expect(ndcgAtK([], 5)).toBe(0);
  });

  it("@k는 상위 k만 평가(꼬리 무관항 무시)", () => {
    // 상위 3개가 이상정렬이면 뒤가 어떻든 nDCG@3 = 1.0
    expect(ndcgAtK([3, 2, 1, 0, 3], 3)).toBeCloseTo(1.0, 10);
  });
});
```

- [ ] **Step 2: 테스트 FAIL 확인**

Run: `npx vitest run scripts/search-eval/__tests__/ndcg.test.ts`
Expected: FAIL — `Cannot find module '../ndcg'`.

- [ ] **Step 3: ndcg.ts 구현**

```ts
/**
 * ndcg.ts — nDCG@k 순수 수학 (search-eval 하네스 전용).
 *
 * DCG@k  = Σ_{i=1..k} (2^rel_i − 1) / log2(i + 1)   (rel_i = 랭크 i 아이템 라벨)
 * IDCG@k = 동일 라벨 집합을 내림차순 정렬한 이상 DCG@k
 * nDCG@k = DCG@k / IDCG@k   (IDCG=0 이면 0)
 *
 * rankedRelevances: 점수 내림차순으로 정렬된 후보들의 관련성 라벨(0~3).
 */
export function dcgAtK(relevances: number[], k: number): number {
  let dcg = 0;
  const limit = Math.min(k, relevances.length);
  for (let i = 0; i < limit; i++) {
    // i는 0-index → 랭크(i+1) → 분모 log2((i+1)+1) = log2(i+2)
    dcg += (2 ** relevances[i] - 1) / Math.log2(i + 2);
  }
  return dcg;
}

export function ndcgAtK(rankedRelevances: number[], k: number): number {
  const dcg = dcgAtK(rankedRelevances, k);
  const ideal = [...rankedRelevances].sort((a, b) => b - a);
  const idcg = dcgAtK(ideal, k);
  return idcg === 0 ? 0 : dcg / idcg;
}
```

- [ ] **Step 4: 테스트 PASS 확인**

Run: `npx vitest run scripts/search-eval/__tests__/ndcg.test.ts`
Expected: PASS (6 케이스).

- [ ] **Step 5: 커밋**

```bash
git add scripts/search-eval/ndcg.ts scripts/search-eval/__tests__/ndcg.test.ts
git commit -m "feat(search-eval): nDCG@k pure math module

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: 스코어 미러(scoreReplica) + drift 가드

SQL 하이브리드 공식을 순수 TS로 1:1 복제. 가중치/themeBoost는 Task 1 SSOT 재사용.

**Files:**
- Create: `scripts/search-eval/types.ts`
- Create: `scripts/search-eval/scoreReplica.ts`
- Create: `scripts/search-eval/__tests__/scoreReplica.test.ts`

- [ ] **Step 1: types.ts 작성 (fixture 데이터 계약)**

```ts
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
```

- [ ] **Step 2: scoreReplica.test.ts 작성 (FAIL 예정, drift 핀)**

```ts
import { describe, it, expect } from "vitest";
import { cosineSim, scoreCandidate, rankCandidates } from "../scoreReplica";
import type { CorpusProduct, GoldenQuery } from "../types";
import { SEARCH_WEIGHTS } from "@/entities/product";

describe("cosineSim", () => {
  it("동일 단위벡터는 1.0", () => {
    expect(cosineSim([1, 0], [1, 0])).toBeCloseTo(1.0, 10);
  });
  it("직교 벡터는 0", () => {
    expect(cosineSim([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });
  it("정규화 안 된 동방향 벡터도 1.0(노름으로 나눔)", () => {
    expect(cosineSim([2, 0], [5, 0])).toBeCloseTo(1.0, 10);
  });
});

const product: CorpusProduct = {
  title: "테스트 상품",
  destination: "오사카, 일본",
  summary: "가족 온천 여행",
  tags: ["#가족", "#온천"],
  basePriceAdult: 800000,
  durationNights: 3,
  embedding: [1, 0],
};

const query: GoldenQuery = {
  query: "오사카 가족 온천",
  cleanedQuery: "오사카",          // destination에 부분일치 → 키워드 적중
  themeTags: ["#가족", "#온천"],   // 2/2 적중
  geoTerms: ["오사카"],            // destination 적중
  embedding: [1, 0],               // cosine = 1
};

describe("scoreCandidate (drift 핀)", () => {
  it("모든 시그널 만점 + 운영 가중치 → 1.0", () => {
    // cosine1×0.5 + kw0.2 + geo0.2 + theme(2/2×0.1)=0.1 = 1.0
    expect(scoreCandidate(product, query, SEARCH_WEIGHTS)).toBeCloseTo(1.0, 10);
  });

  it("테마 천장은 주입 가중치를 따른다(sweep)", () => {
    const w = { vector: 0.4, keyword: 0.2, geo: 0.2, theme: 0.2 };
    // 0.4 + 0.2 + 0.2 + (2/2×0.2)=0.2 = 1.0
    expect(scoreCandidate(product, query, w)).toBeCloseTo(1.0, 10);
  });

  it("부분 테마 커버리지는 비율 가산", () => {
    const q2: GoldenQuery = { ...query, themeTags: ["#가족", "#설경"] }; // 1/2 적중
    // cosine0.5 + kw0.2 + geo0.2 + (1/2×0.1)=0.05 = 0.95
    expect(scoreCandidate(product, q2, SEARCH_WEIGHTS)).toBeCloseTo(0.95, 10);
  });
});

describe("rankCandidates", () => {
  it("hard filter: priceMax 초과 상품 배제", () => {
    const q3: GoldenQuery = { ...query, priceMax: 500000 };
    expect(rankCandidates([product], q3, SEARCH_WEIGHTS)).toHaveLength(0);
  });

  it("hard filter: durationNights는 max+1까지 허용(±1박)", () => {
    const q4: GoldenQuery = { ...query, durationNights: { min: 2, max: 2 } };
    // 상품 3박 ≤ max(2)+1=3 → 통과
    expect(rankCandidates([product], q4, SEARCH_WEIGHTS)).toHaveLength(1);
  });

  it("점수 내림차순 정렬", () => {
    const low: CorpusProduct = { ...product, title: "무관 상품", destination: "파리, 프랑스", summary: "", tags: [], embedding: [0, 1] };
    const ranked = rankCandidates([low, product], query, SEARCH_WEIGHTS);
    expect(ranked[0].title).toBe("테스트 상품");
  });
});
```

- [ ] **Step 3: 테스트 FAIL 확인**

Run: `npx vitest run scripts/search-eval/__tests__/scoreReplica.test.ts`
Expected: FAIL — `Cannot find module '../scoreReplica'`.

- [ ] **Step 4: scoreReplica.ts 구현**

```ts
/**
 * scoreReplica.ts — searchByVector SQL 하이브리드 공식의 순수 TS 미러.
 *
 * SQL(entities/product/api/searchByVector.ts)의 점수식을 1:1 복제:
 *   score = cosine×W.vector + keyword×W.keyword + geo×W.geo + themeBoost(...,W.theme)
 * 가중치·themeBoost는 entities/product SSOT를 재사용(drift 차단).
 *
 * ⚠️ SQL 공식을 바꾸면 여기도 갱신할 것. drift 가드는 scoreReplica.test.ts.
 */
import { SEARCH_WEIGHTS, themeBoost, type SearchWeights } from "@/entities/product";
import type { CorpusProduct, GoldenQuery } from "./types";

/** 코사인 유사도 = dot / (‖a‖·‖b‖). 정규화 가정하지 않음(SQL 1-(v<=>q) 동치). */
export function cosineSim(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/** title|destination|summary 중 하나라도 cleanedQuery 부분일치(ILIKE 복제). */
function matchesKeyword(p: CorpusProduct, cleanedQuery: string): boolean {
  const kw = cleanedQuery.trim().toLowerCase();
  if (kw.length === 0) return false;
  return [p.title, p.destination, p.summary].some((f) =>
    f.toLowerCase().includes(kw),
  );
}

/** geoTerms 중 하나라도 destination 부분일치(ILIKE ANY 복제). */
function matchesGeo(p: CorpusProduct, geoTerms: string[]): boolean {
  const dest = p.destination.toLowerCase();
  return geoTerms.some((t) => dest.includes(t.toLowerCase()));
}

/** price/duration hard filter (SQL WHERE 미러, duration은 max+1박 허용). */
function passesFilters(p: CorpusProduct, q: GoldenQuery): boolean {
  if (q.priceMax !== undefined && p.basePriceAdult > q.priceMax) return false;
  const d = q.durationNights;
  if (d?.min !== undefined && p.durationNights < d.min) return false;
  if (d?.max !== undefined && p.durationNights > d.max + 1) return false;
  return true;
}

/** 단일 후보 하이브리드 점수. */
export function scoreCandidate(
  p: CorpusProduct,
  q: GoldenQuery,
  w: SearchWeights,
): number {
  const vec = cosineSim(q.embedding, p.embedding) * w.vector;
  const kw = matchesKeyword(p, q.cleanedQuery) ? w.keyword : 0;
  const geo = matchesGeo(p, q.geoTerms) ? w.geo : 0;
  const matchCount = q.themeTags.filter((t) => p.tags.includes(t)).length;
  const theme = themeBoost(matchCount, q.themeTags.length, w.theme);
  return vec + kw + geo + theme;
}

export interface RankedItem {
  title: string;
  score: number;
}

/** 필터 통과 후보를 점수 내림차순 랭킹. */
export function rankCandidates(
  corpus: CorpusProduct[],
  q: GoldenQuery,
  w: SearchWeights = SEARCH_WEIGHTS,
): RankedItem[] {
  return corpus
    .filter((p) => passesFilters(p, q))
    .map((p) => ({ title: p.title, score: scoreCandidate(p, q, w) }))
    .sort((a, b) => b.score - a.score);
}
```

- [ ] **Step 5: 테스트 PASS 확인**

Run: `npx vitest run scripts/search-eval/__tests__/scoreReplica.test.ts`
Expected: PASS (cosineSim 3 + scoreCandidate 3 + rankCandidates 3).

- [ ] **Step 6: 커밋**

```bash
git add scripts/search-eval/types.ts scripts/search-eval/scoreReplica.ts scripts/search-eval/__tests__/scoreReplica.test.ts
git commit -m "feat(search-eval): TS score replica mirroring search SQL formula

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Golden-query 셋 (쿼리 + 수작업 등급 라벨)

10개 쿼리 + 9개 코퍼스 상품에 대한 0~3 등급 라벨. 라벨은 코드 상수(diff·리뷰 추적). title을 키로 사용. 라벨 값은 **초안**이며 Task 5 추출 후 실제 태그를 보고 보정한다.

> 스펙 §5의 예시 쿼리 "100만원 이하 3박 유럽"은 코퍼스 유럽 상품이 8~9박이라 기간 필터(max+1=4박)로 전멸 → 코퍼스 정합 쿼리 "3박4일 일본 여행"(기간 필터 + geo)으로 대체.

**Files:**
- Create: `scripts/search-eval/golden-queries.ts`

- [ ] **Step 1: golden-queries.ts 작성**

```ts
/**
 * golden-queries.ts — nDCG eval 정답 셋(ground truth).
 *
 * 각 쿼리에 대해 코퍼스 9개 상품의 관련성을 0~3으로 수작업 라벨:
 *   3=완벽 · 2=좋음 · 1=약간 · 0=무관 (labels에 없는 title은 0으로 간주).
 * 의도 유형을 고르게 섞어 특정 시그널 과대평가를 방지(설계 §5).
 * title을 키로 사용(Product slug 부재).
 *
 * ⚠️ 라벨은 Task 5(fixture 추출) 후 실제 상품 태그/destination을 보고
 *    보정된 값이다. 코퍼스·쿼리 변경 시 재검토.
 */

/** 코퍼스(시드 PUBLISHED 9건). extract-fixtures가 이 목록으로 필터링. */
export const CORPUS_TITLES = [
  "오사카·교토 3박4일 자유일정",
  "도쿄·하코네 온천 4박5일",
  "다낭·호이안 5박6일 노쇼핑",
  "푸켓 풀빌라 허니문 5박7일",
  "파리·로마 핵심 8박9일",
  "스위스 알프스 9박10일",
  "발리 가성비 4박6일",
  "세부 가족여행 4박5일",
  "후쿠오카 미식 3박4일",
] as const;

export interface GoldenCase {
  query: string;
  intent: string;                     // 검증 표적(문서용)
  labels: Record<string, number>;     // title → 0~3 (생략 시 0)
}

export const GOLDEN_QUERIES: GoldenCase[] = [
  {
    query: "가족과 함께하는 오사카 주말 여행",
    intent: "복합(theme 가족 + geo 오사카 + 근거리)",
    labels: {
      "오사카·교토 3박4일 자유일정": 3,
      "세부 가족여행 4박5일": 2,
      "후쿠오카 미식 3박4일": 1,
      "도쿄·하코네 온천 4박5일": 1,
    },
  },
  {
    query: "효도 여행 온천 료칸",
    intent: "theme 다중(부모님·온천·료칸)",
    labels: {
      "도쿄·하코네 온천 4박5일": 3,
      "오사카·교토 3박4일 자유일정": 1,
      "후쿠오카 미식 3박4일": 1,
    },
  },
  {
    query: "동남아 휴양",
    intent: "geo 권역(동남아) + theme 휴양",
    labels: {
      "다낭·호이안 5박6일 노쇼핑": 3,
      "발리 가성비 4박6일": 3,
      "푸켓 풀빌라 허니문 5박7일": 2,
      "세부 가족여행 4박5일": 2,
    },
  },
  {
    query: "오사카 맛집 투어",
    intent: "keyword(지명 오사카) + theme 미식",
    labels: {
      "오사카·교토 3박4일 자유일정": 3,
      "후쿠오카 미식 3박4일": 2,
      "도쿄·하코네 온천 4박5일": 1,
    },
  },
  {
    query: "3박4일 일본 여행",
    intent: "hard filter(기간 3박) + geo 일본",
    labels: {
      "오사카·교토 3박4일 자유일정": 3,
      "후쿠오카 미식 3박4일": 3,
      "도쿄·하코네 온천 4박5일": 2,
    },
  },
  {
    query: "신혼 풀빌라 리조트",
    intent: "theme(허니문·풀빌라·리조트)",
    labels: {
      "푸켓 풀빌라 허니문 5박7일": 3,
      "세부 가족여행 4박5일": 1,
      "발리 가성비 4박6일": 1,
    },
  },
  {
    query: "스노클링 해변 휴양",
    intent: "theme 다중(스노클링·해변·휴양)",
    labels: {
      "세부 가족여행 4박5일": 3,
      "다낭·호이안 5박6일 노쇼핑": 2,
      "발리 가성비 4박6일": 2,
      "푸켓 풀빌라 허니문 5박7일": 2,
    },
  },
  {
    query: "조용히 쉬고 싶어",
    intent: "추상(시그널 0) — 벡터 단독 기여 격리 ⭐",
    labels: {
      "도쿄·하코네 온천 4박5일": 2,
      "다낭·호이안 5박6일 노쇼핑": 2,
      "푸켓 풀빌라 허니문 5박7일": 2,
      "발리 가성비 4박6일": 2,
      "세부 가족여행 4박5일": 1,
      "오사카·교토 3박4일 자유일정": 1,
    },
  },
  {
    query: "혼자 떠나는 근거리 주말",
    intent: "theme orphan(나홀로·근거리)",
    labels: {
      "후쿠오카 미식 3박4일": 3,
      "오사카·교토 3박4일 자유일정": 2,
      "도쿄·하코네 온천 4박5일": 1,
    },
  },
  {
    query: "설경 보러 일본",
    intent: "theme(설경) + geo 일본",
    labels: {
      "도쿄·하코네 온천 4박5일": 3,
      "오사카·교토 3박4일 자유일정": 1,
      "후쿠오카 미식 3박4일": 1,
      "스위스 알프스 9박10일": 1,
    },
  },
];
```

- [ ] **Step 2: 타입체크 통과 확인**

Run: `npm run typecheck`
Expected: PASS (golden-queries.ts 타입 에러 0).

- [ ] **Step 3: 커밋**

```bash
git add scripts/search-eval/golden-queries.ts
git commit -m "feat(search-eval): golden query set with manual relevance labels (draft)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Fixture 추출 스크립트 + 실행 + 라벨 보정

OpenAI를 1회 호출해 코퍼스·쿼리 실 임베딩을 JSON으로 박제하고 커밋. 이후 eval은 이 fixture만 읽는다.

> **선행 조건:** `.env`에 `OPENAI_API_KEY` 설정 + 시드된 DB(`npm run db:seed`로 정규 9개 코퍼스 확보). 키가 없으면 이 Task는 보류 가능 — 나머지 하네스(Task 1~4,6)는 키 없이 완성·테스트됨.

**Files:**
- Create: `scripts/search-eval/extract-fixtures.ts`
- Create: `scripts/search-eval/corpus.fixture.json` (스크립트 산출)
- Create: `scripts/search-eval/queries.fixture.json` (스크립트 산출)

- [ ] **Step 1: extract-fixtures.ts 작성**

```ts
/**
 * extract-fixtures.ts — 1회용 실 임베딩 추출기 (opt-in, dev/test 경로 밖).
 *
 * 코퍼스(시드 PUBLISHED 9건) + golden 쿼리 10건을 OpenAI로 임베딩해
 * corpus.fixture.json / queries.fixture.json 으로 박제 → git 커밋.
 * 이후 eval(run-eval.ts)은 이 JSON만 읽어 키·DB·네트워크 0으로 실행.
 *
 * 가드: OPENAI_API_KEY 미설정 시 즉시 중단(가짜 벡터 오염 방지).
 * 실행: set -a; . ./.env; set +a; npx tsx scripts/search-eval/extract-fixtures.ts
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "@/shared/lib/db";
import { env } from "@/shared/lib/env";
import { OpenAIEmbeddingProvider } from "@/shared/lib/embedding";
import { buildEmbeddingText } from "@/entities/product";
import { toStorageTag } from "@/shared/lib/tags";
import { routeQuery } from "@/features/search/server/router";
import { CORPUS_TITLES, GOLDEN_QUERIES } from "./golden-queries";
import type { CorpusProduct, GoldenQuery } from "./types";

const here = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY 미설정 — fixture 추출은 실 임베딩 키가 필요합니다.");
  }
  const provider = new OpenAIEmbeddingProvider(env.OPENAI_API_KEY);

  // 1) 코퍼스: 시드 PUBLISHED 상품(CORPUS_TITLES) 로드 → buildEmbeddingText → 임베딩.
  const products = await db.product.findMany({
    where: { status: "PUBLISHED", title: { in: [...CORPUS_TITLES] } },
    include: {
      tags: true,
      inclusions: true,
      itineraryDays: { include: { stops: true } },
    },
  });
  if (products.length !== CORPUS_TITLES.length) {
    console.warn(
      `⚠️ 코퍼스 ${products.length}/${CORPUS_TITLES.length}건 — 시드 누락? (npm run db:seed 권장)`,
    );
  }

  const corpus: CorpusProduct[] = [];
  for (const p of products) {
    // buildEmbeddingText는 ProductDetail 형태를 요구 — include로 충족.
    const { text } = buildEmbeddingText(p as Parameters<typeof buildEmbeddingText>[0]);
    const embedding = await provider.embed(text);
    corpus.push({
      title: p.title,
      destination: p.destination,
      summary: p.summary,
      tags: p.tags.map((t) => t.tag),
      basePriceAdult: p.basePriceAdult,
      durationNights: p.durationNights,
      embedding,
    });
    console.log(`  corpus ✓ ${p.title}`);
  }

  // 2) 쿼리: routeQuery(dev 규칙 추출, 결정론) → cleanedQuery 임베딩.
  const queries: GoldenQuery[] = [];
  for (const c of GOLDEN_QUERIES) {
    const routed = await routeQuery(c.query);
    const embedding = await provider.embed(routed.cleanedQuery);
    queries.push({
      query: c.query,
      cleanedQuery: routed.cleanedQuery,
      themeTags: (routed.themeTags ?? []).map(toStorageTag),
      geoTerms: routed.geoTerms ?? [],
      priceMax: routed.priceMax,
      durationNights: routed.durationNights,
      embedding,
    });
    console.log(`  query  ✓ ${c.query}`);
  }

  writeFileSync(join(here, "corpus.fixture.json"), JSON.stringify(corpus, null, 2));
  writeFileSync(join(here, "queries.fixture.json"), JSON.stringify(queries, null, 2));
  console.log(`\n박제 완료: corpus ${corpus.length} · queries ${queries.length}`);
}

main()
  .then(() => db.$disconnect())
  .catch((e) => {
    console.error(e);
    db.$disconnect();
    process.exit(1);
  });
```

- [ ] **Step 2: 타입체크 통과 확인**

Run: `npm run typecheck`
Expected: PASS. (`p as Parameters<typeof buildEmbeddingText>[0]` 캐스트로 include된 prisma 결과를 ProductDetail로 맞춤 — `any` 미사용.)

- [ ] **Step 3: 시드 + 추출 실행**

Run:
```bash
npm run db:seed
set -a; . ./.env; set +a; npx tsx scripts/search-eval/extract-fixtures.ts
```
Expected: `corpus ✓ ...` 9줄 + `query ✓ ...` 10줄 + `박제 완료: corpus 9 · queries 10`. 두 JSON 파일 생성.

- [ ] **Step 4: 라벨 보정 (실제 태그 대조)**

Run: `cat scripts/search-eval/corpus.fixture.json | npx tsx -e "const c=require('fs').readFileSync(0,'utf8');for(const p of JSON.parse(c))console.log(p.title,'|',p.destination,'|',p.tags.join(','))"`
Expected: 9개 상품의 title·destination·tags 출력.

출력의 실제 tags/destination을 보고 `golden-queries.ts`의 `labels`를 검토·수정한다:
- 라벨이 상품 실제 태그와 어긋나면(예: 기대한 `#설경` 태그가 없으면) 등급을 현실화.
- 의도 유형 균형(설계 §5)은 유지. ⭐ 8번(추상 쿼리)은 keyword/geo/theme 시그널이 0인지(cleanedQuery·themeTags·geoTerms 비어있는지) `queries.fixture.json`에서 확인 — 비어있어야 벡터 단독 격리가 성립.

- [ ] **Step 5: 커밋 (fixture + 보정된 라벨)**

```bash
git add scripts/search-eval/corpus.fixture.json scripts/search-eval/queries.fixture.json scripts/search-eval/extract-fixtures.ts scripts/search-eval/golden-queries.ts
git commit -m "feat(search-eval): extract real-embedding fixtures + calibrate labels

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: 평가 러너(baseline + sweep) + npm 스크립트

fixture + 라벨을 읽어 baseline nDCG 리포트, `--sweep`으로 가중치 격자 리더보드 출력.

**Files:**
- Create: `scripts/search-eval/run-eval.ts`
- Create: `scripts/search-eval/__tests__/sweep.test.ts`
- Modify: `package.json` (scripts에 `search:eval`)

- [ ] **Step 1: sweep.test.ts 작성 (FAIL 예정)**

```ts
import { describe, it, expect } from "vitest";
import { simplexGrid } from "../run-eval";

describe("simplexGrid", () => {
  it("step 0.1 → 합 1.0인 4-tuple 286개", () => {
    const grid = [...simplexGrid(0.1)];
    expect(grid).toHaveLength(286); // C(13,3)
  });

  it("모든 조합의 가중치 합은 1.0", () => {
    for (const w of simplexGrid(0.1)) {
      const sum = w.vector + w.keyword + w.geo + w.theme;
      expect(sum).toBeCloseTo(1.0, 9);
    }
  });

  it("운영 가중치(0.5/0.2/0.2/0.1)를 포함한다", () => {
    const grid = [...simplexGrid(0.1)];
    const has = grid.some(
      (w) => w.vector === 0.5 && w.keyword === 0.2 && w.geo === 0.2 && w.theme === 0.1,
    );
    expect(has).toBe(true);
  });
});
```

- [ ] **Step 2: 테스트 FAIL 확인**

Run: `npx vitest run scripts/search-eval/__tests__/sweep.test.ts`
Expected: FAIL — `Cannot find module '../run-eval'` 또는 `simplexGrid` export 없음.

- [ ] **Step 3: run-eval.ts 구현**

```ts
/**
 * run-eval.ts — 검색 가중치 nDCG 평가 러너 (오프라인 결정론).
 *
 *   npm run search:eval            → baseline(운영 가중치) 쿼리별 nDCG@3/@5 + 평균
 *   npm run search:eval -- --sweep → simplex 격자 전수 평가 리더보드 + baseline 순위
 *
 * fixture(corpus/queries) + golden 라벨만 읽음. 네트워크·DB·키 0.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SEARCH_WEIGHTS, type SearchWeights } from "@/entities/product";
import { rankCandidates } from "./scoreReplica";
import { ndcgAtK } from "./ndcg";
import { GOLDEN_QUERIES, type GoldenCase } from "./golden-queries";
import type { CorpusProduct, GoldenQuery } from "./types";

const here = dirname(fileURLToPath(import.meta.url));

function load<T>(file: string): T {
  return JSON.parse(readFileSync(join(here, file), "utf8")) as T;
}

/** 합 1.0인 4-tuple 가중치 격자(simplex). step 0.1 → 286개. */
export function* simplexGrid(step = 0.1): Generator<SearchWeights> {
  const n = Math.round(1 / step);
  for (let v = 0; v <= n; v++) {
    for (let k = 0; k <= n - v; k++) {
      for (let g = 0; g <= n - v - k; g++) {
        const t = n - v - k - g;
        yield {
          vector: +(v * step).toFixed(4),
          keyword: +(k * step).toFixed(4),
          geo: +(g * step).toFixed(4),
          theme: +(t * step).toFixed(4),
        };
      }
    }
  }
}

function relevancesFor(
  corpus: CorpusProduct[],
  q: GoldenQuery,
  labels: Record<string, number>,
  w: SearchWeights,
): number[] {
  return rankCandidates(corpus, q, w).map((r) => labels[r.title] ?? 0);
}

function meanNdcg(
  corpus: CorpusProduct[],
  byText: Map<string, GoldenQuery>,
  cases: GoldenCase[],
  w: SearchWeights,
  k: number,
): number {
  let sum = 0;
  for (const c of cases) {
    const q = byText.get(c.query);
    if (!q) throw new Error(`fixture 누락: "${c.query}" — extract-fixtures 재실행 필요`);
    sum += ndcgAtK(relevancesFor(corpus, q, c.labels, w), k);
  }
  return sum / cases.length;
}

function fmt(w: SearchWeights): string {
  return `v${w.vector} k${w.keyword} g${w.geo} t${w.theme}`;
}

function main(): void {
  const corpus = load<CorpusProduct[]>("corpus.fixture.json");
  const queries = load<GoldenQuery[]>("queries.fixture.json");
  const byText = new Map(queries.map((q) => [q.query, q]));
  const sweep = process.argv.includes("--sweep");

  if (!sweep) {
    console.log("=== baseline (운영 가중치", fmt(SEARCH_WEIGHTS), ") ===\n");
    console.log("쿼리".padEnd(28), "nDCG@3", "nDCG@5");
    for (const c of GOLDEN_QUERIES) {
      const q = byText.get(c.query);
      if (!q) throw new Error(`fixture 누락: "${c.query}"`);
      const n3 = ndcgAtK(relevancesFor(corpus, q, c.labels, SEARCH_WEIGHTS), 3);
      const n5 = ndcgAtK(relevancesFor(corpus, q, c.labels, SEARCH_WEIGHTS), 5);
      console.log(c.query.padEnd(28), n3.toFixed(3), " ", n5.toFixed(3));
    }
    const m3 = meanNdcg(corpus, byText, GOLDEN_QUERIES, SEARCH_WEIGHTS, 3);
    const m5 = meanNdcg(corpus, byText, GOLDEN_QUERIES, SEARCH_WEIGHTS, 5);
    console.log("\nmean nDCG@3:", m3.toFixed(4), " mean nDCG@5:", m5.toFixed(4));
    return;
  }

  // sweep: mean nDCG@5 기준 전수 평가 → 리더보드.
  const scored = [...simplexGrid(0.1)].map((w) => ({
    w,
    m5: meanNdcg(corpus, byText, GOLDEN_QUERIES, w, 5),
  }));
  scored.sort((a, b) => b.m5 - a.m5);

  const baseline = meanNdcg(corpus, byText, GOLDEN_QUERIES, SEARCH_WEIGHTS, 5);
  const rank =
    scored.findIndex(
      (s) =>
        s.w.vector === SEARCH_WEIGHTS.vector &&
        s.w.keyword === SEARCH_WEIGHTS.keyword &&
        s.w.geo === SEARCH_WEIGHTS.geo &&
        s.w.theme === SEARCH_WEIGHTS.theme,
    ) + 1;

  console.log("=== sweep 리더보드 (mean nDCG@5, top 15 / 286) ===\n");
  for (const s of scored.slice(0, 15)) {
    console.log(s.m5.toFixed(4), fmt(s.w));
  }
  console.log(`\n현 운영 가중치 ${fmt(SEARCH_WEIGHTS)} → ${baseline.toFixed(4)} (순위 ${rank}/286)`);
}

main();
```

- [ ] **Step 4: 테스트 PASS 확인**

Run: `npx vitest run scripts/search-eval/__tests__/sweep.test.ts`
Expected: PASS (3 케이스).

- [ ] **Step 5: package.json에 스크립트 추가**

`package.json`의 `"scripts"` 블록에 추가:
```json
    "search:eval": "tsx scripts/search-eval/run-eval.ts",
```

- [ ] **Step 6: baseline + sweep 실행 (증거 수집)**

Run:
```bash
set -a; . ./.env; set +a; npm run search:eval
set -a; . ./.env; set +a; npm run search:eval -- --sweep
```
Expected: baseline은 쿼리별 nDCG@3/@5 테이블 + mean(0~1 값). sweep은 top15 리더보드 + 운영 가중치 순위(N/286). **두 출력을 보고서에 인용.**

- [ ] **Step 7: 커밋**

```bash
git add scripts/search-eval/run-eval.ts scripts/search-eval/__tests__/sweep.test.ts package.json
git commit -m "feat(search-eval): nDCG eval runner (baseline + weight sweep)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: 종합 검증 + ADR 후보 기록

**Files:**
- Modify: `docs/superpowers/plans/2026-06-10-search-weight-ndcg-eval.md` (체크박스 최종 갱신)

- [ ] **Step 1: 전체 QA 증거 수집**

Run: `npm run typecheck && npx vitest run scripts/search-eval src/entities/product && npm run lint`
Expected: typecheck PASS, eval/엔티티 테스트 전부 PASS, lint 통과.

- [ ] **Step 2: 미체크 항목 점검**

Run: `grep -n "\- \[ \]" docs/superpowers/plans/2026-06-10-search-weight-ndcg-eval.md`
Expected: (Task 5를 키 부재로 보류한 경우 외엔) 출력 없음.

- [ ] **Step 3: 보고 (CLAUDE.md §7.1 양식)**

baseline·sweep 출력을 인용해 보고한다:
- 🏗️ Core Architecture: fixture 박제 → 오프라인 결정론 eval / scoreReplica가 SQL 미러(SSOT 재사용 drift 차단) / 리포트-온리.
- 🧠 Concept Insight: nDCG와 sweep의 의미를 비유로 1문단.
- **ADR 후보 한 줄**: sweep 결과가 현 0.5/0.2/0.2/0.1과 유의미하게 다르면 "가중치 변경(또는 현행 유지) 결정을 ADR-NNNN으로 박제할 가치가 있어 보입니다 — 추가할까요?" 제안. 변경은 사용자 승인 후 `SEARCH_WEIGHTS` 한 곳 수정(fixture 재추출 불요 — 가중치는 eval 시 주입, 운영은 상수).

---

## Self-Review 메모 (작성자 점검 완료)

- **스펙 커버리지**: §4 추출 스크립트→Task 5 · §5 golden 셋→Task 4 · §6 scoreReplica→Task 3 · §6.1 drift 가드(SEARCH_WEIGHTS SSOT)→Task 1 · §7 nDCG→Task 2 · §8 러너(baseline/sweep)→Task 6 · §10 ADR 후보→Task 7. 전 항목 매핑됨.
- **타입 일관성**: `SearchWeights`/`CorpusProduct`/`GoldenQuery`/`GoldenCase`/`themeBoost(…,ceiling)`/`rankCandidates`/`simplexGrid` 시그니처가 정의 Task와 사용 Task에서 일치.
- **스펙 §5 예시 보정**: "100만원 이하 3박 유럽"(코퍼스상 전멸) → "3박4일 일본 여행"으로 대체, 사유 명시(Task 4).
- **키 의존성**: Task 5만 OPENAI_API_KEY 필요. Task 1~4·6은 키 없이 완성·테스트(순수 함수는 합성 데이터로 검증).
