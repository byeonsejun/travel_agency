# Spec — 포트폴리오 최적화: 상품 이미지 Supabase 마이그레이션 + 태그 Vocabulary 동기화

- **작성일**: 2026-06-10
- **상태**: 승인됨 (브레인스토밍 → 설계 확정)
- **관련**: [ADR-0026](../adr/) 임베딩 파이프라인, [ADR-0045] 테마 부스트, 시드(`prisma/seed.ts`·`prisma/themeProducts.ts`), 검색 라우터(`src/features/search/server/router.ts`)
- **범위 노트**: 두 작업(Part A 이미지 / Part B 태그)은 독립적이나 "포트폴리오 시각·검색 완성도"라는 한 목표로 묶어 단일 스펙으로 진행. 구현 plan에서 Phase로 분리.

---

## 1. 배경 / 문제

1. **상품 대표 이미지가 외부 placeholder(picsum.photos) 의존** — 시드 22개 전부 `https://picsum.photos/seed/{seed}/800/500`. 제작자가 운영 사용을 권장하지 않으며(고트래픽 차단 + Referer 유출), 랜덤 이미지라 포트폴리오 시각 완성도가 낮다. 정작 **admin 업로드 인프라(`getHeroUploadUrl` → Supabase `product-hero/{uuid}` → publicUrl)는 이미 구현**돼 있으나 시드 데이터가 이를 안 쓴다.
2. **태그 vocabulary 드리프트 위험** — 정규 태그가 3곳(`THEME_KEYWORDS` 값 = `#` 없음, `ProductTag.tag` = `#` 포함 저장, `normalizeThemeTags` = 매칭 시 `#` 부착)에 분산. SSOT 부재로 한 곳만 어긋나도 검색 매칭이 깨진다(최근 `##` 표시버그가 같은 뿌리). 구체적 증상: **고아(orphan) 태그 7개**(`근거리·도심·나홀로·알프스·하카타·해양스포츠·화이트비치`)가 상품엔 있으나 `THEME_KEYWORDS`에 매핑이 없어 검색 키워드로 테마 부스트가 영영 안 걸림 → "나홀로 여행"·"주말 근거리" 테마 카드의 `themeTags=undefined`.

## 2. 목표 / 비목표

**목표**
- picsum 의존을 **완전히 제거**하고 22개 상품을 Supabase 호스팅 이미지로 전환. 재시드해도 picsum이 돌아오지 않음.
- 정규 태그 **단일 SSOT** 확립 + `#` 변환 중앙화 + 드리프트 가드 테스트로 재발 차단.
- 의미있는 orphan(나홀로·근거리·도심)에 키워드 매핑 보강 → 테마 카드 부스트 정상화.

**비목표 (YAGNI)**
- admin 태그 입력을 vocabulary 드롭다운으로 제약(C안 거부 — 자유입력 유지).
- 리뷰 사진 버킷 분리, 이미지 리사이즈/변환 파이프라인(`next/image`가 처리), 레포에 이미지 에셋 커밋.
- 라이브 실결제 등 NO-REAL-MONEY 위반 사항 일체.

## 3. 핵심 전제 (검증 완료)

- **로컬·운영이 동일 Supabase 프로젝트(`hcixfplgumqidpjowntb`) 공유** → 이미지 업로드는 **1회**(로컬 `sb_secret_` service-role 키)로 양쪽 환경 모두 커버.
- `next.config.mjs` `remotePatterns`에 `*.supabase.co/storage/v1/object/public/**` **이미 허용**됨 → 추가 설정 불요.

---

## 4. Part A — 이미지 마이그레이션 설계

### 4.1 큐레이션 맵
- `prisma/heroImageSources.ts`: `HERO_IMAGE_SOURCES: Record<slug, unsplashUrl>` (22 슬러그).
- 각 URL은 **검증된 실제** `images.unsplash.com/photo-...` 직링크(Unsplash License — 상업·무료·허가불요). 구현 첫 단계에서 `WebFetch`/HEAD로 200·이미지 확인.
- 상품별 고유 사진이 이상적이나, **여행지 카테고리 단위 재사용 허용**(YAGNI — 목표는 시각 안정성이지 유일성 강제 아님). 슬러그는 기존 picsum seed 값(`osaka-kyoto` 등)을 그대로 사용해 1:1 매핑.

