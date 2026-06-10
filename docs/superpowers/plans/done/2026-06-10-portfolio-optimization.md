# Portfolio Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** picsum 의존을 Supabase 호스팅 이미지로 완전 대체하고, 태그 vocabulary를 단일 SSOT로 규격화한다.

**Architecture:** (A) 일회성 스크립트가 Unsplash 원본을 공유 Supabase 프로젝트에 결정적 경로로 업로드하고 env-portable URL로 `heroImageUrl`을 갱신 + 시드 정의 교체(재시드 내성). (B) 정규 태그를 `shared/lib/tags.ts` SSOT로 모으고 `#` 변환을 중앙화, 드리프트 가드 테스트로 재발 차단, orphan 키워드 보강.

**Tech Stack:** Next.js 15, Prisma 5, Supabase Storage(`@supabase/supabase-js`), Vitest 2, TypeScript strict.

**Spec:** `docs/superpowers/specs/2026-06-10-portfolio-optimization.md`

---

## File Structure

**Part B (태그) — 먼저, 순수 코드:**
- Create `src/shared/lib/tags.ts` — `TAG_VOCABULARY` + `toStorageTag`/`toCanonicalTag`
- Create `src/shared/lib/__tests__/tags.test.ts` — 헬퍼 단위 + 드리프트 가드
- Modify `src/features/search/server/router.ts` — `export const THEME_KEYWORDS` + orphan 키워드 추가
- Modify `src/entities/product/api/searchByVector.ts` — `normalizeThemeTags`를 `toStorageTag` 경유

**Part A (이미지):**
- Create `prisma/heroImageSources.ts` — `{ slug → unsplashUrl }` 검증된 맵
- Modify `src/shared/lib/supabase/photoMime.ts` — `HERO_SEED_PREFIX` + `buildHeroSeedPublicUrl`
- Create `src/shared/lib/supabase/__tests__/photoMime.test.ts` — `buildHeroSeedPublicUrl` 단위
- Create `prisma/migrate-hero-images.ts` — 업로드 + heroImageUrl 갱신 스크립트
- Modify `prisma/seed.ts` + `prisma/themeProducts.ts` — picsum 리터럴 → `buildHeroSeedPublicUrl(slug)`

---

## Phase 1 — 태그 SSOT + 가드 (Part B)

### Task 1: 태그 SSOT 모듈 + 변환 헬퍼

**Files:**
- Create: `src/shared/lib/tags.ts`
- Test: `src/shared/lib/__tests__/tags.test.ts`

- [x] **Step 1: 실패 테스트 작성**

```ts
// src/shared/lib/__tests__/tags.test.ts
import { describe, it, expect } from "vitest";
import { TAG_VOCABULARY, toStorageTag, toCanonicalTag } from "../tags";

describe("toStorageTag — 정규 → 저장형('#' 1개)", () => {
  it("'#' 없는 정규태그에 '#' 부여", () => expect(toStorageTag("가족")).toBe("#가족"));
  it("이미 '#' 있으면 중복 안 함", () => expect(toStorageTag("#가족")).toBe("#가족"));
  it("'##' 중복도 1개로", () => expect(toStorageTag("##가족")).toBe("#가족"));
});

describe("toCanonicalTag — 저장형 → 정규('#' 제거)", () => {
  it("'#가족' → '가족'", () => expect(toCanonicalTag("#가족")).toBe("가족"));
  it("'가족' → '가족'", () => expect(toCanonicalTag("가족")).toBe("가족"));
});

describe("TAG_VOCABULARY", () => {
  it("중복 없음", () => expect(new Set(TAG_VOCABULARY).size).toBe(TAG_VOCABULARY.length));
  it("모두 '#' 없는 정규형", () =>
    expect(TAG_VOCABULARY.every((t) => !t.startsWith("#"))).toBe(true));
  it("핵심 테마 태그 포함", () =>
    ["가족", "허니문", "나홀로", "근거리", "도심"].forEach((t) =>
      expect(TAG_VOCABULARY).toContain(t)));
});
```

- [x] **Step 2: 실패 확인**

