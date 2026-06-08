# Spec — themeTags Graduated Soft Boost (Phase 16, Target C)

- **작성일**: 2026-06-09
- **상태**: Approved (브레인스토밍 승인 완료)
- **영향 범위**: `src/entities/product/api/searchByVector.ts`, `src/entities/product/api/__tests__/searchByVector.test.ts`
- **관련 ADR 후보**: "이진 테마 부스트 → 요청 커버리지 비율 graduated, 천장 0.1 유지"

---

## 1. 배경 (Context)

`searchProductsByVector`는 이미 하이브리드 스코어링을 운영 중이다([M-AI-SEARCH], commit `acfc519`):

```
score = 코사인유사도 × 0.5 + 키워드ILIKE × 0.2 + geo × 0.2 + 테마 × 0.1
```

이 중 **테마 항**(`buildThemeScore`)은 현재 **이진(binary) 플랫 부스트**다:

```sql
CASE WHEN EXISTS (
  SELECT 1 FROM "ProductTag" pt
  WHERE pt."productId" = p.id AND pt.tag = ANY(${tags})
) THEN 0.1 ELSE 0 END
```

### 문제

요청 태그가 여러 개일 때, **하나만 맞아도 전부 맞아도 동일하게 `+0.1`**이다. 예컨대 사용자가 "휴양 미식 가성비"로 검색하면:

- 세 태그를 **모두** 가진 상품 → `+0.1`
- "휴양" **하나만** 가진 상품 → `+0.1` (동점)

사용자 의도를 더 잘 충족하는 다태그 상품이 단일 매칭 상품 대비 랭킹 우위를 갖지 못한다.

## 2. 결정 (Decision)

테마 항을 **요청 태그 커버리지 비율(coverage ratio)** 에 비례하는 graduated 부스트로 전환한다. **천장은 0.1로 동일 유지**한다.

### 2.1 스코어링 공식 (SSOT)

```
themeBoost(matchCount, requested) =
  requested === 0 ? 0 : THEME_WEIGHT × (matchCount / requested)
```

- `THEME_WEIGHT = 0.1` (기존 상수 재사용 — 천장 불변)
- `matchCount` = 상품이 보유한 **요청 태그 적중 개수** = `count(*) FROM "ProductTag" WHERE tag = ANY(요청태그)`
- `requested` = 정규화된 요청 테마 태그 개수 (`normalizeThemeTags(...).length`)

### 2.2 경계 안전성 (수학적 보증)

`ProductTag`에 `@@unique([productId, tag])` 제약이 있다(`prisma/schema.prisma:167`). 따라서 한 상품이 동일 태그를 중복 보유할 수 없고:

```
0 ≤ matchCount ≤ requested  →  0 ≤ matchCount/requested ≤ 1  →  0 ≤ themeBoost ≤ 0.1
```

`count(*)`가 천장을 초과하는 일이 구조적으로 불가능하므로 **cap(상한 클램프) 로직이 불필요**하다.

### 2.3 효과 예시 (requested = 3)

| 상품 | matchCount | themeBoost |
|---|---|---|
| 휴양 + 미식 + 가성비 | 3 | 0.100 |
| 휴양 + 미식 | 2 | 0.067 |
| 휴양 | 1 | 0.033 |
| (테마 무관) | 0 | 0.000 |

기존 가중치 밸런스(벡터 0.5 / 키워드 0.2 / geo 0.2 / 테마 0.1)는 천장이 동일하므로 **무손상**이다. 이진을 연속값으로 세분화할 뿐, 생태계는 보존된다.

## 3. 타격 범위 (Scope)

### 3.1 변경 — 벡터 주경로만

| 파일 | 변경 |
|---|---|
| `searchByVector.ts` | 순수 헬퍼 `themeBoost(matchCount, requested): number` 추가·export (TDD 표적, 공식 SSOT 문서화) |
| `searchByVector.ts` | `buildThemeScore`: `CASE WHEN EXISTS THEN 0.1` → `THEME_WEIGHT × count(*) / requested` 로 SQL 산술 교체. SQL은 `themeBoost`와 **동일 산술을 미러**하며, drift 위험을 주석으로 박제 |
| `searchByVector.test.ts` | graduated invariant 단위 테스트 추가 + 기존 "soft boost" SQL 통합 테스트 갱신 |