### 4.2 URL 빌더 (env-portable, client-safe)
- `src/shared/lib/supabase/photoMime.ts`에 추가:
  ```ts
  export const HERO_SEED_PREFIX = "product-hero/seed";
  export function buildHeroSeedPublicUrl(slug: string): string {
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL; // env.ts 미사용(client-safe 규칙)
    return `${base}/storage/v1/object/public/${REVIEW_PHOTO_BUCKET}/${HERO_SEED_PREFIX}/${slug}.jpg`;
  }
  ```
- `env.ts` import 금지(메모리: client island ZodError 사고 방지). `process.env.NEXT_PUBLIC_SUPABASE_URL` 직접 접근(Next 빌드타임 인라인).

### 4.3 마이그레이션 스크립트
- `prisma/migrate-hero-images.ts` (일회성, 멱등):
  1. `HERO_IMAGE_SOURCES` 순회 → 각 Unsplash 원본 `fetch`(ArrayBuffer).
  2. Supabase Storage `product-images` 버킷 `product-hero/seed/{slug}.jpg` 에 `upload(..., { upsert: true })`.
  3. `Product`에서 slug에 해당하는 상품을 찾아(현재 picsum URL의 seed로 역매핑, 또는 title 매핑 테이블) `heroImageUrl = buildHeroSeedPublicUrl(slug)` 로 `update`.
  4. 안전장치: `DATABASE_URL`이 비었으면 중단. 업로드 실패 시 해당 항목 skip + 로깅(부분 실패 격리).
- **slug ↔ 상품 매핑**: 시드가 picsum seed를 슬러그로 사용 중이므로, `heroImageSources.ts`에 `{ slug, productMatch }`(title 또는 기존 picsum seed)로 명시. 모호성 0.

### 4.4 재시드 내성
- `prisma/seed.ts`(10개 인라인) + `prisma/themeProducts.ts`(12개, `s.heroSeed` 사용)의 picsum 리터럴을 **`buildHeroSeedPublicUrl(slug)` 호출로 교체**. 이후 `npm run db:seed` 해도 Supabase URL 유지.

### 4.5 실행
- 업로드 1회(로컬 creds, 공유 프로젝트) + `heroImageUrl` UPDATE를 **로컬 DB**와 **운영 DB** 각각 1회. (업로드는 공유라 1회로 충분, UPDATE만 환경별.)

### 4.6 검증
- 마이그레이션 후 22개 `heroImageUrl` 호스트가 전부 `*.supabase.co` 인지 쿼리.
- 업로드된 객체가 public GET 200인지 표본 확인(`buildHeroSeedPublicUrl` 결과 fetch).

---

## 5. Part B — 태그 Vocabulary 동기화 설계 (B안)