Run: `npx vitest run src/shared/lib/__tests__/tags.test.ts`
Expected: FAIL — `Cannot find module '../tags'`

- [x] **Step 3: 구현**

```ts
// src/shared/lib/tags.ts
/**
 * tags.ts — 정규 태그 vocabulary 단일 SSOT + '#' 변환 헬퍼.
 *
 * 정규형(canonical): '#' 없는 순수 태그명. 시드·라우터·가드의 단일 출처.
 * 저장형(storage):   ProductTag.tag 가 쓰는 '#' 접두 형태('#가족').
 * 표시형(display):   formatTagLabel(shared/lib/format.ts) — 화면 노출용.
 *
 * ⚠️ THEME_KEYWORDS(router)의 모든 value 와 시드 태그는 이 목록을 벗어나면 안 된다.
 *    드리프트는 tags.test.ts 가드가 차단한다.
 */
export const TAG_VOCABULARY = [
  "가족", "허니문", "나홀로", "온천", "료칸", "부모님", "휴양", "리조트", "풀빌라",
  "유럽", "가성비", "미식", "라멘", "해변", "설경", "노쇼핑", "자유시간", "프리미엄",
  "역사", "문화", "스노클링", "근거리", "도심", "알프스", "하카타", "해양스포츠", "화이트비치",
] as const;

export type CanonicalTag = (typeof TAG_VOCABULARY)[number];

/** 정규/저장 무엇이 들어와도 저장형('#' 정확히 1개)으로 정규화. */
export function toStorageTag(tag: string): string {
  return `#${tag.replace(/^#+/, "")}`;
}

/** 저장형('#가족') → 정규형('가족'). '#' 없으면 그대로. */
export function toCanonicalTag(tag: string): string {
  return tag.replace(/^#+/, "");
}
```

- [x] **Step 4: 통과 확인**

Run: `npx vitest run src/shared/lib/__tests__/tags.test.ts`
Expected: PASS (전체 통과)

- [x] **Step 5: 커밋**

```bash
git add src/shared/lib/tags.ts src/shared/lib/__tests__/tags.test.ts
git commit -m "feat(tags): add canonical tag vocabulary SSOT + # converters"
```

---

### Task 2: 라우터 orphan 키워드 보강 + THEME_KEYWORDS export

**Files:**
- Modify: `src/features/search/server/router.ts` (THEME_KEYWORDS 정의부)

- [x] **Step 1: THEME_KEYWORDS 를 export 로 바꾸고 orphan 키워드 6개 추가**

`const THEME_KEYWORDS` → `export const THEME_KEYWORDS`. 그리고 객체 끝(`스노클링: "스노클링",` 다음 줄)에 추가:

```ts
  // orphan 보강 (spec §5.3): 상품 태그는 있으나 키워드 매핑이 없던 정규태그.
  나홀로: "나홀로",
  혼자: "나홀로",
  근거리: "근거리",
  주말: "근거리",
  도심: "도심",
  시내: "도심",
```

- [x] **Step 2: typecheck**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [x] **Step 3: 커밋**

```bash
git add src/features/search/server/router.ts
git commit -m "feat(search): add orphan theme keywords (나홀로/근거리/도심) + export THEME_KEYWORDS"
```

---

### Task 3: normalizeThemeTags 를 toStorageTag 경유로 일원화

**Files:**
- Modify: `src/entities/product/api/searchByVector.ts` (`normalizeThemeTags` 함수 + import)

- [x] **Step 1: import 추가**

파일 상단 import 블록에 추가:

```ts
import { toStorageTag } from "@/shared/lib/tags";
```

- [x] **Step 2: normalizeThemeTags 본문 교체**

기존:
```ts
function normalizeThemeTags(themeTags: string[] | undefined): string[] {
  if (!themeTags || themeTags.length === 0) return [];
  return themeTags.map((t) => (t.startsWith("#") ? t : `#${t}`));
}
```
교체:
```ts
function normalizeThemeTags(themeTags: string[] | undefined): string[] {
  if (!themeTags || themeTags.length === 0) return [];
  return themeTags.map(toStorageTag); // '#' 변환 SSOT 경유 (중복 '#' 방어 포함)
}
```

- [x] **Step 3: 기존 검색 테스트 무회귀 확인**

Run: `npx vitest run src/entities/product/api/__tests__/searchByVector.test.ts`
Expected: PASS (기존 테스트 전부 통과 — 동작 동일, 구현만 SSOT 경유)

- [x] **Step 4: 커밋**

```bash
git add src/entities/product/api/searchByVector.ts
git commit -m "refactor(search): route theme tag '#' normalization through tags SSOT"
```

---

### Task 4: 드리프트 가드 + 테마 카드 회귀 테스트

**Files:**
- Modify: `src/shared/lib/__tests__/tags.test.ts` (가드 describe 추가)

- [x] **Step 1: 가드 테스트 추가**

파일 끝에 추가:

```ts
import { THEME_KEYWORDS } from "@/features/search/server/router";
import { routeQuery } from "@/features/search/server/router";
import { buildThemeProducts } from "../../../../prisma/themeProducts";

describe("드리프트 가드", () => {
  it("THEME_KEYWORDS 의 모든 value 는 vocabulary 안에 있다", () => {
    for (const tag of Object.values(THEME_KEYWORDS)) {
      expect(TAG_VOCABULARY, `'${tag}' 가 vocabulary 에 없음`).toContain(tag);
    }
  });

  it("themeProducts 의 모든 태그(정규화)는 vocabulary 안에 있다", () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tags = buildThemeProducts(today).flatMap((p) =>
      (p.tags as { create: { tag: string }[] } | undefined)?.create?.map((t) =>
        toCanonicalTag(t.tag),
      ) ?? [],
    );
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) {
      expect(TAG_VOCABULARY, `시드 태그 '${tag}' 가 vocabulary 에 없음`).toContain(tag);
    }
  });
});

