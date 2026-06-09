# themeTags Graduated Soft Boost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 검색 테마 부스트를 이진(`EXISTS → +0.1`)에서 요청 태그 커버리지 비율(`0.1 × matchCount/requested`)로 세분화해, 다태그 매칭 상품이 랭킹 상위로 오도록 한다.

**Architecture:** 순수 헬퍼 `themeBoost(matchCount, requested)`를 공식 SSOT로 추출(TDD)하고, `buildThemeScore`의 DB-단 SQL이 동일 산술을 미러한다. 천장 0.1을 유지해 기존 가중치 밸런스(벡터 0.5/키워드 0.2/geo 0.2/테마 0.1)를 무손상 보존한다. 키워드 폴백 경로는 binary 그대로 둔다(YAGNI).

**Tech Stack:** TypeScript strict, Prisma 5 `$queryRaw`+`Prisma.sql`(인젝션 안전 바인딩), Vitest 2, PostgreSQL + pgvector.

---

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `src/entities/product/api/searchByVector.ts` | 코사인 벡터 검색 + 하이브리드 스코어링 | `themeBoost` 헬퍼 추가·export + `buildThemeScore` SQL 산술 교체 |
| `src/entities/product/api/__tests__/searchByVector.test.ts` | 벡터 검색/폴백/스코어링 단위 테스트 | graduated invariant 테스트 추가 + 기존 soft boost 통합 테스트 갱신 |

> 참고: `themeBoost`는 `searchByVector.ts` 내부에 함께 둔다(별도 파일 불필요 — `THEME_WEIGHT` 상수와 동일 모듈, 50줄 미만 추가). 기존 `__resetPgvectorCacheForTest`처럼 test/구현이 같은 모듈을 공유하는 패턴을 따른다.

---

## Task 1: `themeBoost` 순수 헬퍼 + 결정론적 TDD invariant

**Files:**
- Test: `src/entities/product/api/__tests__/searchByVector.test.ts` (describe 블록 신규 추가)
- Modify: `src/entities/product/api/searchByVector.ts` (`themeBoost` export 추가)

- [x] **Step 1: Write the failing test**

`searchByVector.test.ts` 상단 import에 `themeBoost`를 추가한다:

```ts
import {
  searchProductsByVector,
  themeBoost,
  __resetPgvectorCacheForTest,
} from "../searchByVector";
```

파일 끝(마지막 `describe` 블록 뒤)에 다음 describe 블록을 추가한다:

```ts
describe("themeBoost — graduated 커버리지 비율 (순수 함수 invariant)", () => {
  it("요청 태그를 모두 매칭하면 천장 0.1을 반환한다", () => {
    expect(themeBoost(3, 3)).toBeCloseTo(0.1, 10);
    expect(themeBoost(1, 1)).toBeCloseTo(0.1, 10);
  });

  it("매칭이 0이면 0을 반환한다", () => {
    expect(themeBoost(0, 3)).toBe(0);
  });

  it("요청 태그가 0이면 0을 반환한다(division-by-zero 가드)", () => {
    expect(themeBoost(0, 0)).toBe(0);
    expect(themeBoost(2, 0)).toBe(0);
  });

  it("matchCount가 늘면 score는 비감소(단조 증가)", () => {
    expect(themeBoost(2, 3)).toBeGreaterThan(themeBoost(1, 3));
    expect(themeBoost(3, 3)).toBeGreaterThan(themeBoost(2, 3));
  });

  it("부분 매칭은 요청 대비 비율값이다", () => {
    expect(themeBoost(1, 3)).toBeCloseTo(0.1 / 3, 10); // ≈ 0.0333
    expect(themeBoost(2, 4)).toBeCloseTo(0.05, 10);
  });

  it("score는 항상 [0, 0.1] 범위 안이다", () => {
    for (let req = 1; req <= 5; req++) {
      for (let m = 0; m <= req; m++) {
        const s = themeBoost(m, req);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(0.1 + 1e-9);
      }
    }
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm run test -- searchByVector`
Expected: FAIL — `themeBoost` is not exported / not a function (import 에러 또는 `themeBoost is not defined`).