### 3.2 비채택 (YAGNI / 의도적 제외)

- **키워드 폴백(pgvector 부재 강등 경로)**: binary 'theme-first' 정렬 그대로 유지. ILIKE 폴백은 희귀 강등 경로이고 이미 테마 매칭을 우선 정렬하므로 graduated 전파는 ROI 낮음. (`keywordFallback`의 `themeOrder` 미변경)
- **절대 가산 + cap**: 천장이 가변이 되어 가중치 밸런스가 깨질 위험 → 거부.
- **sqrt 체감 곡선**: 튜닝 근거가 약하고 복잡도만 증가 → 거부.
- **golden-query / nDCG eval 하네스**: 측정 기반 튜닝은 별도 마일스톤. 본 Phase는 결정론적 invariant 증명까지 → 거부.

## 4. 검증 (Verification) — 결정론적 TDD

순수 `themeBoost` 함수에 ordering invariant를 단언한다. DB 불요·재현 가능·저비용.

| Invariant | 단언 |
|---|---|
| 천장 정확 | `themeBoost(n, n) === 0.1` |
| 0 매칭 | `themeBoost(0, n) === 0` |
| 0 요청 가드 | `themeBoost(x, 0) === 0` (division-by-zero 차단) |
| 단조 증가 | `matchCount` 증가 시 score 비감소 |
| 비율 순서 | `themeBoost(1,3) < themeBoost(2,3) < themeBoost(3,3)` (다태그 우선) |
| 부분 비율 값 | `themeBoost(1,3) ≈ 0.0333` (요청 대비 비율) |

추가로 기존 SQL 통합 테스트(`searchByVector.test.ts:95`)를 graduated 공식 반영해 갱신: SELECT 점수식에 `ProductTag` `count(*)`/요청수 산술이 존재하고, 메인 WHERE에는 여전히 ProductTag 하드배제가 없어야 함(soft 정신 유지).

`npm run typecheck` / `npm run test` / `npm run lint` 통과를 완료 증거로 인용한다.

## 5. 대안 검토 (Alternatives Considered)

### 옵션 A: 절대 가산 + cap — `min(matchCount × 0.05, cap)`
- **왜 거부**: 강한 테마 매칭이 기존 0.1 천장을 넘어 벡터(0.5) 우위를 잠식할 수 있어 가중치 재균형이 필요. 밸런스 생태계 변경은 회귀 위험이 큼.

### 옵션 B: 체감식(sqrt) — `0.1 × sqrt(matchCount)/sqrt(requested)`
- **왜 거부**: 첫 매칭 이득을 크게, 추가 매칭을 체감시키는 곡선이나, 본 데이터 규모에서 튜닝 근거가 약하고 복잡도만 증가. 선형 비율이 의미("의도 커버리지")가 더 직관적.

### 옵션 C: 메모리 단 재정렬(application re-ranking)
- **왜 거부**: 이미 DB-단 `$queryRaw` 가중합으로 `ORDER BY score LIMIT 20`이 확립([M-AI-SEARCH]). 메모리 재정렬은 LIMIT 이전 전체 후보를 끌어와야 해 비효율이고, 인젝션 안전 바인딩 패턴(R6)을 깸. graduated도 동일 SELECT 항만 교체하는 게 최소 침습.

### 옵션 D: 폴백 경로도 graduated
- **왜 거부**: pgvector 부재 강등 경로는 희귀하고 이미 theme-first 정렬. 두 경로를 동일 공식으로 유지하는 보수 비용 대비 이득 미미.

## 6. 참고

- 기존 구현: `src/entities/product/api/searchByVector.ts` (`buildThemeScore`, `VECTOR_WEIGHT`/`KEYWORD_WEIGHT`/`GEO_WEIGHT`/`THEME_WEIGHT`)
- 임베딩 파이프라인: [ADR-0026]
- 선행 마일스톤: `docs/superpowers/plans/done/2026-05-19-ai-search.md`, `docs/superpowers/specs/2026-05-19-ai-search-design.md`