describe("테마 카드 회귀 (orphan 보강 검증)", () => {
  it.each(["가족여행", "허니문", "나홀로 여행", "주말 근거리"])(
    "'%s' 검색은 비어있지 않은 themeTags 를 만든다",
    async (q) => {
      const routed = await routeQuery(q);
      expect(routed.themeTags, `'${q}' 의 themeTags 가 비어있음`).toBeTruthy();
      expect((routed.themeTags ?? []).length).toBeGreaterThan(0);
    },
  );
});
```

> 참고: `buildThemeProducts` 가 반환하는 tags 형태는 `prisma/themeProducts.ts` 의 실제 구조를 따른다. tags 가 `["#가족", ...]` 배열이면 위 `.create` 매핑 대신 `(p.tags as string[])?.map(toCanonicalTag)` 로 조정한다 (구현 시 themeProducts.ts 의 tags 필드 형태를 먼저 확인할 것).

- [x] **Step 2: themeProducts tags 형태 확인 후 테스트 정합**

Run: `grep -n "tags:" prisma/themeProducts.ts | head -3`
themeProducts 의 `tags` 가 문자열 배열(`["#가족", ...]`)이면 Step 1 의 themeProducts 블록을 다음으로 교체:
```ts
    const tags = buildThemeProducts(today).flatMap((p) =>
      ((p as { tags?: string[] }).tags ?? []).map(toCanonicalTag),
    );
```

- [x] **Step 3: 가드 통과 확인**

Run: `npx vitest run src/shared/lib/__tests__/tags.test.ts`
Expected: PASS — orphan 보강 덕분에 "나홀로 여행"·"주말 근거리"도 themeTags 생성

- [x] **Step 4: 커밋**

```bash
git add src/shared/lib/__tests__/tags.test.ts
git commit -m "test(tags): drift guards (vocab ⊇ keywords+seed) + theme card regression"
```

---

### Task 5: Phase 1 전체 회귀

- [x] **Step 1: 전체 테스트 + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 전부 PASS, 타입 에러 없음

- [x] **Step 2: (회귀 시) 수정 후 재실행** — 실패 테스트가 있으면 해당 Task 로 돌아가 수정.

---

## Phase 2 — 이미지 인프라 (Part A 코드)

### Task 6: env-portable hero URL 빌더

**Files:**
- Modify: `src/shared/lib/supabase/photoMime.ts` (끝에 추가)
- Create: `src/shared/lib/supabase/__tests__/photoMime.test.ts`

- [x] **Step 1: 실패 테스트 작성**

```ts
// src/shared/lib/supabase/__tests__/photoMime.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildHeroSeedPublicUrl, HERO_SEED_PREFIX } from "../photoMime";

