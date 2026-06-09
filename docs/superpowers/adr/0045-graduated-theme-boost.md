# ADR-0045: 테마 부스트 — 이진 → 요청 커버리지 비율 graduated (천장 0.1 유지)

- **상태**: Accepted
- **결정일**: 2026-06-09
- **영향 범위**: `src/entities/product/api/searchByVector.ts`
- **관련 commit**: `ef70648` (themeBoost 순수 헬퍼 + 불변식 테스트), `f9b4ae5` (graduated SQL), `4c61b66` (폴백 binary 회귀 가드)

## Context (배경)

`searchProductsByVector`는 이미 하이브리드 스코어링을 운영한다([M-AI-SEARCH], commit `acfc519`):

```
score = 코사인 × 0.5 + 키워드ILIKE × 0.2 + geo × 0.2 + 테마 × 0.1
```

테마 항(`buildThemeScore`)은 **이진 플랫 부스트**였다: `EXISTS(요청 태그 중 하나라도 적중) → +0.1`. 문제는 요청 태그가 여러 개일 때 **하나만 맞아도 전부 맞아도 동일하게 `+0.1`** 이라는 점이다. "휴양 미식 가성비" 검색 시 세 태그를 모두 가진 상품과 "휴양" 하나만 가진 상품이 테마 점수에서 동점이 되어, 사용자 의도를 더 잘 충족하는 다태그 상품이 랭킹 우위를 갖지 못했다.

## Decision (결정)

테마 항을 **요청 태그 커버리지 비율**에 비례하는 graduated 부스트로 전환한다. **천장은 0.1로 유지**한다.

```ts
// 공식 SSOT (순수 함수)
export function themeBoost(matchCount: number, requested: number): number {
  if (!(requested > 0)) return 0; // 0·음수·NaN 차단
  return THEME_WEIGHT * (matchCount / requested);
}
```

DB-단 `buildThemeScore` SQL이 이 공식을 미러한다: `THEME_WEIGHT × count(*)::float / requested`. 분모·태그·가중치 전부 바인딩 파라미터(인젝션 안전).

`ProductTag`의 `@@unique([productId, tag])` 제약이 `0 ≤ matchCount ≤ requested`를 구조적으로 보장하므로 비율 ∈ [0,1], 점수 ∈ [0, 0.1]. **cap(상한 클램프) 로직이 불필요**하다 — 스키마 불변식이 애플리케이션 로직을 대신 지킨다.

## Consequences (결과)

**얻은 것:**
- 다태그 매칭 상품이 단일 매칭 대비 랭킹 우위 확보(요청 의도 커버리지 비례)
- 천장 0.1 불변 → 기존 가중치 밸런스(벡터 0.5/키워드 0.2/geo 0.2/테마 0.1) 무손상. 이진을 연속값으로 세분화할 뿐 생태계 재조정 불요
- `@@unique` 불변식 덕에 cap 코드 없이 점수 상한 보장
- 순수 함수 `themeBoost`의 6개 불변식 테스트(경계·0가드·단조·비율·범위)로 공식의 수학적 정합성 증명

**포기한 것 / 미해결:**
- TS 순수 함수와 SQL 두 표현의 동기화는 코드로 강제 불가(SQL은 DB가 실행) → 양쪽 JSDoc `⚠️` 경고 + 이원 테스트(불변식 vs 배선)로 방어. drift 방지는 사람의 주의에 의존
- 키워드 폴백(pgvector 부재 강등 경로)은 의도적으로 binary theme-first 정렬 유지(회귀 가드 테스트로 박제) — 두 경로 공식 불일치는 설계 결정
- 가중치(0.5/0.2/0.2/0.1)는 여전히 측정 없는 수동값 — golden-query/nDCG 기반 튜닝은 별도 마일스톤

## Alternatives Considered (대안)

### 옵션 A: 절대 가산 + cap — `min(matchCount × 0.05, cap)`
- 강한 테마 매칭이 기존 0.1 천장을 넘어 더 공격적으로 상위 점유. 단 천장이 가변이 되어 벡터(0.5) 우위를 잠식 → 가중치 재균형이 필요하고 회귀 위험이 큼. 거부.

### 옵션 B: 체감식(sqrt) — `0.1 × sqrt(matchCount)/sqrt(requested)`
- 첫 매칭 이득을 크게, 추가 매칭을 체감시키는 곡선. 본 데이터 규모에서 튜닝 근거가 약하고 복잡도만 증가. 선형 비율("의도 커버리지")이 의미상 더 직관적. 거부.

### 옵션 C: 메모리 단 재정렬(application re-ranking)
- 이미 DB-단 `$queryRaw` 가중합으로 `ORDER BY score LIMIT 20`이 확립. 메모리 재정렬은 LIMIT 이전 전체 후보를 끌어와야 해 비효율이고 인젝션 안전 바인딩 패턴(R6)을 깸. graduated도 동일 SELECT 항만 교체하는 게 최소 침습. 거부.

### 옵션 D: 폴백 경로도 graduated
- pgvector 부재 강등 경로는 희귀하고 이미 theme-first 정렬. 두 경로를 동일 공식으로 유지하는 보수 비용 대비 이득 미미. 거부.

## Notes

- drift 동기화 지점은 2곳: `themeBoost`(순수 함수) + `buildThemeScore`(SQL). 한쪽 변경 시 반드시 양쪽 갱신.
- 폴백 binary 정책의 회귀 가드: `searchByVector.test.ts`의 "폴백 경로는 graduated가 아닌 binary theme-first 정렬을 유지한다" 테스트. 폴백을 graduated로 바꾸면 이 테스트가 깨져 의도적 변경임을 강제.
- 향후 후보: 가중치 측정 기반 튜닝(golden-query eval 하네스), 태그 vocabulary 동기화.
