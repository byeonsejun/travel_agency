# ADR-0046: 공유 Supabase 프로젝트 + env-portable hero URL — 상품 이미지 업로드 1회 전략

- **상태**: Accepted
- **결정일**: 2026-06-10
- **영향 범위**: `prisma/heroImageSources.ts`, `prisma/migrate-hero-images.ts`, `src/shared/lib/supabase/photoMime.ts`, `prisma/seed.ts`, `prisma/themeProducts.ts`
- **관련 commit**: `30d721e` `04a92ed` `802b63a` `3ea0234` (merge `3758481`, PR #21)

## Context (배경)

상품 대표 이미지(`Product.heroImageUrl`) 22건이 전부 외부 placeholder `picsum.photos/seed/{slug}/800/500`에 의존했다. picsum 제작자는 **운영(production) 사용을 권장하지 않는다** — 고트래픽 시 캐시 레이어에서 차단되고, 페이지마다 외부 호출이 일어나 Referer 헤더로 사용자 활동이 외부에 노출된다([제작자 글](https://dmarby.se/blog/lorem-picsum/)). 자체 호스팅으로 의존을 끊어야 했다.

쟁점은 **환경 분리**였다. 로컬 개발 DB는 `localhost` Postgres, 운영 DB는 Supabase(`aws-1-ap-northeast-2.pooler`)로 분리돼 있어, 이미지를 어느 스토리지에 올리고 `heroImageUrl`을 어떻게 두 환경에서 일관되게 해석시킬지가 문제였다. 게다가 시드(`seed.ts`)는 파괴적 재시드가 가능하므로, DB만 갱신하면 재시드 시 picsum으로 되돌아간다.

## Decision (결정)

1. **스토리지 공유 확인** — 로컬 `.env`와 운영 `DATABASE_URL`의 Supabase 프로젝트 ref가 동일(`hcixfplgumqidpjowntb`)함을 검증. DB는 분리돼 있어도 **Storage는 한 프로젝트를 공유** → 이미지 업로드는 **1회**(로컬 service-role 키)로 양쪽 환경을 커버.
2. **env-portable URL 빌더** — `heroImageUrl`에 풀 URL을 하드코딩하지 않고, 결정적 경로를 env로 조립:

```ts
// src/shared/lib/supabase/photoMime.ts (client-safe — env.ts 미사용)
export const HERO_SEED_PREFIX = "product-hero/seed";
export function buildHeroSeedPublicUrl(slug: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return `${base}/storage/v1/object/public/${REVIEW_PHOTO_BUCKET}/${HERO_SEED_PREFIX}/${slug}.jpg`;
}
```

3. **재시드 내성** — `seed.ts`/`themeProducts.ts`의 picsum 리터럴을 `buildHeroSeedPublicUrl(slug)` 호출로 교체. 재시드해도 Supabase 경로가 유지된다.

## Consequences (결과)

**얻은 것:**
- picsum 외부 의존 완전 제거(차단·Referer 누수 리스크 종결). 로컬·운영 DB 모두 22/22 supabase, picsum 0.
- 업로드 **1회**로 양 환경 커버(공유 프로젝트). `heroImageUrl`이 프로젝트 ref에 묶이지 않아 환경 이동에 면역.
- 재시드해도 picsum 회귀 없음. 빌더가 `env.ts`를 import하지 않아 client-safe([ADR-0025] 계열 누수 규칙 준수).

**포기한 것 / 미해결:**
- "스토리지 공유" 전제에 의존 — 로컬·운영을 별도 Supabase 프로젝트로 분리하면 환경별 업로드 1회씩 필요(빌더는 그대로).
- Unsplash 원본 22장은 수작업 큐레이션(자동 소싱 미도입).
- 마이그레이션 시 모든 슬러그를 업로드하므로, 이미 admin이 직접 이미지를 올린 상품(예: 로컬 `osaka-weekend`)에는 미사용 seed 객체가 1건 남는다(무해).

## Alternatives Considered (대안)

### 옵션 A: `heroImageUrl`에 Supabase 풀 URL 하드코딩
- 시드/DB에 `https://hcix….supabase.co/...`를 직접 박는다.
- 거부: 프로젝트 ref가 코드에 고정돼 환경 분리·프로젝트 이전 시 전량 깨진다. env-portable 빌더가 같은 비용으로 이식성을 준다.

### 옵션 B: 환경별 별도 업로드 + 환경별 URL
- 로컬/운영 각각의 Supabase에 업로드.
- 거부: 두 환경이 **같은 프로젝트**라 중복. 검증으로 공유를 확인한 뒤 단순화.

### 옵션 C: picsum 유지 또는 Unsplash 직접 핫링크
- 외부 URL을 그대로 쓴다.
- 거부: 외부 의존·차단 위험·Referer 누수가 지속. 자체 호스팅이 목적.

### 옵션 D: 레포에 이미지 에셋 커밋
- `public/`이나 레포에 22장을 담는다.
- 거부: 레포 비대(Git LFS 필요), 객체 스토리지가 정답. YAGNI.

## Notes

- 향후 로컬·운영을 별도 프로젝트로 분리하면 `migrate-hero-images.ts`를 환경별로 1회씩 실행하면 된다(코드 변경 0).
- 미사용 seed 객체(admin 업로드 상품)는 스토리지 청소 대상이나 비용 미미 — 모니터링 불요.
- 실제 상품 이미지를 admin이 교체하면 `heroImageUrl`이 `product-hero/{uuid}.jpg`(업로드 경로)로 바뀌며 seed 경로와 자연 공존한다.
