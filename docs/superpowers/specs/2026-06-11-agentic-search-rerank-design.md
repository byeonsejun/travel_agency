# Agentic Search + LLM Re-ranking — 설계 (Design)

> 마일스톤 4(검색 고도화 — Agentic Search + LLM Re-ranking).
> 목표: 단일 쇼트 검색을 (1) 모호한 의도를 좁히는 **Clarifying Chips**,
> (2) 하이브리드 top-K를 Claude로 재정렬하는 **LLM Re-ranking** 으로 확장하고,
> (3) 기존 **nDCG eval 하네스**로 재정렬 전/후 품질 향상을 정량 입증한다.
>
> 작성일: 2026-06-11 · 상태: **승인 대기**
> 참조: ADR-0049(nDCG eval 하네스), ADR-0045(graduated theme boost)

---

## 1. 배경 & 문제

현재 검색은 **단일 쇼트(single-shot)·stateless** 파이프라인이다
(`src/features/search/server/search.ts`):

```
SearchBox → /search?q= → RSC searchProducts(q)  [rate-limit ai-search, cache 1h]
  → routeQuery (Haiku/규칙) → embed(cleanedQuery)
  → searchProductsByVector (하이브리드 SQL top-20)
  → SearchResultCard[] → ProductCard 그리드
```

두 가지 한계:

1. **모호한 쿼리를 좁힐 수단이 없다.** "오사카 가족여행"은 예산·기간·세부테마가
   비어 있어도 그대로 검색된다. 사용자가 의도를 더 줄 길이 UI에 없다.
2. **추상 쿼리의 랭킹이 약하다.** ADR-0049 nDCG eval에서 신호 없는 추상 쿼리가
   바닥이었다: "조용히 쉬고 싶어" nDCG@5 **0.575**, "설경 보러 일본" **0.633**.
   벡터가 랭킹을 혼자 떠안는 zone에서 하이브리드 산술만으로는 미세한 의미 차이를
   못 가른다.

→ 두 한계를 **(1) Clarifying Chips** 와 **(2) 조건부 LLM Re-ranking** 으로 메우되,
   기존 stateless·RSC·graceful-degradation 철학을 0줄 훼손하지 않는다.

### 1.1 근본 제약 — eval은 오프라인·결정론이어야 한다

ADR-0049 하네스의 핵심 가치는 **키·DB·네트워크 0의 결정론 재현**이다. 그러나
LLM 재정렬은 비결정론 + 키 의존이다. 이 둘은 충돌한다.

→ **재정렬 순서를 1회 스냅샷해 `rerank.fixture.json` 으로 박제**(임베딩 fixture와
   동일 패턴). eval은 그 고정 순서만 읽어 nDCG를 계산 → 오프라인·결정론 유지.

---

## 2. 확정된 설계 결정 (브레인스토밍 합의)

