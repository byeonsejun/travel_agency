# 검색 가중치 nDCG eval 하네스 — 설계 (Design)

> 마일스톤 3단계(검색 가중치 튜닝 — 데이터 기반 고도화).
> 목표: 현 하이브리드 가중치(벡터 0.5 / 키워드 0.2 / geo 0.2 / 테마 0.1)를
> **golden-query 셋 + nDCG eval 하네스**로 정량 검증하고, 더 나은 조합 후보를
> 데이터로 제시한다(자동 적용 X — ADR 검토 후 수동 결정).
>
> 작성일: 2026-06-10 · 상태: **승인 대기**

---

## 1. 배경 & 문제

현재 검색 스코어링은 `src/entities/product/api/searchByVector.ts` 의 `$queryRaw`
SQL 안에 박혀 있다:

```
score = (1 - cosineDistance) × 0.5   // 벡터(의미)
      + (title|destination|summary ILIKE %kw%) × 0.2   // 키워드
      + (destination ILIKE ANY geoTerms) × 0.2          // geo
      + themeBoost(matchCount, requested)               // 테마(천장 0.1)
```

이 4개 가중치(합 1.0)는 **경험적으로 정해진 값**일 뿐, 정량 근거가 없다.
"벡터를 0.5에서 0.4로 낮추면 더 좋아지는가?"에 답할 측정 수단이 없다.

### 1.1 근본 제약 — dev 임베딩은 의미가 없다

`src/shared/lib/embedding/devProvider.ts` 의 dev provider는 **해시 기반
의사난수(노이즈) 벡터**를 만든다(외부 비용 0, 결정론). 차원·정규화·결정론
계약은 운영과 같지만 **의미적 유사도는 0**이다. 따라서 dev 벡터로 nDCG를
재면 벡터 가중치(0.5) 기여분이 순수 잡음이 되어 "벡터 밸런스 검증"이라는
목표 자체가 무너진다.

→ **실 임베딩(OpenAI `text-embedding-3-small`, 1536-dim)을 한 번 떠서 fixture로
박제**하고, 이후 eval은 그 고정 벡터로 완전 오프라인·결정론으로 돌린다.

---

## 2. 확정된 설계 결정 (브레인스토밍 합의)

| # | 쟁점 | 결정 | 근거 |
|---|---|---|---|
| D1 | 임베딩 충실도 | **실벡터 fixture 박제(오프라인)** | dev 노이즈로는 벡터 가중치 검증 불가. 1회 추출 → 키·DB·네트워크 0 재현. |
| D2 | 정답 라벨 | **수작업 등급 라벨(0~3)** | golden 셋의 ground truth는 사람 판단이 가장 정확. 소규모(쿼리~10×상품~11)라 감당 가능. 휴리스틱 자동라벨은 우리가 튜닝하려는 theme/geo 시그널을 정답으로 깔아 순환논위험(벡터 기여 과소평가). |
| D3 | 가중치 적용 정책 | **리포트만 — 적용은 수동(ADR)** | 12 상품·~10 쿼리 소표본 과적합 방지. sweep은 후보 제안, 운영 가중치 변경은 사람이 ADR로 결정. |

---

## 3. 아키텍처 개요

```
scripts/search-eval/                  ← 프로덕션 번들 무오염(app/.../shared 밖)
  golden-queries.ts        🟡 정답 셋: 쿼리 + 수작업 등급 라벨(ground truth)
  extract-fixtures.ts      🔴 1회용: PUBLISHED 상품 + 쿼리 → OpenAI 임베딩 추출
  corpus.fixture.json      📦 박제: 상품 메타 + embedding[1536]
  queries.fixture.json     📦 박제: 쿼리 라우팅 결과 + embedding[1536]
  scoreReplica.ts          순수 TS 스코어 미러(themeBoost·SEARCH_WEIGHTS 재사용)
  ndcg.ts                  순수 nDCG@k 수학
  run-eval.ts              러너: baseline 리포트 / --sweep 리더보드
  __tests__/               ndcg·scoreReplica 단위테스트 + drift 가드
```

**데이터 흐름**
1. (1회) `extract-fixtures.ts` 가 OpenAI를 호출해 두 fixture JSON을 만든다 → git 커밋.
2. (반복) `run-eval.ts` 가 fixture + golden 라벨을 읽어 `scoreReplica` 로 점수
   계산 → 순위 정렬 → `ndcg` 로 점수화 → 콘솔 리포트. **네트워크·DB·키 0**.

### 3.1 FSD / 경계 준수
- eval 하네스는 **도구(tooling)** 이므로 production 레이어가 아닌 `scripts/`
  하위에 둔다(기존 `scripts/backfill-embeddings.ts` 등과 동급).
