# ADR-0047: 태그 vocabulary SSOT + 중앙화된 `#` 변환 — 데이터 무결성·드리프트 방어

- **상태**: Accepted
- **결정일**: 2026-06-10
- **영향 범위**: `src/shared/lib/tags.ts`, `src/features/search/server/router.ts`, `src/entities/product/api/searchByVector.ts`, `src/shared/lib/__tests__/tags.test.ts`
- **관련 commit**: `706269e` `a5cf6bb` `add74ac` `e934ebf` `7ba274c` (merge `3758481`, PR #21)

## Context (배경)

정규 태그가 **3곳에 암묵적으로 분산**돼 있었다:
- `THEME_KEYWORDS`(router) — 값이 `#` 없는 정규형(`가족`)
- `ProductTag.tag`(DB) — `#` 포함 저장형(`#가족`)
- `normalizeThemeTags`(searchByVector) — 매칭 시 `#` 부착

SSOT가 없어 한 곳만 어긋나도 검색 매칭이 깨졌다. 표면 증상 둘:
1. **`##가족` 표시 버그** — 저장형(`#가족`)에 UI가 `#`를 또 붙임(fix `bd6082f`). 표기 규칙이 분산된 결과.
2. **orphan 태그 7개** — 상품엔 있으나 `THEME_KEYWORDS`에 매핑이 없어 검색 키워드로 테마 부스트가 영영 안 걸림. "나홀로 여행"·"주말 근거리" 검색의 `themeTags`가 `undefined`였다.

문서 컨벤션만으로는 강제력이 없어 같은 부류가 재발할 수밖에 없는 구조였다.

## Decision (결정)

1. **단일 SSOT** — 정규 태그 27종을 `shared/lib/tags.ts`의 `TAG_VOCABULARY`로 선언. 시드·라우터·가드의 단일 출처.
2. **`#` 변환 중앙화** — `toStorageTag`(정규/중복 → `#` 정확히 1개)·`toCanonicalTag`(`#` 제거)를 SSOT에 두고, `normalizeThemeTags`가 경유.
3. **컴파일 타임 차단(push-left)** — `THEME_KEYWORDS` 값 타입을 `string`에서 `CanonicalTag`(리터럴 union)로 좁힘. 어휘 밖 값은 `tsc`가 즉시 거부.

```ts
export type CanonicalTag = (typeof TAG_VOCABULARY)[number];
export type ThemeKeywordsMap = Readonly<Record<string, CanonicalTag>>;
// router.ts — 어휘 밖 value 입력 시 컴파일 에러
export const THEME_KEYWORDS: ThemeKeywordsMap = { 가족: "가족", /* ... */ };
```

4. **런타임 드리프트 가드 + orphan 보강** — 테스트가 `THEME_KEYWORDS` 값과 시드 태그가 `TAG_VOCABULARY` 부분집합인지 검사. orphan(나홀로·근거리·도심)에 키워드 매핑을 추가해 테마 카드 부스트를 정상화.

## Consequences (결과)

**얻은 것:**
- 태그 표기·어휘의 **단일 진실**. `##` 표시 버그류 재발 봉합.
- **이중 방어** — 타입(컴파일)으로 1차, 가드 테스트(런타임)로 2차 드리프트 차단.
- "나홀로/주말 근거리" 테마 카드 부스트 정상화(회귀 테스트로 박제).

**포기한 것 / 미해결:**
- admin 태그 입력은 **자유 텍스트 유지** — 런타임에 admin이 어휘 밖 태그를 입력하는 것은 가드 범위 밖(의도된 B안 경계). 가드는 시드·라우터 정적 데이터 기준.
- 장소·활동성 태그 4종(`알프스`·`하카타`·`해양스포츠`·`화이트비치`)은 어휘엔 포함하되 `THEME_KEYWORDS` 키워드는 미부여(설명용 — 검색 부스트 대상 아님).

## Alternatives Considered (대안)

### 옵션 A: admin 입력을 vocabulary 드롭다운으로 제약 (C안)
- 자유 텍스트 → 멀티셀렉트로 런타임 orphan 원천 차단.
- 거부: admin UI 개수 작업 + 포트폴리오 범위 대비 과설계. 정적 가드로 재발의 주요 경로(시드·라우터)는 이미 봉합. YAGNI.

### 옵션 B: `ProductTag.tag`을 `#` 없이 저장하도록 데이터 마이그레이션
- 저장형을 정규형으로 통일.
- 거부: 검색 SQL·저장·기존 데이터 전반에 영향 + 마이그레이션 리스크. 표시/변환 계층(`toStorageTag`/`formatTagLabel`) 중앙화로 동일 효과를 무위험으로 달성.

### 옵션 C: 문서 컨벤션만(코드 강제 없음)
- "태그는 어휘 내에서만" 규칙을 문서로.
- 거부: 강제력 0 → 같은 드리프트 재발. SSOT + 가드가 규칙을 실행 가능하게(executable) 만든다.

### 옵션 D: `THEME_KEYWORDS` 값 타입 `string` 유지 + 런타임 가드만
- 가드 테스트로만 검사.
- 거부: 빌드는 통과하고 테스트 실행에서만 발견. `CanonicalTag` 타입으로 오류 발견 시점을 "파일 저장"으로 앞당김(push-left). 런타임 가드는 보조·문서 역할로 병행.

## Notes

- admin 드롭다운 제약(옵션 A)은 미래 옵션 — 런타임 orphan이 실제 문제가 되면 재검토.
- 장소성 태그에 검색 키워드를 부여하려면 `THEME_KEYWORDS`에 매핑만 추가(가드 자동 통과).
- `formatTagLabel`(표시, `shared/lib/format.ts`)과 `toStorageTag`/`toCanonicalTag`(정규/저장, `tags.ts`)는 역할 분리 — 표시는 format, 데이터 변환은 tags.
