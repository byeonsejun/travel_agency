# ADR-0015: PDP wishlist 의존을 client-fetch island 로 분리해 ISR 활성화 (A6)

- **상태**: Accepted
- **결정일**: 2026-05-26
- **영향 범위**:
  - `src/app/(site)/products/[id]/page.tsx`
  - `src/widgets/product-detail/ui/ProductDetail.tsx`
  - `src/features/wishlist/ui/WishlistHeartIsland.tsx` (신규)
  - `src/features/wishlist/ui/WishlistHeartButton.tsx` (보존, 다른 사용처용)
  - `src/features/wishlist/index.ts` (barrel)
  - `src/app/api/wishlist/check/route.ts` (신규)
- **관련 commit**: `0c2f167` (A6 + 0018 통합 출력 표기 달성), A6 plan(`docs/superpowers/plans/done/2026-05-26-wishlist-island.md`)
- **관련 ADR**: [ADR-0012](./0012-pdp-searchparams-client-fetch-isr-return.md) (선행: compareIds island), [ADR-0017](./0017-usesearchparams-internal-suspense.md) (병행: 빌드 정적 prerender 복구), [ADR-0018](./0018-layout-auth-client-island.md) (후속: layout `auth()` 격리 + `generateStaticParams` → `●` 승격), [ADR-0019](./0019-wishlist-toggle-no-flicker-event-bus.md) (후속: 토글 깜빡임 + 헤더 동기화)

## Context (배경)

[ADR-0012] (A4) 이 PDP 의 `searchParams.compareIds` 의존을 client-fetch island 로 청산했지만, PDP RSC 는 여전히 두 개의 cookies 의존을 끌고 있었다:

```ts
// src/app/(site)/products/[id]/page.tsx (A4 시점, 잔재)
const session = await auth();                                  // ← cookies
const [product, departures, inWishlist, reviewStats, reviewPage] = await Promise.all([
  // ...
  session?.user?.id ? isInWishlist(session.user.id, id) : Promise.resolve(undefined),
  // ...
]);
```

이 두 호출 때문에 `export const revalidate = 3600` 은 의미상 "데이터 캐시 TTL 힌트" 로만 작동하고, Next 빌드는 페이지를 dynamic (`ƒ`) 로 분류 — PDP 의 진정한 ISR 은 미달성 상태였다. PDP 가 검색 엔진/CDN 캐시 친화적인 정적 prerender 로 승격되려면 *유저별 상태 결정* 자체를 RSC 밖으로 들어내야 했다.

토글 동작은 이미 안정적이었다 — `toggleWishlistAction` Server Action + 비로그인 `/login?callbackUrl=/api/wishlist/resume?...` 우회 흐름 + `useOptimistic` UX. 즉 변경할 곳은 *초기 inWishlist 값* 을 *어디서 어떻게 결정하는가* 한 점이다.

## Decision (결정)

위시리스트의 초기 상태 결정만 **server prefetch → client-fetch island** 로 옮기고, 토글 권위는 기존 Server Action 에 그대로 둔다 (hybrid).

### A. 신규 Route Handler — `GET /api/wishlist/check?productId=<cuid>`

```ts
// src/app/api/wishlist/check/route.ts
const QuerySchema = z.object({ productId: z.string().cuid() });

export async function GET(req: NextRequest) {
  const parsed = QuerySchema.safeParse({
    productId: req.nextUrl.searchParams.get("productId"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_productId" }, { status: 400 });
  }
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { inWishlist: false },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const inWishlist = await isInWishlist(session.user.id, parsed.data.productId);
  return NextResponse.json(
    { inWishlist },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
```

- `Cache-Control: private, no-store` — 유저별 상태이므로 CDN/브라우저 캐싱 **절대 금지**. ([ADR-0012] 의 `/api/compare/products` 가 `public, s-maxage=...` 였던 것과 정확히 반대 정책).
- 비로그인은 `{inWishlist:false}` — 하트는 outline 으로 표시되고 클릭 시 기존 `/login` 우회 흐름 진입.

### B. `WishlistHeartIsland` (Client component, PDP 전용)

```tsx
// src/features/wishlist/ui/WishlistHeartIsland.tsx
"use client";

useEffect(() => {
  const controller = new AbortController();
  fetch(`/api/wishlist/check?productId=${encodeURIComponent(productId)}`,
        { signal: controller.signal })
    .then(r => r.ok ? r.json() : Promise.reject())
    .then((d: { inWishlist: boolean }) => setInWishlist(d.inWishlist))
    .catch(/* AbortError 는 silent, 그 외도 outline 유지 */);
  return () => controller.abort();
}, [productId]);
```

- 초기 상태 `inWishlist=false` (빈 하트 outline) — 서버/클라 마크업 동일, hydration-safe.
- 비로그인 사용자(절대다수)는 깜빡임 0. 로그인 + 실제 찜한 상품만 `outline → filled` 1회 전환 (~100ms 이내).
- 토글 시 기존 `toggleWishlistAction` Server Action 그대로 사용.