describe("buildHeroSeedPublicUrl", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://demo.supabase.co");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("결정적 public URL 을 만든다", () => {
    expect(buildHeroSeedPublicUrl("osaka-kyoto")).toBe(
      "https://demo.supabase.co/storage/v1/object/public/product-images/product-hero/seed/osaka-kyoto.jpg",
    );
  });
  it("HERO_SEED_PREFIX 가 경로에 포함된다", () => {
    expect(buildHeroSeedPublicUrl("x")).toContain(HERO_SEED_PREFIX);
  });
});
```
> `vi` 는 vitest 글로벌. 파일 상단에 `import { vi } from "vitest";` 가 없으면 추가.

- [x] **Step 2: 실패 확인**

Run: `npx vitest run src/shared/lib/supabase/__tests__/photoMime.test.ts`
Expected: FAIL — `buildHeroSeedPublicUrl` export 없음

- [x] **Step 3: 구현 (photoMime.ts 끝에 추가)**

```ts
// 시드 상품 대표 이미지의 결정적 저장 prefix (마이그레이션·재시드 공유).
export const HERO_SEED_PREFIX = "product-hero/seed";

/**
 * 시드 상품 hero 이미지의 env-portable public URL.
 * env.ts 미사용(client-safe 규칙) — NEXT_PUBLIC_SUPABASE_URL 직접 접근.
 * 로컬/운영이 같은 Supabase 프로젝트라면 동일 URL 로 양쪽에서 해석된다.
 */
export function buildHeroSeedPublicUrl(slug: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return `${base}/storage/v1/object/public/${REVIEW_PHOTO_BUCKET}/${HERO_SEED_PREFIX}/${slug}.jpg`;
}
```

- [x] **Step 4: 통과 확인**

Run: `npx vitest run src/shared/lib/supabase/__tests__/photoMime.test.ts`
Expected: PASS

- [x] **Step 5: 커밋**

```bash
git add src/shared/lib/supabase/photoMime.ts src/shared/lib/supabase/__tests__/photoMime.test.ts
git commit -m "feat(storage): env-portable buildHeroSeedPublicUrl for seed hero images"
```

---

### Task 7: 슬러그 목록 추출 + Unsplash 큐레이션 맵 (검증 필수)

**Files:**
- Create: `prisma/heroImageSources.ts`

- [x] **Step 1: 권위있는 슬러그 22개 추출**

Run:
```bash
grep -oE 'picsum.photos/seed/[a-z0-9-]+' prisma/seed.ts | sed 's#picsum.photos/seed/##' | sort -u
grep -nE 'heroSeed' prisma/themeProducts.ts | head -40
```
→ seed.ts 인라인 슬러그 + themeProducts 의 `heroSeed` 값 전부를 모아 22개 슬러그 확정. (각 슬러그는 해당 상품의 picsum seed 와 동일하므로 1:1 매핑 보장.)

- [x] **Step 2: 슬러그별 실제 Unsplash 직링크 검증·수집**

각 슬러그를 여행지 카테고리로 보고, 카테고리별 **실제** Unsplash 사진 직링크(`https://images.unsplash.com/photo-...`)를 수집한다. 절차(슬러그마다):
1. `WebSearch` 또는 Unsplash 페이지에서 해당 여행지 사진을 찾는다.
2. 직링크를 `WebFetch`(또는 `curl -sI`)로 **HTTP 200 + image/* 확인**.
3. 확정된 URL 만 맵에 기록. 고유 사진을 못 찾으면 **같은 카테고리 검증된 URL 재사용 허용**(spec §4.1, 유일성 비강제).

검증 명령 예:
```bash
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" "<unsplash-direct-url>?w=800&h=500&fit=crop"
# 기대: 200 image/jpeg
```

- [x] **Step 3: 맵 파일 작성**

```ts
// prisma/heroImageSources.ts
/**
 * heroImageSources.ts — 시드 상품 슬러그 ↔ 검증된 Unsplash 직링크.
 * 모든 URL 은 작성 시점 HTTP 200 + image/* 로 검증됨(Unsplash License).
 * migrate-hero-images.ts 가 이 원본을 받아 Supabase 로 재호스팅한다.
 */
