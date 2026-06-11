# ADR-0050: 조건부 LLM 재정렬(추상 의도 한정) + fixture-스냅샷 eval + Haiku 코드펜스 방어

- **상태**: Accepted
- **결정일**: 2026-06-11
- **영향 범위**: `src/features/search/server/rerank.ts`, `src/features/search/server/search.ts`, `src/features/search/model/{clarifyingChips,rerankOrder}.ts`, `scripts/search-eval/{extract-fixtures,run-eval,hard-queries}.ts`, `scripts/search-eval/{hard-queries,rerank}.fixture.json`
- **관련 commit**: `0f1e3c1` `488b5fd` `aad81fd` `038a05b` `525da19` `c025cab` `7cc656b` `15303ae`
- **관련 ADR**: [ADR-0049](./0049-search-weight-ndcg-eval-keep-current.md)(nDCG eval 하네스), [ADR-0045](./0045-graduated-theme-boost.md)(graduated theme boost)

## Context (배경)

검색은 단일 쇼트·stateless 하이브리드 파이프라인(`searchProductsByVector` = 벡터 0.5 / 키워드 0.2 / geo 0.2 / 테마 0.1)이었다. 두 약점:

1. **추상 쿼리의 랭킹이 약하다.** ADR-0049 nDCG eval에서 신호 없는 추상어가 바닥이었다("조용히 쉬고 싶어" 류). 벡터가 랭킹을 혼자 떠안는 zone에서 하이브리드 산술만으로는 미세한 의미 차를 못 가른다.
2. **모호한 쿼리를 좁힐 UI가 없다.** 예산·기간·세부테마가 비어도 그대로 검색된다.

이를 메우되 (a) stateless·RSC·graceful-degradation 철학, (b) ADR-0049 하네스의 **키·DB·네트워크 0 결정론 재현성**을 0줄도 훼손하지 않아야 했다. 그런데 LLM 재정렬은 *비결정·키 의존*이라 (b)와 정면충돌한다.

## Decision (결정)

**축 1 — Clarifying Chips:** `RoutedQuery`의 빈 차원(price/duration/theme)에서 좁히기 칩을 파생하는 순수 함수. 클릭=`?q=`에 토큰 append(대화 상태=URL). client island는 plain props만 받고 `entities/product` 배럴 미import(서버 그래프 누출 차단).

**축 2 — 조건부 LLM 재정렬:** `shouldRerank(routed)`가 **geo·theme 모두 빈 순수 추상 의도**일 때만 발동 → 하이브리드 top-8을 Haiku로 재정렬, 꼬리(9위~) 원본 보존. 비-prod는 identity(오프라인 결정론). 모든 실패는 원본 순서로 강등(throw 금지).

**축 3 — fixture-스냅샷 eval:** 재정렬 순서를 1회 박제(`rerank.fixture.json`) → eval(`run-eval.ts --rerank`)은 그 고정 순서만 읽어 nDCG 계산 → 키 없이 결정론 유지. 운영 재정렬과 eval이 순열가드(`applyRerankOrder`)를 공유(DRY).

```ts
// 추상 의도에만 — 벡터가 전부 떠안는 zone
export function shouldRerank(routed: RoutedQuery): boolean {
  return !(routed.geoTerms?.length) && !(routed.themeTags?.length);
}
// Haiku가 "코드블록 금지"를 무시하고 ```json … ``` 로 감싸므로 펜스를 벗긴 뒤 파싱.
function extractJsonObject(text: string): string { /* fence 제거 + 첫{~마지막} */ }
```

**측정 결과(15-쿼리 추상 슬라이스):** mean nDCG@5 **0.3126 → 0.5041 (Δ +0.1915, 상대 +61%)**. 10건 개선·4건 동일·1건 하락. golden 10-쿼리 baseline(0.8961) 무손상.

## Consequences (결과)