- production 스코어링은 `entities/product` SQL 에 그대로 남는다.
- 하네스는 `@/entities/product` 배럴에서 `themeBoost`, `SEARCH_WEIGHTS`,
  `buildEmbeddingText`, `expandGeoTerms`, `OpenAIEmbeddingProvider` 등 **공개
  API만** 사용(딥패스 import 금지).

---

## 4. Fixture 추출 스크립트 (`extract-fixtures.ts`)

**성격**: 1회용·opt-in CLI. dev/test 경로에 **절대 포함되지 않는다**.

1. **가드**: `env.OPENAI_API_KEY` 미설정 시 즉시 에러 중단(가짜/0 벡터로
   fixture 오염 방지 — `OpenAIEmbeddingProvider` R3 정신). `feedback_dev_external_io`
   준수: 커밋된 fixture 덕에 CI/test 는 영구히 OpenAI 미호출.
2. **코퍼스**: DB에서 `status='PUBLISHED'` 상품 로드(시드 Draft 보라카이 제외).
   각 상품에 엔티티 `buildEmbeddingText(product)` 적용(프로덕션 임베딩 입력과
   동일 텍스트) → `OpenAIEmbeddingProvider.embed()`.
   - 저장 필드: `id, title, destination, summary, tags[], basePriceAdult,
     durationNights, embedding[1536]`.
     (keyword 매칭이 title/destination/summary 를 보므로 summary 필수.
      hard filter 재현 위해 price/nights 필수.)
3. **쿼리**: `golden-queries.ts` 의 각 쿼리에 `routeQuery()`(dev 규칙 추출,
   결정론) 적용 → `cleanedQuery, themeTags, geoTerms, priceMax, durationNights`
   도출 → `cleanedQuery` 를 OpenAI 임베딩.
   - 저장 필드: `query, cleanedQuery, themeTags[], geoTerms[], priceMax?,
     durationNights?, embedding[1536]`.
4. 두 fixture 를 `scripts/search-eval/*.fixture.json` 으로 write → **git 커밋**.
5. **재추출 조건**: 코퍼스·골든 쿼리 변경 또는 임베딩 모델 bump 시에만.

> 비용: 상품 ~11 + 쿼리 ~10 ≈ 21회 임베딩 ≈ **1센트 미만**, 1회.
> NO-REAL-MONEY 무관(결제/Toss 실거래 제약이지 임베딩 API 아님).

---

## 5. Golden-query 셋 (`golden-queries.ts`)

각 쿼리를 11개 코퍼스 상품에 대해 **0~3 등급**으로 수작업 라벨:
`3=완벽 일치 · 2=좋음 · 1=약간 관련 · 0=무관`. 라벨은 코드 상수(타입 안전,
리뷰·diff 추적 용이). 의도 유형을 **고르게 섞어 특정 시그널 과대평가 방지**:

| # | 쿼리(초안) | 주 의도 | 검증 표적 |
|---|---|---|---|
| 1 | 가족과 함께하는 오사카 주말 여행 | 복합(theme+geo+keyword) | 종합 밸런스 |
| 2 | 효도 여행 온천 료칸 | theme 다중 | 테마 graduated |
| 3 | 동남아 휴양 | geo 권역 + theme | geo 0.2 |
| 4 | 오사카 맛집 투어 | keyword(지명)+theme | keyword 0.2 |
| 5 | 100만원 이하 3박 유럽 | hard filter + geo | 필터+geo 상호작용 |
| 6 | 신혼 풀빌라 리조트 | theme | theme 정밀 |
| 7 | 스노클링 해변 휴양 | theme 다중 | 다태그 커버리지 |
| 8 | **조용히 쉬고 싶어** | 추상(시그널 0) | **벡터 0.5 단독 기여** ⭐ |
| 9 | 혼자 떠나는 근거리 주말 | theme(나홀로/근거리) | orphan 태그 |
| 10 | 설경 보러 일본 | theme+geo | 시즌 의도 |

⭐ **8번이 설계의 핵심**: keyword/geo/theme 시그널이 0 → 오직 벡터가 순위를
결정. sweep 에서 벡터 가중치가 "제 값을 하는지"를 격리 측정한다.

> 실제 라벨 값은 구현 단계에서 fixture(실제 코퍼스 상품 목록)를 보고 확정.
> 초안 쿼리도 코퍼스 확인 후 미세 조정 가능(의도 유형 균형은 유지).

---

## 6. 스코어 미러 (`scoreReplica.ts`)

SQL 하이브리드 공식을 **순수 TS로 1:1 복제**(가중치를 주입 가능하게):

```ts
score(product, query, W) =
    cosineSim(query.embedding, product.embedding) × W.vector
  + (matchesKeyword(product, query.cleanedQuery)  ? W.keyword : 0)
  + (matchesGeo(product, query.geoTerms)          ? W.geo     : 0)
  + themeBoost(matchCount, requestedThemeCount)   // 엔티티 SSOT 재사용
```