- [x] **Step 3: Write minimal implementation**

`searchByVector.ts`의 `THEME_WEIGHT` 상수 정의 직후(현재 43행 부근)에 헬퍼를 추가한다:

```ts
/**
 * 테마 부스트 점수 (graduated soft boost, 공식 SSOT).
 *
 * 요청 태그 커버리지 비율에 천장(THEME_WEIGHT)을 곱한다:
 *   requested === 0 ? 0 : THEME_WEIGHT × (matchCount / requested)
 *
 * matchCount ∈ [0, requested]가 보장되므로(ProductTag @@unique([productId,tag]))
 * 반환값은 항상 [0, THEME_WEIGHT] 범위 — cap 불필요.
 *
 * ⚠️ buildThemeScore의 SQL 산술이 이 공식을 미러한다. 한쪽을 바꾸면
 *    반드시 다른 쪽도 갱신할 것(drift 방지).
 */
export function themeBoost(matchCount: number, requested: number): number {
  if (requested <= 0) return 0;
  return THEME_WEIGHT * (matchCount / requested);
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm run test -- searchByVector`
Expected: PASS — 새 `themeBoost` describe 블록 6개 케이스 모두 통과, 기존 케이스도 통과.

- [x] **Step 5: Commit**

```bash
git add src/entities/product/api/searchByVector.ts src/entities/product/api/__tests__/searchByVector.test.ts
git commit -m "feat(search): themeBoost pure helper + graduated invariant tests"
```

---

## Task 2: `buildThemeScore` DB-단 SQL을 graduated 비율로 교체

**Files:**
- Modify: `src/entities/product/api/searchByVector.ts` (`buildThemeScore` 함수)
- Modify: `src/entities/product/api/__tests__/searchByVector.test.ts` (기존 "soft boost" 통합 테스트 갱신)

- [x] **Step 1: Update the existing soft-boost integration test (failing)**

`searchByVector.test.ts:95`의 기존 테스트를 graduated SQL을 검증하도록 갱신한다. 해당 `it("themeTags는 WHERE 하드배제가 아닌 SELECT 점수 가산항(soft boost)", ...)` 블록 본문의 단언부를 다음으로 교체한다(테스트 셋업/mock 부분은 그대로 유지):

```ts
    const text = mockDb.$queryRaw.mock.calls[1][0].sql as string;
    const mainWhereIdx = text.indexOf("WHERE p.status");
    const orderIdx = text.indexOf("ORDER BY");
    const whereClause = text.slice(mainWhereIdx, orderIdx);

    // 메인 WHERE에는 ProductTag 배제가 없어야 한다(soft 전환의 핵심)
    expect(whereClause).not.toContain("ProductTag");
    // ProductTag 매칭은 SELECT 점수식(가산항)에 존재해야 한다
    const selectClause = text.slice(0, mainWhereIdx);
    expect(selectClause).toContain("ProductTag");
    // graduated: 이진 CASE가 아니라 count(*) 비율 산술이어야 한다
    expect(selectClause).toContain("count(*)");
    expect(selectClause).not.toContain("THEN 0.1");
```

추가로, 요청 태그 개수(분모)가 바인딩 파라미터로 전달되는지 검증하는 테스트를 같은 describe 블록에 추가한다:

```ts
  it("graduated: 요청 태그 개수(분모)가 바인딩 파라미터로 전달된다", async () => {
    mockDb.$queryRaw
      .mockResolvedValueOnce([{ one: 1 }])
      .mockResolvedValueOnce([{ id: "p1", score: 0.6 }]);
    mockDb.product.findMany.mockResolvedValueOnce([fakeProduct("p1")]);

    await searchProductsByVector(
      qVec,
      { themeTags: ["휴양", "미식", "가성비"] },
      MODEL,
      "휴양 미식 가성비"
    );

    const searchSql = mockDb.$queryRaw.mock.calls[1][0];
    // 분모 = 정규화된 요청 태그 개수(3)가 바인딩 값으로 존재
    expect(searchSql.values).toContain(3);
    // 태그 배열도 '#' 정규화되어 바인딩
    expect(
      searchSql.values.some(
        (v: unknown) => Array.isArray(v) && v.includes("#휴양") && v.includes("#미식")
      )
    ).toBe(true);
  });
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm run test -- searchByVector`
Expected: FAIL — 현재 `buildThemeScore`는 `THEN ${THEME_WEIGHT}`(=0.1) 이진식이라 `selectClause`에 `count(*)`가 없고 `THEN 0.1`이 존재 → 갱신된 단언 실패. 분모 `3`도 바인딩에 없어 실패.