**얻은 것:**
- 약점 구간(추상어)에서 정량적으로 입증된 +61% 랭킹 품질 향상, 명확 쿼리는 비용·지연 0(트리거 skip).
- eval은 여전히 키·DB·네트워크 0 결정론 — 누구나 `npx tsx run-eval.ts --rerank`로 재현.
- 재정렬은 순수 부가 레이어 — 실패 시 항상 원본 하이브리드 순서(가용성 무손상).

**포기한 것 / 미해결:**
- **부분 모호 쿼리**(geo만, theme만 있는 쿼리)는 v1에서 재정렬 안 됨(보수적 트리거, 의도적 YAGNI).
- **fixture drift**: 실 LLM은 비결정 → modelVersion·프롬프트 변경 시 운영과 eval이 미세 drift. `extract-fixtures` 재실행으로 동기화(가중치 drift 가드와 동형).
- 1건 하락(`일상에서 벗어나고 싶다` −0.258) — LLM 재정렬은 단조 개선이 아님.

## Alternatives Considered (대안)

### 옵션 A: 항상 재정렬 (트리거 없음)
- 모든 쿼리를 무조건 Haiku 재정렬.
- **거부**: 명확한 쿼리("오사카 가족여행 100만원")는 하이브리드가 이미 충분 → LLM 호출이 비용·지연 낭비. eval 약점 구간(추상어)과 정확히 겹치는 조건부 트리거가 비용 대비 효과 최적.

### 옵션 B: 2단계 client-side 재정렬 (RSC 뒤 별도 fetch)
- 결과를 먼저 그리고 client가 재정렬을 비동기 요청.
- **거부**: 레이아웃 시프트 + client가 `entities/product` 배럴을 import해야 해 서버 그래프 누출(HomeRegionDeals 선례). Blocking RSC(기존 Suspense 뒤)가 client 추가 0.

### 옵션 C: eval에서 실 LLM 호출 (스냅샷 없이)
- run-eval이 매번 Haiku 호출.
- **거부**: ADR-0049 하네스의 핵심 가치(키·DB·네트워크 0 결정론)를 파괴. 비결정 출력으로 nDCG가 실행마다 흔들려 회귀 가드 불가. fixture 스냅샷이 임베딩 fixture 선례와 동형으로 모순 해소.

### 옵션 D: 풀 챗봇 대화 UX (Clarifying Chips 대신)
- 세션 스레드·스토리지로 다중 턴 대화.
- **거부**: stateless·RSC 철학 이탈 + 카탈로그 UX 이탈 + 세션 영속 부담. 대화 상태=URL(`?q=` 누적)이 `nextSortUrl`/`GlobalRouteProgress` 선례와 일관.

### 옵션 E: 시스템 프롬프트만 강화해 코드펜스 억제
- "코드블록 금지"를 더 강하게 명시.
- **거부**: 실측상 Haiku는 명시적 금지에도 ` ```json ` 펜스를 자주 붙인다(15/15 전부). 모델을 설득하기보다 `extractJsonObject`로 **방어적 파싱**하는 편이 견고. 회귀 테스트로 박제.

## Notes

- **Haiku 코드펜스 사고**: 초기 `--rerank` Δ가 15쿼리 전부 +0.000 → 조사 결과 펜스로 `JSON.parse` 실패 → 모든 재정렬이 graceful degradation으로 **조용히 원본 순서로 강등**(운영에서도 영구 no-op이 될 뻔). graceful degradation이 결함을 은폐하는 전형 — "너무 깨끗한" 측정값은 의심하라. `extractJsonObject` + 펜스 회귀 테스트(`rerank.test.ts`)로 봉합([commit `7cc656b`]).
- **라벨 독립성**: hard-query 라벨을 재정렬 출력에 맞춰 보정하지 **않음**(과적합=eval 순환 방지). 라벨은 의도에 대한 독립 ground truth.
- **모니터링 지표**: 추상 슬라이스 mean nDCG@5(현 0.5041). modelVersion/프롬프트 변경 시 `extract-fixtures` 재실행 후 이 값 재확인.
- **트리거 확장 여부**(부분 모호 쿼리)는 eval 데이터로 추후 판단 — 확장 시 본 ADR에 이어 새 결정 기록.