### 5.1 SSOT
- `src/shared/lib/tags.ts` 신설:
  ```ts
  /** 정규 태그(canonical, '#' 없음) — 시드·라우터·가드의 단일 출처. */
  export const TAG_VOCABULARY = [
    "가족","허니문","나홀로","온천","료칸","부모님","휴양","리조트","풀빌라",
    "유럽","가성비","미식","라멘","해변","설경","노쇼핑","자유시간","프리미엄",
    "역사","문화","스노클링","근거리","도심","알프스","하카타","해양스포츠","화이트비치",
  ] as const;
  export type CanonicalTag = (typeof TAG_VOCABULARY)[number];
  export function toStorageTag(c: string): string { return `#${c.replace(/^#+/, "")}`; }
  export function toCanonicalTag(stored: string): string { return stored.replace(/^#+/, ""); }
  ```
- 표시용 `formatTagLabel`(기구현, `shared/lib/format.ts`)과 역할 분리: `format`=표시, `tags`=정규/저장 변환 + vocabulary.

### 5.2 `#` 일원화
- `src/entities/product/api/searchByVector.ts`의 `normalizeThemeTags`를 `toStorageTag` 경유로 교체(중복 `#` 부착 로직 제거).
- 라우터 `THEME_KEYWORDS` 값은 전부 **canonical**(`TAG_VOCABULARY` 원소) 유지.

### 5.3 orphan 키워드 보강
- `THEME_KEYWORDS`에 추가: `나홀로→나홀로`(+`혼자→나홀로`), `근거리→근거리`(+`주말→근거리`), `도심→도심`(+`시내→도심`).
- 장소·활동성 태그(`알프스·하카타·해양스포츠·화이트비치`)는 vocabulary엔 포함(상품이 사용)하되 **키워드 매핑 미부여**(설명용 — 검색 키워드로 부스트할 의미 적음). 이는 "허용된 orphan"으로 가드에서 예외 처리.

### 5.4 드리프트 가드 테스트
- `src/shared/lib/__tests__/tags.test.ts` 또는 통합 가드:
  1. **시드 태그 ⊆ vocabulary**: `seed.ts`+`themeProducts.ts`의 모든 `ProductTag.tag`(canonical 변환)가 `TAG_VOCABULARY`에 존재.
  2. **THEME_KEYWORDS 값 ⊆ vocabulary**: 모든 매핑 value가 `TAG_VOCABULARY`에 존재.
  3. **테마 카드 회귀**: `routeQuery("가족여행"|"허니문"|"나홀로 여행"|"주말 근거리")`가 비어있지 않은 `themeTags`를 생성.
- 가드는 **시드·라우터 정적 데이터 기준**. admin 런타임 자유입력은 B안 범위 밖임을 스펙·주석에 명시.

### 5.5 검증
- 위 가드 테스트 통과 + 기존 `searchByVector`/router 테스트 무회귀 + 운영 DB에서 "나홀로 여행"·"주말 근거리"가 테마 부스트로 상품 반환(종단).

---

## 6. 테스트 전략 요약
- **Part A**: `buildHeroSeedPublicUrl` 단위테스트(env stub), 업로드 멱등성(upsert 재실행), 마이그레이션 후 호스트 검증, public GET 표본.
- **Part B**: vocabulary 가드 3종, `toStorageTag`/`toCanonicalTag` 단위테스트, 테마 카드 회귀, 기존 검색 테스트 무회귀.
- TDD: 순수 함수(`buildHeroSeedPublicUrl`·`toStorageTag`·가드)는 테스트 선작성 → FAIL → 구현 → PASS.

## 7. 실행/롤아웃
1. 코드(빌더·SSOT·가드·시드 교체·스크립트) + 로컬 검증 → 커밋/PR.
2. 업로드 스크립트 실행(공유 Supabase 1회) + 로컬 DB 마이그레이션.
3. 운영 DB `heroImageUrl` UPDATE(.env.prod) — **문자열 갱신이라 저위험·가역**.
4. 배포(main 머지 → Vercel) 후 운영 종단 검증(이미지 노출 + 테마 검색).

## 8. 리스크 / 완화
- **Unsplash URL 404**: 구현 첫 단계에서 전수 검증, 실패 항목은 카테고리 대체 이미지로 교체.
- **prod 업로드 권한**: 공유 프로젝트라 로컬 `sb_secret_` 키로 1회 업로드 → prod 별도 키 불요.
- **시드 slug ↔ 상품 매핑 누락**: `heroImageSources.ts`에 명시 매핑 + 마이그레이션 시 미매칭 상품 경고 로깅.
- **가드의 한계**: admin 자유입력 런타임 태그는 못 막음(의도된 범위) — 문서화로 오해 방지.

## 9. ADR 후보
- **공유 Supabase 프로젝트 + env-portable hero URL**(업로드 1회 전략) — 박제 가치 있음.
- **태그 vocabulary SSOT + `#` 변환 중앙화 + 드리프트 가드** — 결정 박제 가치 있음.
