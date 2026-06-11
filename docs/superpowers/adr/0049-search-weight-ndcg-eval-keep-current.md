# ADR-0049: 검색 가중치 nDCG eval 하네스 도입 + 현행 가중치(0.5/0.2/0.2/0.1) 유지 결정

- **상태**: Accepted
- **결정일**: 2026-06-11
- **영향 범위**: `scripts/search-eval/`, `src/entities/product/model/searchWeights.ts`, `src/entities/product/api/searchByVector.ts`
- **관련 commit**: `6b8d715` (golden set) · `924966c` (20-product fixture) · `6b6...`(SEARCH_WEIGHTS SSOT) · `b557497` (plan 완료)

## Context (배경)

하이브리드 검색 점수식은 벡터 0.5 / 키워드 0.2 / geo 0.2 / 테마 0.1 의 네 가중치를 합산한다([ADR-0045] graduated theme boost 포함). 이 비율은 도입 이래 **직관으로 정한 값**일 뿐, 정량 근거가 없었다. "벡터를 더 키우면? geo를 줄이면?" 같은 질문에 답할 측정 수단이 없어, 가중치 변경은 곧 회귀 위험을 감수하는 도박이었다.

문제는 (a) 정답지(relevance ground truth)가 없고, (b) 임베딩이 OpenAI 네트워크·키·DB에 의존해 평가 자체가 비결정론적이라는 점이었다. CI나 반복 실험에 쓸 수 없다.

## Decision (결정)

**오프라인 결정론 nDCG eval 하네스**를 구축하고, 그 결과로 **현행 가중치를 유지**한다.

1. **fixture 박제** — OpenAI 임베딩을 1회만 추출해 `corpus.fixture.json`(20상품) / `queries.fixture.json`(10쿼리)로 커밋. 이후 eval은 키·DB·네트워크 0으로 재현 가능.
2. **scoreReplica** — 프로덕션 SQL 점수식을 순수 TS로 1:1 미러. 단 가중치·`themeBoost`는 `entities/product`의 단일 SSOT(`searchWeights.ts`)에서 import → 코드/SQL/eval 3중 surface의 drift를 구조적으로 차단.
3. **golden set** — 10개 쿼리 × 수작업 0~3 등급 라벨(의도 유형을 고르게: 복합/theme/geo/추상-벡터격리 등).
4. **sweep** — 합 1.0인 0.1-step simplex 격자 286개를 전수 평가, mean nDCG@5로 리더보드.

**측정 결과 → 현행 유지:**

```
baseline v0.5/k0.2/g0.2/t0.1 : mean nDCG@5 = 0.8961  (순위 64/286, 상위 22%)
sweep 최상위                  : 0.9060            (+0.0099, 상대 +1.1%)
```

최상위 후보의 이득(+0.0099)은 10-query golden 셋의 측정 노이즈 범위 안이고, top-15가 전부 0.9060에 동률이며 공통적으로 *벡터를 낮추고 geo+theme를 키우는* 방향이라 일반화(과적합) 위험이 크다. → **가중치 변경하지 않음. 하네스는 리포트-온리로 유지.**

## Consequences (결과)

**얻은 것:**
- 가중치 논쟁을 직관 → 데이터로 전환. `npm run search:eval [-- --sweep]`로 누구나 재현.
- `SEARCH_WEIGHTS` SSOT 추출로 코드/SQL/eval drift 차단 + `themeBoost`에 ceiling 파라미터 주입 가능(운영 동작 0 변화 리팩터).
- 향후 가중치/공식 변경 시 회귀를 정량 가드할 baseline 확보.

**포기한 것 / 미해결:**
- golden 셋이 10쿼리로 작다 → sweep 1·2위의 미세 차이는 신뢰구간 밖. "최적값 자동 적용"은 의도적으로 하지 않음(노이즈 추종 방지).
- eval은 코퍼스 20상품 한정. 실 트래픽 쿼리 분포와 다를 수 있음(대표성 한계).

## Alternatives Considered (대안 — 가장 중요한 섹션)

### 옵션 A: sweep 1위(0.9060) 가중치로 운영 전환
- 격자 최상위 조합을 그대로 채택.
- **거부** — 이득이 +0.0099(상대 1.1%)로 10-query 노이즈에 묻히고, 동률 15개가 모두 벡터를 깎는 방향이라 작은 라벨 셋에 과적합된 신호일 가능성이 높다. 의미상 벡터(의미 유사도)를 낮추는 건 미지의 신규 쿼리에서 오히려 손해.

### 옵션 B: 실시간(온라인) 임베딩으로 eval
- 매 실행마다 OpenAI 호출.
- **거부** — 비결정론 + 키·비용·네트워크 의존으로 CI·반복 실험 불가. fixture 박제가 재현성·비용 모두에서 우월.

### 옵션 C: eval 없이 직관으로 가중치 조정
- 기존 방식 유지.
- **거부** — 측정 없는 변경은 회귀를 보지 못한다. 본 ADR의 동기 자체.

## Notes

- 가중치를 바꾸려면 `SEARCH_WEIGHTS` **한 곳만** 수정하면 된다 — fixture 재추출 불요(가중치는 eval 시 주입, 운영은 상수). 변경 시 본 ADR을 `Superseded by`로 마킹.
- golden 셋을 30~50쿼리로 확장하면 sweep 상위 차이의 신뢰도가 올라간다 — 그때 재논의 가치 있음.
- 테마 부스트 공식 자체는 [ADR-0045]가 SSOT. 본 ADR은 *가중치 밸런스*에 한정.