| # | 쟁점 | 결정 | 근거 |
|---|---|---|---|
| D1 | 대화형 UX 모델 | **Clarifying Chips (URL 기반)** | stateless·RSC 철학 유지. 대화 상태=URL(`?q=` 누적), 새 client 상태 0. `nextSortUrl`/`GlobalRouteProgress` 선례. 풀 챗봇은 세션·스토리지 부담 + 카탈로그 UX 이탈로 거부. |
| D2 | Re-rank 트리거 | **조건부 — `geoTerms 없음 && themeTags 없음`** | 순수 추상 의도(벡터가 전부 떠안는 zone)에만 발동. 명확한 쿼리는 skip → 비용·지연 0. eval 약점 구간과 정확히 일치. 항상 재정렬은 명확 쿼리에도 LLM 낭비라 거부. |
| D3 | Re-rank 전달 | **Blocking RSC (기존 Suspense 뒤)** | 재정렬을 `searchProducts` 안에서 동기 수행. 스켈레톤은 이미 존재. 순수 RSC, client 추가 0. 2단계 client 재정렬은 레이아웃 시프트+순환import 위험으로 거부. |
| D4 | Re-rank 모델 | **Claude Haiku (`claude-haiku-4-5-20251001`)** | router.ts가 이미 동일 모델·raw fetch 사용. 후보가 사전 필터된 top-8이라 Haiku로 충분. 새 SDK 의존 0. |
| D5 | Re-rank 범위 | **top-8** | 9위 이하는 어차피 노출되지 않음. 8개면 입력 ~500토큰(저비용). 꼬리(9~20)는 원본 순서로 뒤에 보존. |
| D6 | 캐싱 | **기존 `search:v1:` 키에 재정렬 최종 순서까지 저장** | 반복 쿼리는 embed+rerank 모두 skip. 새 캐시 레이어 0. TTL 1h 유지. |
| D7 | dev/prod 분기 | **비-prod = identity 재정렬** | router의 `NODE_ENV !== "production"` 분기 철학 동일. dev/test 오프라인·결정론 보존. 실 재정렬은 fixture 추출(opt-in, 키 필요)만. |
| D8 | Eval 엄밀성 | **hard-query slice 신설(15) + rerank fixture 스냅샷** | 기존 10쿼리는 가중치 회귀 가드로 동결. 재정렬은 설계 표적(추상 쿼리)에서 격리 측정. ADR-0049의 10-query 노이즈 바닥 문제 정면 회피. |
| D9 | 칩 생성 | **순수 함수 (RoutedQuery의 빈 차원에서 파생)** | 결정론·무비용·dev 패리티. LLM 칩 생성은 비결정론+비용이라 v1 제외(YAGNI). |
| D10 | 강등 정책 | **재정렬 실패 → 원본 하이브리드 순서** | 타임아웃·파싱실패·환각 id → throw 금지, 원본 순서 반환. router/searchByVector 강등 철학 동일. |

---

## 3. 축 1 — Clarifying Chips

### 3.1 동작

라우터가 추출한 차원(geo / theme / price / nights) 중 **비어 있는 차원**을
감지해, 그 차원을 채우는 "좁히기" 칩을 제안한다.

```
"오사카 가족여행"  → routed { geo:[오사카], theme:[가족], price:∅, nights:∅ }
  → 빠진 price·nights·세부테마 → 칩: [예산 100만↓] [3박4일] [온천 포함] [아이 동반]
  → 칩 클릭 → ?q="오사카 가족여행 100만원" 로 router.push → 재검색
```

### 3.2 구성요소

- **`features/search/model/clarifyingChips.ts`** (신규, 순수)
  - `buildClarifyingChips(routed: RoutedQuery, query: string): ClarifyingChip[]`
  - `ClarifyingChip = { label: string; appendText: string }`
  - 규칙: price 미지정 → 예산 칩 후보, nights 미지정 → 기간 칩 후보,
    theme 일부만 → 인접 세부테마 칩(geo/기존 theme 기반 소규모 큐레이션 풀에서).
  - 이미 쿼리에 포함된 토큰(`query.includes(appendText 핵심어)`)은 중복 제외.
  - 모든 차원이 충분히 특정되면 `[]` 반환(칩 미표시).
- **`features/search/ui/ClarifyingChips.tsx`** (신규, `'use client'`)
  - plain `ClarifyingChip[]` props만 수신. **entities/product 배럴 import 금지**
    (서버 그래프 누출 차단 — HomeRegionDeals 선례).
  - 칩 클릭 → `router.push(?q=encodeURIComponent(query + " " + appendText))`,
    `useTransition` 으로 isPending 스피너. 이벤트 리스너·타이머 없음(cleanup 불요).

### 3.3 테스트
- `clarifyingChips.test.ts` — 순수 단위: 빈 차원→칩셋 / 모든 차원 특정→`[]` /
  중복 토큰 제외. (`nextSortUrl` 선례처럼 DOM 시뮬 불요.)

---

## 4. 축 2 — LLM Re-ranking

### 4.1 구성요소 — `features/search/server/rerank.ts` (신규, 서버 전용)