- [x] **Step 3: Rewrite `buildThemeScore` to graduated arithmetic**

`searchByVector.ts`의 `buildThemeScore` 함수(현재 104-110행)를 다음으로 교체한다:

```ts
/**
 * 테마 태그 적중 → graduated 점수 가산 조각(soft boost, 없으면 0).
 *
 * themeBoost 공식의 SQL 미러: THEME_WEIGHT × matchCount / requested.
 *  - matchCount = 요청 태그 적중 개수 (count(*), ProductTag @@unique로 ≤ requested)
 *  - requested  = tags.length (호출부에서 1개 이상 보장 — 빈 배열은 위에서 0 반환)
 * 분모는 바인딩 파라미터로 전달(인젝션 안전 R6). ::float로 정수나눗셈 회피.
 *
 * ⚠️ themeBoost(searchByVector.ts) 공식과 동기화 유지 — 한쪽 변경 시 양쪽 갱신.
 */
function buildThemeScore(tags: string[]): Prisma.Sql {
  if (tags.length === 0) return Prisma.sql`0`;
  return Prisma.sql`(${THEME_WEIGHT} * (
    SELECT count(*) FROM "ProductTag" pt
    WHERE pt."productId" = p.id AND pt.tag = ANY(${tags})
  )::float / ${tags.length})`;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm run test -- searchByVector`
Expected: PASS — 갱신된 soft-boost 테스트 + 신규 분모 바인딩 테스트 + Task 1 invariant + 기존 벡터/geo/폴백 테스트 모두 통과.

- [x] **Step 5: Full verification (typecheck + test + lint)**

Run: `npm run typecheck && npm run test -- searchByVector && npm run lint`
Expected: typecheck PASS(`any`/`as any` 없음), 테스트 PASS, lint PASS.

- [x] **Step 6: Commit**

```bash
git add src/entities/product/api/searchByVector.ts src/entities/product/api/__tests__/searchByVector.test.ts
git commit -m "feat(search): graduated theme boost SQL (matchCount/requested ratio)"
```

---

## Task 3: 폴백 경로 binary 유지 검증 (회귀 가드)

**Files:**
- Modify: `src/entities/product/api/__tests__/searchByVector.test.ts` (폴백 회귀 가드 테스트 1건)

> 목적: 키워드 폴백(pgvector 부재)이 **의도적으로 graduated를 적용하지 않고 binary theme-first 정렬을 유지**함을 박제한다. 다음 작업자가 "폴백도 graduated 해야 하는 것 아닌가?" 오해로 건드리지 않도록 invariant를 고정한다.

- [x] **Step 1: Write the regression-guard test**

폴백 describe 블록(또는 벡터 describe 블록 뒤)에 추가한다. 기존 폴백 테스트의 mock 패턴(가용성 체크가 빈 배열 → 폴백 진입)을 따른다:

```ts
  it("폴백 경로는 graduated가 아닌 binary theme-first 정렬을 유지한다", async () => {
    mockDb.$queryRaw
      .mockResolvedValueOnce([]) // pgvector 미가용 → 폴백 진입
      .mockResolvedValueOnce([{ id: "p1", score: 0 }]); // 폴백 쿼리
    mockDb.product.findMany.mockResolvedValueOnce([fakeProduct("p1")]);

    await searchProductsByVector(
      qVec,
      { themeTags: ["휴양"] },
      MODEL,
      "동남아 휴양"
    );

    const fallbackSql = mockDb.$queryRaw.mock.calls[1][0].sql as string;
    // 폴백은 binary CASE(theme-first 정렬) 유지 — count(*) 비율 산술 부재
    expect(fallbackSql).toContain("ORDER BY");
    expect(fallbackSql).not.toContain("count(*)");
  });
```

