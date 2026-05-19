# AI 시맨틱 검색 모듈 설계 (M-AI-SEARCH)

> Phase 2 마지막 핵심. 자연어 쿼리(`/search?q=...`)를 **구조화 필터 + pgvector 코사인 유사도**로 라우팅하는 시맨틱 상품 검색.
> 근거: `specs/2026-05-13-phase2-roadmap.md` §5.5 / 로드맵 산출물 7·8.
>
> ⚠️ **구현 분기 고지 (2026-05-19):** 이 spec의 §3~§5는 *최초 설계*다. 수동
> E2E에서 순수 코사인의 한계(dev 가짜 벡터 무의미·"일본" 전상품 동률)가
> 드러나 **하이브리드 4분할 스코어링·실 OpenAI 연동·gazetteer geo-taxonomy·
> themeTags soft boost**로 확장되었다. **현 구현의 권위 있는 기준은
> §7(D8~D11) + §10 ADR**이다. §3~§5는 진화의 출발점으로 읽을 것.

---

## 0. 범위 및 비범위

### 범위 (이 spec)
- `ProductEmbedding`(pgvector 1536-dim) 마이그레이션 + ivfflat 인덱스(raw SQL).
- 임베딩 **provider 추상화** + 비-프로덕션 결정론적 dev 폴백 (`feedback_dev_external_io` / NO-REAL-MONEY 준수).
- 자연어 라우터: `q` → {가격대, 기간(박/일), 테마 태그} 구조화 추출 (LLM = Anthropic, dev 폴백 = 규칙 기반).
- 검색 파이프라인: 추출 필터(SQL WHERE) + 쿼리 임베딩 코사인 정렬(`<=>`) 결합.
- `/search?q=` RSC 페이지 + Phase 1 `ProductCard` 재사용.
- 쿼리 캐시(동일 `q` 1시간) — LLM/임베딩 비용 폭주 방어(로드맵 R5).
- pgvector 불가 시 키워드(ILIKE) **graceful degradation**(로드맵 R6).
- 임베딩 백필 스크립트(시드 10개 상품).

### 비범위 (별도 작업)
- 검색 결과 개인화(사용자 이력), 음성 검색, 멀티턴 대화 검색.
- 임베딩 자동 재색인 크론/어드민 UI (수동 스크립트만).
- 운영 임베딩 provider 실연동 검증 (운영 키 필요 — no-prod 범위 밖. 인터페이스·dev 폴백까지만).

---

## 1. 도메인 모델 / 마이그레이션

### 1.1 기존 자산 재사용 (변경 없음)
- `Product`, `ProductTag`, `Departure` — 검색 결과 소스.
- `entities/product` barrel: `ProductCard`(UI), `SearchResultCard`(타입: `ProductCard & {aiComment?; score?}`), `SEARCH_CHIPS`.
- `db.$queryRaw` + `Prisma.sql` 패턴 — `getProductList`에서 이미 사용 중. 코사인 쿼리에 동일 적용.

### 1.2 `ProductEmbedding` (스키마 존재, **마이그레이션 미생성**)
```prisma
model ProductEmbedding {
  productId    String   @id
  vector       Unsupported("vector(1536)")
  modelVersion String   // provider+model 식별 — 교체 시 일괄 재색인 키
  updatedAt    DateTime @updatedAt
  product      Product  @relation(..., onDelete: Cascade)
}
```
Prisma는 `vector` 타입·ivfflat 인덱스를 관리 못 함 → **마이그레이션에 raw SQL 동봉**:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
-- (Prisma가 테이블 생성 후)
CREATE INDEX IF NOT EXISTS product_embedding_vector_idx
  ON "ProductEmbedding" USING ivfflat (vector vector_cosine_ops) WITH (lists = 100);