```ts
/** 순수 트리거: 순수 추상 의도(벡터가 랭킹을 혼자 떠안는 zone)에만 발동. */
export function shouldRerank(routed: RoutedQuery): boolean {
  return !(routed.geoTerms?.length) && !(routed.themeTags?.length);
}

/**
 * top-8 후보를 Claude Haiku로 관련성 재정렬. 실패 시 원본 순서(throw 금지).
 *  - compact doc: {id,title,destination,aiSummary,tags,price,nights} ≈ 60토큰×8
 *  - 3s 타임아웃 → JSON 파싱 → 입력 id의 순열인지 검증(환각/누락 id 제거)
 *  - 비-prod(NODE_ENV≠production)은 identity(원본 순서) — 오프라인 결정론
 */
export async function rerankCandidates(
  query: string,
  candidates: SearchResultCard[],
  topK = 8,
): Promise<SearchResultCard[]>;
```

- **순열 가드:** LLM이 반환한 id 배열을 입력 top-8 id 집합과 대조 — 누락된 id는
  원래 위치로 append, 입력에 없는(환각) id는 폐기. 항상 정확히 입력 길이로 복원.
- **꼬리 보존:** 9~20위는 재정렬 대상 밖 → 재정렬된 top-8 뒤에 원본 순서로 이어붙임.

### 4.2 오케스트레이션 — `features/search/server/search.ts` (수정)

`searchProductsImpl` 의 반환 타입을 `SearchResultCard[]` →
**`{ results: SearchResultCard[]; chips: ClarifyingChip[] }`** 로 확장:

```
cache hit → 그대로 반환 (재정렬 순서·칩까지 캐시됨)
routed = routeQuery(q)            // 1회만 (prod LLM 비용 증가 없음)
vec = embed(routed.cleanedQuery)
hybrid = searchProductsByVector(vec, filters, ...)        // top-20
results = shouldRerank(routed)
  ? await rerankCandidates(q, hybrid)                     // 조건부
  : hybrid
chips = buildClarifyingChips(routed, q)
cacheSet(key, { results, chips }, 1h)
```

- rate-limit 래퍼(`withRateLimitAction`, ai-search tier)의 제네릭 타입만 새 shape로.
- 재정렬은 **cache miss && shouldRerank** 일 때만 발동 → 비용 이중 방어.

### 4.3 페이지 — `src/app/(site)/search/page.tsx` (수정)
- `searchProducts(q)` → `{ results, chips }` 구조분해.
- `<ClarifyingChips chips={chips} query={query} />` 를 결과 그리드 위에 렌더.
- 결과 렌더·Suspense·스켈레톤은 기존 구조 유지.

### 4.4 강등 체인 (전부 "절대 throw 안 함" 보존)
| 실패 지점 | 폴백 |
|---|---|
| routeQuery | cleanedQuery=q (기존) |
| searchByVector | keyword 폴백 (기존) |
| **rerank (타임아웃/파싱/환각)** | **원본 하이브리드 순서 (신규)** |
| chips | 순수함수 — 실패 불가, 빈 배열 |

### 4.5 테스트
- `rerank.test.ts` — `shouldRerank` 순수 단위(추상→true, geo/theme 존재→false) +
  `rerankCandidates` (fetch mock): 정상 재정렬 / 타임아웃→원본 / 환각 id 폐기 /
  누락 id 복원 / 순열 길이 보존. dev identity 경로.

---

## 5. 축 3 — Eval 연동

### 5.1 hard-query slice (신규)
- **`scripts/search-eval/hard-queries.ts`** — 추상·모호 15쿼리 + 수작업 0~3 라벨
  (20상품 코퍼스 위). 재정렬이 효과를 낼 표적 구간("조용히 쉬고 싶어",
  "북적이지 않는 곳", "기분 전환" 류). 기존 `golden-queries.ts` 10쿼리는 **동결**.
  - ⚠️ **제약:** hard 쿼리는 `shouldRerank`(D2: geo·theme 모두 비어야 재정렬)를
    실제로 만족해야 한다 — 그래야 eval이 *운영에서 재정렬되는 바로 그 경로*를
    측정한다. 추출 시 각 쿼리의 routed가 `geoTerms`·`themeTags` 모두 비었는지
    검증(`extract-fixtures` 가드 또는 추출 후 점검). geo/theme가 잡히는 쿼리는
    재선정.