- [x] **Step 2: Run test to verify it passes immediately**

Run: `npm run test -- searchByVector`
Expected: PASS — 폴백(`keywordFallback`)은 변경하지 않았으므로 binary 정렬 유지, 단언 즉시 통과. (이 테스트는 회귀 가드이므로 RED 단계 없이 GREEN 확인 → 폴백이 미래에 graduated로 바뀌면 이 테스트가 깨져 경보)

- [x] **Step 3: Commit**

```bash
git add src/entities/product/api/__tests__/searchByVector.test.ts
git commit -m "test(search): guard fallback stays binary theme-first (not graduated)"
```

---

## Task 4: 최종 종합 검증 + CLAUDE.md 노트 + ADR 후보 제안

**Files:**
- Modify: `CLAUDE.md` (§8 진행 상황 + 다음 작업자 혼란 방지 노트 1건)

- [x] **Step 1: 전체 스위트 종합 검증**

Run: `npm run typecheck && npm run test && npm run lint`
Expected: 전부 PASS. 출력의 테스트 통과 수를 완료 보고에 인용한다.

- [x] **Step 2: Update CLAUDE.md §8 진행 상황**

§8의 "현재는 Phase 15 ... 완료 / 다음 마일스톤 미정" 문단과 진행 상황 요약에 Phase 16 완료를 반영한다. "다음 작업자의 혼란 방지 노트"에 다음 항목을 추가한다:

```markdown
  - "테마 부스트가 왜 이진이 아니라 비율이지?" → (Phase 16) [ADR-00XX]. `buildThemeScore`가 `EXISTS → +0.1`(이진)에서 `0.1 × matchCount/requested`(요청 커버리지 비율)로 전환. 다태그 매칭 상품이 단일 매칭보다 상위. 천장 0.1 불변 → 가중치 밸런스(벡터 0.5/키워드 0.2/geo 0.2/테마 0.1) 무손상. 공식 SSOT는 순수 함수 `themeBoost`, SQL이 동일 산술 미러(drift 주석). **폴백(pgvector 부재)은 의도적으로 binary theme-first 유지**(YAGNI) — `keywordFallback` 건드리지 말 것(회귀 가드 테스트 존재).
```

(ADR 번호는 Step 4에서 발행 시 확정)

- [x] **Step 3: Update plan checkboxes**

이 plan 파일의 완료된 모든 `- [ ]`를 `- [x]`로 갱신한다(§4.1 규칙). 커밋 전 확인:

Run: `grep -n "\- \[ \]" docs/superpowers/plans/2026-06-09-theme-graduated-boost.md`
Expected: 완료 태스크에 미체크 항목 없음.

- [x] **Step 4: ADR 발행 제안 (사용자 승인 후)**

완료 보고 말미에 ADR 후보를 제안한다: "이진→graduated 비율, 천장 0.1 유지로 가중치 밸런스 보존" 결정을 `docs/superpowers/adr/NNNN-graduated-theme-boost.md`로 박제할지 사용자에게 질의. 승인 시 다음 번호로 발행 + `adr/README.md` 인덱스 1줄 추가 + CLAUDE.md의 `[ADR-00XX]` 플레이스홀더를 실제 번호로 치환. **사용자가 명시 승인하기 전 임의 발행 금지(§6.1).**

- [x] **Step 5: Commit**

```bash
git add CLAUDE.md docs/superpowers/plans/2026-06-09-theme-graduated-boost.md
git commit -m "docs(claude): mark Phase 16 graduated theme boost complete"
```

---

## 완료 기준 (Definition of Done)

- [x] `themeBoost` 순수 함수 + 6개 invariant 테스트 통과 (경계·0가드·단조·비율·범위)
- [x] `buildThemeScore` SQL이 graduated 비율 산술로 교체 + 분모 바인딩 검증 통과
- [x] 폴백 binary 유지 회귀 가드 통과
- [x] `npm run typecheck && npm run test && npm run lint` 전부 PASS
- [x] CLAUDE.md §8 노트 갱신
- [x] ADR 발행 여부 사용자에 질의(임의 발행 금지)