- `cosineSim`: `dot(a,b) / (‖a‖·‖b‖)` — 정규화 가정하지 않고 전체 코사인 계산
  (SQL `1 - (v <=> q)` 와 동치).
- `matchesKeyword`: `title|destination|summary` 중 하나라도
  `toLowerCase().includes(kw.toLowerCase())` (ILIKE 부분일치 복제).
- `matchesGeo`: `geoTerms` 중 하나라도 `destination` 부분일치(ILIKE ANY 복제).
- `themeBoost`: **엔티티에서 import**(이미 SSOT). matchCount = 쿼리 themeTags 중
  상품 tags 에 존재하는 개수, requested = 쿼리 themeTags 길이.
- **hard filter**: `priceMax`(상품가 ≤ priceMax), `durationNights`(min≤nights≤max+1)
  도 SQL 과 동일하게 후보에서 배제한 뒤 점수 계산.

### 6.1 Drift 가드 (3중 surface 동기화)
현재 공식은 이미 SQL + `themeBoost`(TS) 2곳에 미러돼 있고, 여기에 replica 가
3번째 surface 가 된다. drift 차단:
1. **가중치 SSOT 단일화**: 4개 `const X_WEIGHT` 를 `entities/product` 에서
   `export const SEARCH_WEIGHTS = { vector, keyword, geo, theme }` 객체로 통합.
   SQL(기존 `${VECTOR_WEIGHT}` 인터폴레이션) · replica · eval 이 **같은 상수**를
   읽는다. (production 동작 변화 0 — 값 동일, 단지 묶음.)
2. **themeBoost 재사용**: 테마항은 새로 안 짠다(엔티티 함수 그대로).
3. **핀 테스트**: 손으로 계산한 합성 케이스(코사인·키워드·geo·테마 각 1)를
   replica 에 넣어 기대 점수를 vitest 로 고정 → 공식 변경 시 즉시 FAIL.

---

## 7. nDCG (`ndcg.ts`)

```
DCG@k  = Σ_{i=1..k} (2^rel_i − 1) / log2(i + 1)     // rel_i = 랭크 i 아이템 라벨
IDCG@k = 이상 정렬(라벨 내림차순)의 DCG@k
nDCG@k = DCG@k / IDCG@k    (IDCG=0 이면 0)
```

- 보고 지표: **nDCG@3, nDCG@5**. (코퍼스 11개라 @10 은 거의 1로 포화 →
  판별력은 @3·@5 에 있다.)
- 순수 함수 + 엣지 테스트: 빈 결과, IDCG=0(전부 무관), k>결과수, 동점 라벨.

---

## 8. 평가 러너 (`run-eval.ts`)

- **baseline 모드(기본)** — `npm run search:eval`
  - 현 프로덕션 가중치(`SEARCH_WEIGHTS`)로 쿼리별 `nDCG@3·@5` 테이블 + 전체
    평균(mean nDCG) 출력. 현 밸런스의 정량 baseline.
- **sweep 모드** — `npm run search:eval -- --sweep`
  - 합≈1.0 simplex 격자(step 0.1, 4변수 → ~286조합) 전수 평가.
  - mean nDCG 내림차순 **리더보드 Top-N** + **현 baseline 의 순위/점수** 표시.
  - "현 가중치가 최적 근방인가?"를 한눈에. (11쿼리×11상품×1536 내적 → 1초 미만.)
- 완전 결정론(고정 fixture). 네트워크·DB 0.

---

## 9. 검증 (QA)

- `npm run typecheck` / `npm run test` 통과.
- `ndcg.ts` 단위테스트(엣지 케이스), `scoreReplica.ts` 핀/drift 가드 테스트.
- `npm run search:eval` 실행 출력(테이블) 을 증거로 인용.
- `SEARCH_WEIGHTS` 리팩터가 기존 검색 동작을 안 바꿨는지: `searchByVector`
  관련 기존 테스트 그대로 통과.

---

## 10. 산출물 & 후속

- 본 하네스는 **측정 도구**. 운영 가중치 변경은 별도 사람 결정.
- sweep 결과가 현 0.5/0.2/0.2/0.1 과 유의미하게 다르면 → **가중치 변경(또는
  현행 유지) 결정을 ADR 로 박제**(거부한 조합과 근거 포함). 변경 시
  `SEARCH_WEIGHTS` 한 곳 + fixture 재추출 불요(가중치는 eval 시 주입, 운영은
  상수).

---

## 11. 비목표 (YAGNI)

- 운영 클릭로그/CTR 기반 자동 라벨링(소표본·트래픽 부재 — 과설계).
- 가중치 자동 적용/지속 학습(D3: 리포트-온리).
- @10 이상 지표·MAP·MRR(코퍼스 11개라 @3·@5 로 충분).
- 라우터(LLM/규칙) 자체 튜닝(이번 범위는 *가중치 밸런스* 한정).