export const HERO_IMAGE_SOURCES: Record<string, string> = {
  // 예시 형식 (Step 2 에서 검증한 실제 URL 로 채울 것):
  // "osaka-kyoto": "https://images.unsplash.com/photo-XXXX?w=800&h=500&fit=crop",
  // ...22개 전부
};
```
> ⚠️ Step 2 에서 검증하지 않은 URL 을 넣지 말 것. 미검증 URL 은 마이그레이션 fetch 404 를 유발한다.

- [x] **Step 4: 슬러그 누락 검증 테스트(가드)**

Run:
```bash
npx tsx -e 'import { HERO_IMAGE_SOURCES } from "./prisma/heroImageSources"; const n = Object.keys(HERO_IMAGE_SOURCES).length; console.log("슬러그 수:", n); if (n < 22) { console.error("22개 미만 — 누락"); process.exit(1); }'
```
Expected: `슬러그 수: 22`

- [x] **Step 5: 커밋**

```bash
git add prisma/heroImageSources.ts
git commit -m "feat(seed): curated + verified Unsplash hero image source map (22 slugs)"
```

---

### Task 8: 마이그레이션 스크립트 (업로드 + heroImageUrl 갱신)

**Files:**
- Create: `prisma/migrate-hero-images.ts`

- [x] **Step 1: 스크립트 작성**

```ts
// prisma/migrate-hero-images.ts
/**
 * (일회성, 멱등) Unsplash 원본 → Supabase 재호스팅 + Product.heroImageUrl 갱신.
 * 실행: 업로드용 env(로컬 .env: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
 *       + 갱신 대상 DATABASE_URL(로컬 또는 운영) 로 구동.
 * 안전: DATABASE_URL 빈값이면 중단. 항목별 try/catch 로 부분 실패 격리.
 */
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import {
  REVIEW_PHOTO_BUCKET,
  HERO_SEED_PREFIX,
  buildHeroSeedPublicUrl,
} from "../src/shared/lib/supabase/photoMime";
import { HERO_IMAGE_SOURCES } from "./heroImageSources";

const db = new PrismaClient();

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요");
  return createClient(url, key);
}