### C. PDP RSC 가 `auth()` + `isInWishlist` 호출을 **완전히** 제거

```ts
// src/app/(site)/products/[id]/page.tsx
// PDP 1시간 ISR 실제 활성 (A4 compareIds island + A6 wishlist island 분리 완료).
// 사용자/쿠키 의존 0 → Next 가 페이지를 정적 prerender 로 승격.
export const revalidate = 3600;

export default async function ProductDetailPage({ params }: PageProps) {
  const { id } = await params;
  const [product, departures, reviewStats, reviewPage] = await Promise.all([
    getProductById(id),
    getDeparturesByProduct(id),
    getProductReviewStats(id),
    listReviewsByProduct(id, { limit: 10 }),
  ]);
  // ... <WishlistHeartIsland productId={...} /> 가 ProductDetail 내부에서 자체 fetch
}
```

### D. `WishlistHeartButton` (server-prop 버전) 보존

`/products` 목록(`ProductCardList`) 과 `/mypage/wishlist` (`WishlistGrid`) 는 본질적으로 dynamic (searchParams / 인증 필수) 이라 ISR 이득이 없고, 그곳에서는 server-prefetched `inWishlist` prop 패턴이 더 단순하다. **두 종 wrapper 의 명확한 책임 분리** — Island = PDP 전용, Button = 그 외.

## Consequences (결과)

**얻은 것 (+):**

- PDP RSC 의 cookies 의존을 wishlist 측면에서 0 으로 떨어뜨림 — [ADR-0012] (compareIds island) 와 합쳐 RSC body 의 사용자별 의존성 **0**.
- `revalidate = 3600` 이 데이터 캐시 TTL 힌트가 아닌 **실제 ISR 정책** 으로 동작 가능해짐. (단, 빌드 출력 `●` 표기까지의 완결은 [ADR-0018] 의 layout `auth()` 격리 + `generateStaticParams` 후 달성).
- 토글 권위는 server (`toggleWishlistAction`) 에 그대로 — 비로그인 `/login` 우회 + `useOptimistic` UX 자산 보존.
- API 표면적 최소 — `?productId=` 단건 check 만 추가. 다중 island 확산 시점에 `/api/wishlist/ids` Set 엔드포인트로 확장하면 됨 (현재는 PDP 1곳뿐이라 ROI 부족).
- 두 wrapper(Island / Button) 의 책임 분리로 후속 변경 시 grep 면이 좁아짐 — PDP 만 영향받는 변경은 Island 만 수정.

**포기한 것 / 미해결 (−):**

- 로그인 + 실제 찜한 상품을 PDP 로 입장하는 사용자는 hydration 후 약 100ms 이내 빈→채워짐 1회 전환 발생 — 사용자별 동적 데이터의 본질 비용. ([ADR-0012], [ADR-0017] island 깜빡임 정책과 동질).
- PDP 단일 그러나 mount 마다 추가 round-trip 1회 (`/api/wishlist/check`) — 응답 본문 ~20 bytes, `no-store` 라 CDN 캐시 0. 트래픽 증가는 사소.
- 본 ADR 자체로는 빌드 출력 `●` 표기는 미달성 — layout `auth()` (`UserNav`) 와 dynamic route `[id]` 의 `generateStaticParams` 부재가 남아있었고, 그 청산은 [ADR-0018] 에서 박제됨.
- 토글 후 깜빡임 + 헤더 카운트 미갱신 결함이 후속에 발견됨 — [ADR-0019] 로 별도 박제.

## Alternatives Considered (대안 — 가장 중요한 섹션)

### 옵션 A: PDP 전체를 client component (`'use client'`) 로

- ❌ RSC-first 원칙 정면 위반. data fetch 가 전부 client 로 옮겨가면 LCP 손해 (SSR HTML 에 product 본문이 없어짐). SEO 손해도 심각.
- ❌ revalidate 정책의 의미 사라짐 — `revalidate` 는 RSC 페이지의 정적 prerender 정책. client 페이지에서는 무의미.
- 거부.

### 옵션 B: Server Action only — PDP 가 `auth()` 유지, dynamic 수용

본 ADR 의 변경을 아예 안 함. PDP 는 `ƒ` (Dynamic) 표기로 운영하고 데이터 캐시(`unstable_cache`) 에 의존.

- ✅ 구현 작업 0.
- ❌ A4 [ADR-0012] 의 의도(궁극적 ISR 활성) 미달성 — 본 plan 의 명시적 목표 자체를 포기.
- ❌ 매 요청마다 `auth()` cookies 파싱 + `isInWishlist` DB 쿼리 — 무로그인 트래픽(절대다수) 도 동일 비용 부담.
- ❌ CDN/검색 엔진 친화성 0 — PDP 가 결국 dynamic.
- 거부.

### 옵션 C: 전체 ids Set 엔드포인트 (`GET /api/wishlist/ids`)

`/api/wishlist/ids` 가 로그인 사용자의 전체 위시리스트 productId Set 을 반환, 모든 island 가 동일 데이터를 공유 (페이지에서 단일 fetch + 다중 island 가 Set membership 만 검사).