```
`vector(1536)` 차원은 OpenAI `text-embedding-3-small` 기준. provider 추상화가 차원을 1536으로 단언(assert)한다.

---

## 2. FSD 산출물 맵 (단방향 의존성 준수)

| 레이어 | 산출물 | 책임 |
|---|---|---|
| `shared/lib/embedding/` | `EmbeddingProvider` 인터페이스, `getEmbeddingProvider()`, dev 폴백 | 도메인 무지. 텍스트→1536벡터. NODE_ENV 분기. |
| `shared/lib/cache/` | `ttlCache`(in-memory, TTL) | 도메인 무지. 동일 `q` 캐시. 관측성 metrics in-memory 패턴 차용. |
| `entities/product/api/` | `searchProductsByVector(embedding, filters)` | **상품 데이터 접근은 product 엔티티 소유**(architect). raw SQL 코사인. |
| `features/search/server/` | `routeQuery(q)`(NL→필터, LLM+dev폴백), `searchProducts(q)`(오케스트레이션) | 사용자 인터랙션 단위. LLM 호출은 서버 전용. |
| `features/search/model/` | Zod 스키마(`SearchParamsSchema`, `RoutedQuerySchema`) | 외부 입력·LLM 출력 파싱. |
| `features/search/ui/` | `SearchBox`(`'use client'`), `SearchChips` | 검색 입력 UX. |
| `app/(site)/search/` | `page.tsx`(RSC) `/search?q=` | 라우팅·조합만. 비즈니스 로직 금지. |
| `scripts/` | `backfill-embeddings.ts` | 시드 상품 임베딩 생성(멱등). |

**의존성 방향**: `app → features/search → entities/product → shared`. `features/search`는 `entities/product` barrel만 import(깊은 경로 금지). 동일 레이어 cross-slice import 없음.

---

## 3. 임베딩 Provider 추상화 (핵심 설계)

### 3.1 인터페이스
```ts
// shared/lib/embedding/types.ts
export interface EmbeddingProvider {
  readonly modelVersion: string;          // ProductEmbedding.modelVersion에 기록
  embed(text: string): Promise<number[]>; // 길이 1536 보장
}
```

### 3.2 NODE_ENV 분기 (feedback_dev_external_io 준수)
- `env.NODE_ENV !== "production"` → **`DeterministicDevProvider`**: 입력 텍스트 해시 시드로 1536-dim 의사 벡터 생성(정규화). 외부 호출 0, 결정론적 → 테스트·로컬 재현 가능.
- production → 실제 provider(예: OpenAI/Voyage)를 spread 조건부 주입. API 키 placeholder는 `?? "DEV_ONLY"`로 인스턴스화 단계 방어.
- **분기 조건은 `NODE_ENV` 한 줄.** API 키 존재 여부로 분기 금지(과거 Resend 사고 재발 방지).
- NO-REAL-MONEY와 동일 정신: 비-프로덕션은 외부 부작용·비용 0.

### 3.3 modelVersion 정책
`"{provider}:{model}:{dim}"` (예: `dev-deterministic:v1:1536`). `ProductEmbedding.modelVersion`과 쿼리 시 provider의 `modelVersion` **불일치하면 해당 행 검색 제외**(스테일 임베딩 안전장치) + 재색인 필요 로그.

---

## 4. 자연어 라우터 `routeQuery(q)`

### 4.1 입력·출력
입력: `q: string`(사용자 자연어). 출력(`RoutedQuerySchema`로 파싱):
```ts
{
  priceMax?: number;       // "20만원 이하" → 200000
  durationNights?: { min?: number; max?: number }; // "3박4일" → {min:3,max:3}
  themeTags?: string[];    // ["온천","가족"] — ProductTag.tag 후보
  cleanedQuery: string;    // 임베딩용 정제 텍스트
}
```

### 4.2 LLM(Anthropic) + dev 폴백
- production: `ANTHROPIC_API_KEY`로 Claude 호출, **구조화 출력 강제**(JSON), `RoutedQuerySchema.safeParse` + `.catch()` 폴백(파싱 실패 시 필터 없이 cleanedQuery=q).
- 비-프로덕션: **규칙 기반 추출기**(정규식: 금액 `\d+만원`, 기간 `\d박\d일`, 테마 = `SEARCH_CHIPS`/태그 사전 매칭). LLM 호출 0.
- 분기: `env.NODE_ENV !== "production"`(§3.2와 동일 규칙).

### 4.3 비용 방어 (로드맵 R5)
`routeQuery`·`embed` 결과를 `ttlCache`에 동일 `q` 키로 1시간 캐시. rate limit은 MVP 범위 밖(로드맵 §5.5)이나 캐시로 1차 방어.

---

## 5. 검색 파이프라인 `searchProducts(q)`

```
q ──▶ routeQuery(q) ──▶ {filters, cleanedQuery}
                          │
        cleanedQuery ──▶ embed() ──▶ qVec(1536)
                          │
   entities/product.searchProductsByVector(qVec, filters):
     SELECT p.* , 1 - (e.vector <=> $qVec) AS score
     FROM "Product" p JOIN "ProductEmbedding" e ON e."productId"=p.id
     WHERE p.status='PUBLISHED'
       AND e."modelVersion" = $modelVersion           -- 스테일 제외
       [AND p."basePriceAdult" <= $priceMax]
       [AND p."durationNights" BETWEEN $min AND $max]
       [AND EXISTS (ProductTag 매칭)]
     ORDER BY e.vector <=> $qVec                       -- 코사인 거리 오름차순
     LIMIT 20