### 5.2 fixture 확장 — `extract-fixtures.ts` (수정, opt-in 키 필요)
- `hard-queries.fixture.json` — 15쿼리의 routed + 실 임베딩 박제.
- **`rerank.fixture.json`** — 각 hard 쿼리의 하이브리드 top-8을 실 Haiku로 재정렬한
  **id 순서 스냅샷**(`{ query: string; rerankedIds: string[] }[]`).

### 5.3 러너 — `run-eval.ts --rerank` (수정)
- 각 hard 쿼리에 대해:
  - `scoreReplica` 로 하이브리드 top-K 산출 → `nDCG@5(hybrid)`
  - `rerank.fixture.json` 의 id 순서로 동일 후보 재배열 → `nDCG@5(reranked)`
  - per-query 델타 + mean 델타 리포트.
- eval은 fixture만 읽어 **완전 결정론**(키·네트워크 0).
- `types.ts` 에 `RerankSnapshot` 타입 추가.

### 5.4 테스트
- 기존 `ndcg`/`scoreReplica`/`sweep` 테스트 무손상.
- 재정렬 적용 로직(fixture 순서로 후보 재배열) 순수 단위 테스트.

---

## 6. FSD 경계 & 파일 맵

```
src/features/search/
  model/clarifyingChips.ts            # 신규 순수 — buildClarifyingChips
  model/__tests__/clarifyingChips.test.ts
  ui/ClarifyingChips.tsx              # 신규 'use client' — plain props만
  server/rerank.ts                    # 신규 서버 — shouldRerank + rerankCandidates
  server/__tests__/rerank.test.ts
  server/search.ts                    # 수정 — 조건부 rerank + chips 반환
  index.ts                            # 수정 — ClarifyingChips/타입 re-export

src/app/(site)/search/page.tsx        # 수정 — 칩 렌더 + {results,chips} 구조분해

scripts/search-eval/
  hard-queries.ts                     # 신규 — 15 추상 쿼리 + 라벨
  hard-queries.fixture.json           # 신규 박제(추출 산출)
  rerank.fixture.json                 # 신규 박제(재정렬 순서 스냅샷)
  extract-fixtures.ts                 # 수정 — hard + rerank fixture 추출
  run-eval.ts                         # 수정 — --rerank 모드
  types.ts                            # 수정 — RerankSnapshot
```

- **단방향 의존 무손상:** `features/search` → `entities/product` 배럴만.
  `ClarifyingChips`(client)는 entities 배럴 미import(plain props).
- **결제/예약 도메인 0줄.** NO-REAL-MONEY 무관.

---

## 7. Trade-offs & 한계 (정직)

- **트리거 보수적**(D2): 부분 모호 쿼리(geo만 있고 theme 없음 등)는 v1에서 재정렬
  안 됨. 의도적 YAGNI — eval로 확장 여부 추후 판단.
- **재정렬 fixture는 스냅샷**: 실 LLM 비결정론이라 운영 동작과 eval 사이 미세 drift
  가능. 가중치 drift 가드처럼 **재추출로 동기화**(modelVersion/프롬프트 변경 시).
- **hard slice 라벨링 비용**: 15쿼리 수작업 + 두 코퍼스(10+15) 유지 부담.
- **Blocking 지연**(D3): 어려운 쿼리 cold path는 ~300~800ms(Haiku) 증가. 스켈레톤
  뒤라 체감 완화 + 캐시가 반복 흡수. 명확 쿼리는 영향 0.

## 8. 범위 밖 (NO scope)
스트리밍 재정렬 · 세션 채팅(스레드 영속) · 개인화 · 재정렬 모델 파인튜닝 ·
LLM 칩 생성 · 부분 모호 쿼리 트리거 — 전부 제외.

## 9. ADR 후보 (구현 완료 시 발행 제안)
- 재정렬 **dev/prod 분기 + 조건부 트리거 + fixture-스냅샷 eval** 패턴.
- 재정렬 이득이 eval에서 노이즈 위로 유의미하면 "재정렬 도입(또는 트리거 조정)"
  결정을 ADR로 박제.