/** picsum seed(=슬러그)로 기존 상품을 찾아 heroImageUrl 을 슬러그 기반으로 매칭. */
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("⛔ DATABASE_URL 비어있음");
  const supa = supabaseAdmin();
  let uploaded = 0, updated = 0, failed = 0;

  for (const [slug, srcUrl] of Object.entries(HERO_IMAGE_SOURCES)) {
    try {
      // 1) 원본 다운로드
      const res = await fetch(`${srcUrl}`);
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());

      // 2) Supabase 업로드(멱등 upsert)
      const path = `${HERO_SEED_PREFIX}/${slug}.jpg`;
      const { error: upErr } = await supa.storage
        .from(REVIEW_PHOTO_BUCKET)
        .upload(path, buf, { contentType: "image/jpeg", upsert: true });
      if (upErr) throw upErr;
      uploaded++;

      // 3) 해당 슬러그를 쓰던 상품(현재 picsum seed=slug)의 heroImageUrl 갱신
      const publicUrl = buildHeroSeedPublicUrl(slug);
      const r = await db.product.updateMany({
        where: { heroImageUrl: { contains: `/seed/${slug}/` } }, // picsum 패턴
        data: { heroImageUrl: publicUrl },
      });
      if (r.count === 0) {
        // 이미 마이그레이션됐거나 슬러그 불일치 — 경고만
        console.warn(`  ⚠️ ${slug}: 매칭 상품 0 (이미 교체됐거나 슬러그 불일치)`);
      }
      updated += r.count;
      console.log(`  ✓ ${slug} (uploaded, updated ${r.count})`);
    } catch (e) {
      failed++;
      console.error(`  ✗ ${slug}: ${(e as Error).message}`);
    }
  }
  console.log(`\n업로드 ${uploaded} / heroImageUrl 갱신 ${updated} / 실패 ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
```
> 슬러그 매칭이 picsum 패턴(`/seed/{slug}/`)에 의존한다. themeProducts 가 `picsum.photos/seed/${heroSeed}/800/500` 형식이므로 동일하게 매칭된다. 혹 형식이 다르면 Step 2 에서 `where` 조건을 실제 heroImageUrl 패턴에 맞춰 조정.

- [x] **Step 2: typecheck (스크립트 포함)**

Run: `npx tsc --noEmit`
Expected: 에러 없음. (`@supabase/supabase-js` 는 기설치 — package.json 확인됨.)

- [x] **Step 3: 커밋**

```bash
git add prisma/migrate-hero-images.ts
git commit -m "feat(seed): one-off hero image migration script (Unsplash → Supabase)"
```

---

## Phase 3 — 시드 교체 + 로컬 실행

### Task 9: 시드 정의를 Supabase URL 빌더로 교체 (재시드 내성)

**Files:**
- Modify: `prisma/themeProducts.ts` (line ~335)
- Modify: `prisma/seed.ts` (9~10개 heroImageUrl 인라인)

- [x] **Step 1: themeProducts.ts 교체**

상단 import 에 추가:
```ts
import { buildHeroSeedPublicUrl } from "../src/shared/lib/supabase/photoMime";
```
`heroImageUrl: \`https://picsum.photos/seed/${s.heroSeed}/800/500\`,` →
```ts
    heroImageUrl: buildHeroSeedPublicUrl(s.heroSeed),
```

- [x] **Step 2: seed.ts 교체**

상단 import 에 추가:
```ts
import { buildHeroSeedPublicUrl } from "../src/shared/lib/supabase/photoMime";
```
각 `heroImageUrl: "https://picsum.photos/seed/{slug}/800/500",` 를 `heroImageUrl: buildHeroSeedPublicUrl("{slug}"),` 로 교체(슬러그 보존). 9~10곳 전부.

Run (잔여 picsum 0 확인):
```bash
grep -n "picsum" prisma/seed.ts prisma/themeProducts.ts || echo "잔여 picsum 없음 ✅"
```
Expected: `잔여 picsum 없음 ✅`

- [x] **Step 3: typecheck**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [x] **Step 4: 커밋**

```bash
git add prisma/seed.ts prisma/themeProducts.ts
git commit -m "feat(seed): replace picsum literals with Supabase hero URL builder (re-seed safe)"
```

---

### Task 10: 로컬 실행 — 업로드 + 로컬 DB 마이그레이션 + 검증

> ⚠️ 운영 데이터·외부 업로드 수반. subagent 가 아니라 **오케스트레이터(메인 세션)가 직접** 실행한다.

- [x] **Step 1: 로컬 .env 로 스크립트 실행 (업로드 = 공유 프로젝트라 이 1회로 운영도 커버)**

Run:
```bash
set -a; source .env; set +a
npx tsx prisma/migrate-hero-images.ts
```
Expected: `업로드 22 / heroImageUrl 갱신 N / 실패 0`

- [x] **Step 2: 로컬 DB 검증 (호스트가 전부 supabase.co)**

Run:
```bash
set -a; source .env; set +a
npx tsx -e 'import { PrismaClient } from "@prisma/client"; const db=new PrismaClient(); (async()=>{ const ps=await db.product.findMany({select:{heroImageUrl:true}}); const bad=ps.filter(p=>!p.heroImageUrl?.includes("supabase.co")); console.log("총",ps.length,"비-supabase",bad.length); bad.forEach(p=>console.log(" -",p.heroImageUrl)); })().finally(()=>db.$disconnect());'
```
Expected: `비-supabase 0`

- [x] **Step 3: 업로드 객체 public GET 표본 확인**

Run:
```bash
set -a; source .env; set +a
SLUG=$(npx tsx -e 'import {HERO_IMAGE_SOURCES} from "./prisma/heroImageSources"; console.log(Object.keys(HERO_IMAGE_SOURCES)[0])')
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" "${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/product-images/product-hero/seed/${SLUG}.jpg"
```
Expected: `200 image/jpeg`

---

## Phase 4 — 운영 반영 + 배포

### Task 11: 운영 DB heroImageUrl 갱신 (저위험 문자열 갱신)

> ⚠️ 오케스트레이터가 직접 실행. 이미지는 이미 공유 Supabase 에 업로드됨 → 운영은 heroImageUrl 문자열만 갱신(가역).

- [x] **Step 1: 운영 DB 대상 마이그레이션 스크립트 실행 (업로드는 멱등 재실행, UPDATE 가 핵심)**

Run:
```bash
PROD_DIRECT=$(grep -E '^DIRECT_URL=' .env.prod | sed -E 's/^DIRECT_URL=//; s/^"//; s/"$//')
set -a; source .env; set +a   # 업로드용 supabase + service key (로컬 유효값)
export DATABASE_URL="$PROD_DIRECT"; export DIRECT_URL="$PROD_DIRECT"  # 갱신 대상만 운영으로
case "$DATABASE_URL" in *localhost*|"") echo "⛔ 중단"; exit 1;; esac
npx tsx prisma/migrate-hero-images.ts
```
Expected: `업로드 22 / heroImageUrl 갱신 ~22 / 실패 0`

- [x] **Step 2: 운영 DB 검증**

Run:
```bash
PROD_DIRECT=$(grep -E '^DIRECT_URL=' .env.prod | sed -E 's/^DIRECT_URL=//; s/^"//; s/"$//')
set -a; source .env; set +a; export DATABASE_URL="$PROD_DIRECT"
npx tsx -e 'import { PrismaClient } from "@prisma/client"; const db=new PrismaClient(); (async()=>{ const n=await db.product.count({where:{heroImageUrl:{contains:"picsum"}}}); console.log("운영 잔여 picsum:",n); })().finally(()=>db.$disconnect());'
```
Expected: `운영 잔여 picsum: 0`

---

### Task 12: PR + 배포 + 운영 종단 검증

- [x] **Step 1: 전체 회귀 후 푸시·PR**

Run:
```bash
npx vitest run && npx tsc --noEmit
git push -u origin feat/portfolio-optimization
gh pr create --base main --title "feat: Supabase hero images + tag vocabulary SSOT" --body "spec/plan 기반. picsum 제거 + 태그 SSOT/가드. 상세는 docs/superpowers/{specs,plans}/2026-06-10-*"
```
Expected: 테스트 PASS, PR URL 출력

- [x] **Step 2: 머지 → 배포 대기**

```bash
gh pr merge --merge
```
Vercel Production 배포가 Ready 될 때까지 `vercel ls --prod` 로 확인.

- [x] **Step 3: 운영 종단 검증**

- 운영 사이트 홈/목록에서 상품 이미지가 Supabase 이미지로 노출되는지(picsum 아님).
- "나홀로 여행"·"주말 근거리" 검색이 테마 부스트로 상품을 반환하는지(Phase 1 회귀가 보장하나 운영 데이터로 표본 확인).

---

## Self-Review Notes
- **Spec 커버리지**: §4(이미지) → Task 6–11, §5(태그) → Task 1–4, 재시드 내성 §4.4 → Task 9, 가드 §5.4 → Task 4. 전 항목 매핑됨.
- **YAGNI 준수**: admin 드롭다운/버킷분리/리사이즈 미포함(비목표).
- **알려진 탐색 태스크**: Task 7(URL 큐레이션)은 본질적으로 검증 기반 — 미검증 URL 금지 가드 포함.