- ✅ 다중 island 페이지(예: `/products` 목록) 에서 fetch 횟수 절감.
- ❌ PDP 는 island 가 1개뿐 — 단건 check 가 더 직관적이고 응답 본문도 작음(~20B vs N×24B).
- ❌ 응답 크기가 위시리스트 규모에 비례 — 사용자 위시리스트가 수백 건이면 매 페이지마다 K 단위 전송.
- ❌ 본 변경 시점의 island 사용처가 PDP 1곳뿐인데 미래 확장 비용까지 미리 부담하는 격 (YAGNI).
- 거부. **다중 island 확산이 실제로 발생하면** 그 시점에 별도 ADR + 본 ADR 보강으로 추가 가능 — 인터페이스 호환성 깨지지 않음 (`check?productId` 와 `ids` 는 공존 가능).

### 옵션 D: SWR / React Query 도입

`useSWR('/api/wishlist/check?productId=...')` 같은 hook 으로 자동 캐싱·재검증.

- ✅ 캐싱·dedup·재검증 무료.
- ❌ 의존성 추가 → bundle size 증가 (~10KB+ gzip). PDP 단건 fetch 1개를 위해서는 과한 비용.
- ❌ 본 변경 외 다른 client fetch ([ADR-0012] `FloatingCompareCart`, [ADR-0018] `UserNavIsland`) 는 모두 표준 `fetch` + `AbortController` 패턴. 본 island 만 SWR 을 도입하면 일관성 깨짐.
- 거부. 향후 client fetch 가 10곳 이상으로 늘어나면 그 시점에 일괄 도입 ADR 작성.

### 옵션 E: Edge middleware 가 cookies 를 strip 해 RSC 를 cookies-free 로 만든다

middleware 단에서 `auth()` 가 보는 cookie 를 제거하고 별도 header 로 통과시키는 우회.

- ❌ Next 의 `auth()` 가 cookies 기반으로 동작하는 표준 흐름을 우회 — 다른 RSC 컴포넌트(예: layout) 가 깨질 수 있음.
- ❌ middleware 에서 Prisma 호출 금지(CLAUDE.md §5) 와는 별개이지만, NextAuth 의존을 middleware 안에 모아두는 패턴 자체가 복잡도 증가.
- ❌ "RSC 가 cookies 를 안 본다" 라는 *상태* 를 강제하는 게 아니라 *속임* — 본질적 해결이 아님.
- 거부.

### 옵션 F: PPR (`experimental.ppr = true`) opt-in

layout 의 dynamic 영역을 Suspense hole 로 처리 → 정적 prerender + dynamic hole 의 혼성 페이지.

- ✅ 가장 우아한 장기 모델. wishlist hydration 도 hole 안에서 자연스럽게 처리됨.
- ❌ [ADR-0012], [ADR-0017], [ADR-0018] 와 동일 거부 — Next 15 PPR 은 experimental, 결제·예약·웹훅 등 안정성 민감 도메인이 같은 빌드에서 영향 받을 수 있음. 🛑 NO-REAL-MONEY 원칙([ADR-0009])과 충돌.
- 채택 보류 — PPR stable 승격 시 본 시리즈 재논의.

## Notes

- **A4-A6-0018-0019 시리즈 위상**: [ADR-0012] (A4 compareIds island) → 본 ADR (A6 wishlist island, **PDP RSC cookies 의존 제거의 본질적 결정**) → [ADR-0017] (`useSearchParams` Suspense 박제로 빌드 실패 복구) → [ADR-0018] (layout `auth()` island + `generateStaticParams` → 빌드 출력 `●` 표기 완성) → [ADR-0019] (토글 깜빡임 + 헤더 동기화).
- **API 형태 모니터링 트리거**: PDP 외 client island 가 2~3곳 이상 추가되면 `/api/wishlist/ids` 엔드포인트 도입 검토 (옵션 C 재평가).
- **`Cache-Control` 정책의 의도**: 응답에 user-specific 정보가 들어있는 한 `private, no-store` 외 다른 선택지는 **잘못된 것** — `max-age=N` 단기 캐싱도 유저 로그아웃/계정 전환 시 stale 위험. 트래픽 측정 후에도 완화 시 별도 ADR 필수.
- **`WishlistHeartButton` 보존의 이유**: 두 wrapper 의 책임 분리(Island = PDP / Button = 목록·마이페이지) 가 더 깔끔하다. 통합하면 `if (initialPropProvided)` 분기 같은 dual-mode 가 생기고 각 사용처의 의도가 흐려진다.
- **6개월 뒤 의심받을 가능성**: "왜 PDP 만 island 이고 목록은 안 그래?" — 답: 목록 페이지는 검색 필터(`search`, `destination`) 로 어차피 dynamic 이라 server-prefetched prop 이 더 단순하고 ISR 이득 0. 본 결정의 가치는 **PDP 의 ISR 활성화** 한 가지로 평가된다.
