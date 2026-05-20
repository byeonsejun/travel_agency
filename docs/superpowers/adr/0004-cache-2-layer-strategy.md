# ADR-0004: 캐시 2-Layer — 페이지 hint + unstable_cache + revalidateTag

- **상태**: Accepted
- **결정일**: 2026-05-20
- **영향 범위**: `src/app/(site)/page.tsx`, `src/app/(site)/products/[id]/page.tsx`, `src/entities/product/api/queries.ts`, `src/entities/departure/api/queries.ts`, `src/features/checkout/server/actions.ts`, `src/features/booking-cancel/server/actions.ts`, `src/app/(site)/layout.tsx`, `src/features/auth/ui/UserNav.tsx`
- **관련 commit**: `752ad94`

## Context (배경)

Phase 1·2에선 모든 페이지가 `export const dynamic = "force-dynamic"`이라 매 요청 DB를 hit했다. M-CACHE에서 `searchProducts`만 Upstash Redis로 처리됐을 뿐 일반 페이지 트래픽은 캐싱 0.

Phase 3에서 페이지 단위 ISR로 끌어올리려 했으나 다음 제약이 드러남:

1. `layout.tsx`가 `await auth()`로 쿠키를 읽어 **모든 (site) 라우트가 dynamic으로 강제됨** → 페이지 단위 `revalidate=N`이 활성화 안 됨
2. 해결책인 **PPR(Partial Prerendering)**은 `experimental.ppr`로 활성화 가능하나 **stable Next 15.5.18에선 canary 한정**으로 빌드가 거부됨 (실측 확인)
3. `unstable_cache`로 fetch/Prisma 결과를 직접 캐시는 가능하지만, **route table에선 여전히 ƒ(Dynamic)**으로 보임

## Decision (결정)

페이지 prerender는 일단 포기하고 **데이터 레이어에 캐시를 박는 2-layer 전략**:

**Layer 1: 페이지 단위 `revalidate` hint (PPR 대비 선언)**
```ts
// src/app/(site)/page.tsx
export const revalidate = 300;
// src/app/(site)/products/[id]/page.tsx
export const revalidate = 3600;
```
현재는 layout dynamic 때문에 실효 없음. 향후 PPR stable 또는 layout 정적화 시 즉시 활성화 — 미리 선언해 두는 의도.

**Layer 2: `unstable_cache` + 태그 기반 무효화 (실 효과)**
```ts
// entities/product/api/queries.ts
export const getFeaturedProducts = unstable_cache(
  async (limit) => { /* Prisma */ },
  ["featured-products"],
  { revalidate: 300, tags: [TAG_PRODUCTS_FEATURED] }
);

// entities/product/api/queries.ts — per-id 태그 (closure 패턴)
export async function getProductById(id: string) {
  return unstable_cache(
    async (productId) => { /* Prisma */ },
    ["product-detail"],
    { revalidate: 3600, tags: [tagProductDetail(id)] }
  )(id);
}

// entities/departure/api/queries.ts
export async function getDeparturesByProduct(productId: string) {
  return unstable_cache(
    async (pid) => { /* Prisma + computeRemainingSeats */ },
    ["departures-by-product"],
    { revalidate: 3600, tags: [tagDeparturesByProduct(productId)] }
  )(productId);
}
```

**Tag invalidation (features 레이어, FSD 정합):**
```ts
// features/checkout/server/actions.ts (booking 생성 직후)
revalidateTag(tagDeparturesByProduct(departure.productId));

// features/booking-cancel/server/actions.ts (취소 직후)
revalidateTag(tagDeparturesByProduct(productId));
```

태그 헬퍼는 entities/{product,departure}에 거주 (단일 source of truth), 호출은 features에서만.

**Layout PPR-ready 분리:**
- `await auth()`를 layout 본체에서 빼내 `<UserNav>` 서버 컴포넌트로 격리
- `<Suspense fallback={UserNavSkeleton}>`로 감쌈
- stable Next 15에선 효과 없지만 PPR 활성화 즉시 정적 본문 + dynamic shell 분리

## Consequences (결과)

**얻은 것:**
- 동일 product/featured 요청에 대한 DB hit 압축 — TTL 동안 N rps도 DB는 1회만
- booking 생성/취소 시 좌석 캐시가 `revalidateTag`로 **즉시** 무효화 (다음 요청은 fresh)
- 태그 컨벤션이 entities에 박혀 있어 features는 키 형식을 모르고도 무효화 가능
- layout을 미래(PPR) 대응 구조로 미리 정렬

**포기한 것 / 미해결:**
- 페이지 prerender는 stable Next 15에선 활성화 불가 — route table은 여전히 모두 ƒ
- ISR 도입의 실효 이득은 "페이지 server-render 비용 감소"가 아니라 "DB hit 감소"에 한정 — server CPU 자체는 매 요청 들어감
- `unstable_cache`는 Next의 unstable API — 향후 stable cache API로 마이그레이션 필요할 수 있음
- 이미 PDP를 열어둔 클라이언트는 자동 갱신 안 됨 — 별도로 폴링 도입(ADR-0006 후보)

## Alternatives Considered

### 옵션 A: 모든 페이지 `force-dynamic` 유지 + 캐시 0
- **거부 이유**: Phase 2 baseline. 트래픽이 늘면 DB가 가장 먼저 무너짐. M-CACHE에서 search만 부분적으로 풀었지만 전체 페이지 트래픽은 미보호.

### 옵션 B: PPR 활성화 시도
- **거부 이유**: `experimental.ppr = "incremental"` 설정 시 `Build error: The experimental feature "experimental.ppr" can only be enabled when using the latest canary version of Next.js.` 발생. Next canary로 메이저 버전 변경은 이번 PR 범위 밖이라 보류.

### 옵션 C: layout에서 auth() 제거 + `useSession()` client 컴포넌트화
- layout이 정적 가능 → 모든 (site) 라우트가 페이지 단위 ISR 활성화 가능
- **거부 이유**: SessionProvider 셋업 + 로딩 FOUC + 헤더의 SSR 사용자 정보 없어짐. 영향 범위 큼. 추후 별 PR로 평가.

### 옵션 D: Redis(M-CACHE)로 모든 페이지 결과 캐싱
- **거부 이유**: 페이지 HTML 자체 캐싱은 search 결과 캐싱과 다른 차원(개인화/세션). Redis에 page HTML을 넣는 것은 overengineering — Next의 fetch/unstable_cache가 같은 일을 더 정합적으로 해줌.

## Notes

- PPR이 stable되거나 Next canary 전환이 결정되면, 본 ADR을 supersede하는 ADR-XXXX 발행 + `experimental.ppr` + 페이지의 `experimental_ppr = true` 활성화하면 즉시 prerender 활성화
- 캐시 효과 측정 지표 후보: Prisma query count per page hit, p95 TTFB, DB connection pool 사용률 — 별도 obsesrvability ADR 후보
- 폴링·SSE 등 *클라이언트 측 신선도*는 별개 차원의 결정 (ADR-0006 후보 "PDP 좌석 폴링")