```
- 모든 동적 조건은 `Prisma.sql` 태그드 템플릿(인젝션 차단·N+1 회피) — `getProductList`와 동일.
- 결과 → `SearchResultCard[]`(`score` 포함). `aiComment`는 MVP 비범위(필드만 옵셔널 유지).
- `lowestPrice`(Departure 조인)는 기존 매핑 재사용.

### 5.1 Graceful degradation (로드맵 R6)
부팅 시 1회 `SELECT 1 FROM pg_extension WHERE extname='vector'` 가용성 체크 캐시.
- 불가 → `searchProductsByVector` 대신 `ILIKE` 키워드 검색(title/destination/summary) + 필터만 적용. UI에 "기본 검색 모드" 배지. 500 금지 — 항상 결과 페이지 렌더.

---

## 6. `/search` 페이지 (RSC)

- `app/(site)/search/page.tsx`: `searchParams.q` await(Next 15). `q` 없으면 `SEARCH_CHIPS` 추천 + 빈 상태.
- `q` 있으면 서버에서 `searchProducts(q)` 호출 → `ProductCard` 그리드 재사용. `force-dynamic`.
- `'use client'` 금지(페이지). `SearchBox`만 클라이언트(폼 제출 → `/search?q=` 네비게이션, cleanup 불필요한 무상태 폼).
- 로딩: `loading.tsx` 스켈레톤. 결과 0건: `EmptyState` 재사용.

---

## 7. 핵심 설계 결정 (D)

| ID | 결정 | 근거 |
|---|---|---|
| D1 | 임베딩 provider 인터페이스 + NODE_ENV dev 폴백 | 비-프로덕션 외부비용 0, 결정론 테스트 ([[feedback-dev-external-io]]) |
| D2 | 상품 데이터 접근(`searchProductsByVector`)은 `entities/product` 소유 | Architect: 엔티티가 자기 데이터 접근 소유. `features/search`는 오케스트레이션만 |
| D3 | 코사인 쿼리는 `db.$queryRaw`+`Prisma.sql` | Prisma vector 미지원 + 기존 `getProductList` 패턴 일관 |
| D4 | `modelVersion` 불일치 행 검색 제외 | provider 교체 시 스테일 임베딩 오염 차단 |
| D5 | pgvector 불가 시 키워드 폴백(500 금지) | 로드맵 R6, DB 확장 권한 불확실성 흡수 |
| D6 | 동일 `q` 1h 캐시 | 로드맵 R5 LLM/임베딩 비용 폭주 방어 |
| D7 | 라우터 LLM 출력은 Zod parse + `.catch` 무필터 폴백 | LLM 비결정성·악성 입력 방어, 항상 검색 가능 |
| **D8** | **하이브리드 4분할 스코어**: `cosine*0.5 + keyword*0.2 + geo*0.2 + theme*0.1` | 순수 코사인은 명시 단어("일본") 정밀도 부족·dev 가짜벡터 무의미. 키워드/geo/theme 가산으로 보강 (§10 ADR-1) |
| **D9** | **실 임베딩 + `USE_REAL_EMBEDDING` 스위치** (OpenAI `text-embedding-3-small`) | dev 결정론 폴백은 의미 검색 불가. opt-in 스위치로 NODE_ENV 무관 실연동(기본 false → [[feedback-dev-external-io]] 정신 유지) (§10 ADR-2) |
| **D10** | **gazetteer geo-taxonomy**: `entities/product/model/geo.ts` 권역→국가→도시 사전 + `expandGeoTerms` | "동남아"가 destination에 없어 키워드/벡터로 권역 검색 불가. 정적 사전으로 DB 마이그레이션 없이 해결 (§10 ADR-3) |
| **D11** | **themeTags = soft boost** (WHERE 배제 → 점수 가산항) | hard filter는 "동남아 휴양"을 발리 1건으로 축소. 가산으로 전환 → 권역 recall + 테마 precision 양립 (§10 ADR-4) |

---

## 8. 리스크 & 가드

| ID | 리스크 | 가드 |
|---|---|---|
| R1 | pgvector 확장 권한/인프라 부재 | D5 키워드 폴백 + 부팅 가용성 체크 |
| R2 | LLM 비용 폭주 | D6 캐시, 비-프로덕션 LLM 호출 0 |
| R3 | LLM 구조화 출력 깨짐 | D7 Zod+catch, cleanedQuery=q 폴백 |
| R4 | 임베딩 차원 불일치(provider 교체) | 인터페이스 1536 단언 + D4 modelVersion 게이트 |
| R5 | 시드 상품 임베딩 누락 → 결과 0 | 백필 스크립트 멱등, plan Task에 검증 포함 |
| R6 | 검색 SQL 인젝션 | 전 구간 `Prisma.sql` 파라미터 바인딩 |

---

## 9. 검증 전략 (QA)

- **단위(TDD 우선)**: `routeQuery` 규칙 추출기(금액/기간/테마 파싱), `DeterministicDevProvider`(결정론·차원 1536·정규화), `ttlCache`(TTL 만료), `RoutedQuerySchema` 파싱·폴백.
- **통합**: 마이그레이션 적용 후 백필 → `searchProducts("부모님 온천 3박")` → 관련 상품 상위 노출 + `score` 범위 검증(curl/tsx 증거).
- **degradation**: vector 확장 비활성 가정 경로 키워드 폴백 동작.
- 자동: `typecheck`/`test`/`lint`. 런타임 증거는 `scripts/qa/ai-search-evidence.ts`
  (M3 DoD 쿼리 "가족이랑 갈만한 동남아 휴양지 5박" + 매트릭스 + degradation).

---

## 10. ADR — E2E 발견 기반 설계 진화 (2026-05-19)

> §3~§5(최초 설계) 대비 실제 구현의 분기를 기록한다. 각 ADR은
> Context(왜 바뀌었나) / Decision(무엇으로) / Consequence(대가)로 정리.
> plan `2026-05-19-ai-search.md`의 `[E2E 확장]` Task 8A~8D와 1:1 대응.

### ADR-1 — 순수 코사인 → 하이브리드 4분할 (D8)
- **Context:** dev `DeterministicDevProvider`는 해시 의사난수라 코사인
  유사도가 노이즈(±0.05). "일본" 검색에 전 상품이 동률 반환. 운영
  실 임베딩에서도 명시적 단어 일치가 약하게 묻힘.
- **Decision:** `searchByVector`를 `(1-cosine)*VECTOR_WEIGHT
  + keyword ILIKE*KEYWORD_WEIGHT + geo*GEO_WEIGHT + theme*THEME_WEIGHT`
  로 재작성. 가중치 상수화 `0.5/0.2/0.2/0.1`. `ORDER BY score DESC`.
- **Consequence:** 순수 의미검색 절대값은 소폭↓(VECTOR 0.7→0.5)이나
  랭킹 정밀도·권역 recall 대폭↑. 가중치 4개가 튜닝 표면(회귀 위험)
  → evidence 스크립트 before/after 대조로 방어.

### ADR-2 — 실 OpenAI 임베딩 + opt-in 스위치 (D9)
- **Context:** 가짜 벡터로는 시맨틱 검색 검증 불가. 그러나
  [[feedback-dev-external-io]]는 dev 외부호출을 NODE_ENV로만 분기.
- **Decision:** `OpenAIEmbeddingProvider`(text-embedding-3-small,
  1536, 10s 타임아웃, 차원 단언). 분기 = `NODE_ENV==="production"
  || env.USE_REAL_EMBEDDING`. 스위치 기본 false → 기존 규칙 정신 유지,
  사용자 명시 opt-in일 때만 dev 실연동.
- **Consequence:** 토글 시 `modelVersion` 게이트(D4)로 구벡터 전량
  제외 → **백필 재실행 필수**(운영 함정, 가드 미구현은 미해결 부채).
  현재 `.env` `USE_REAL_EMBEDDING="1"`.

### ADR-3 — gazetteer geo-taxonomy (D10)
- **Context:** `destination`은 "다낭, 베트남" 자유텍스트. "동남아"
  글자가 없어 키워드/벡터 어느 쪽도 권역 검색 불가(사용자 의도
  비대칭: 일본=국가우선, 동남아=권역우선).
- **Decision:** `entities/product/model/geo.ts`에 권역→국가→도시
  정적 트리 + `expandGeoTerms`(권역어→하위 전체/국가어→자기+도시/
  도시어→자기). 라우터가 결정론 추출(LLM 환각 배제), `searchByVector`가
  `destination ILIKE ANY(geoPatterns)` 가산.
- **Consequence:** DB 마이그레이션 0으로 권역 검색 해결. 대가 = 사전
  수동 유지보수 → 카탈로그 확장 시 DB 택소노미(방안 B) 전환 트리거
  필요(미해결 부채로 plan에 명시).

### ADR-4 — themeTags hard filter → soft boost (D11)
- **Context:** themeTags가 `WHERE EXISTS(ProductTag)` 하드배제라
  "동남아 휴양"이 #휴양 단일 상품(발리)만 반환 — 권역 recall 파괴.
- **Decision:** `buildFilterClauses`에서 제거 → `buildThemeScore`
  4번째 가산항. price/duration만 하드 제약 유지. 키워드 폴백도
  theme recall OR + 정렬 우선 결합.
- **Consequence:** "동남아 휴양" → SEA 4건 노출 + #휴양(발리) 최상단.
  price/duration은 의도적으로 hard 유지(예: "5박" 명시 시 4박 제외가
  올바름) — DoD 쿼리가 2건만 반환된 것은 이 정상 동작의 결과.
