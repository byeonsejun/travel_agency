# ADR-0012: PDP — `searchParams` 의존을 client-fetch 로 hoist 해서 ISR 복귀 준비

- **상태**: Accepted
- **결정일**: 2026-05-23
- **영향 범위**:
  - `src/app/(site)/products/[id]/page.tsx`
  - `src/app/(site)/products/page.tsx`
  - `src/features/product-compare/ui/FloatingCompareCart.tsx`
  - `src/app/api/compare/products/route.ts` (신규)
- **관련 commit**: `725b7bb` (A4 — 본 ADR 의 실 변경)

## Context (배경)

PDP(`/products/[id]`) 는 본래 1시간 ISR(`revalidate=3600`) 의도로 설계된 페이지였다.
A1(상품 비교 모드) PR(2fc741d) 이후 PDP 가 `await searchParams` 로 `compareIds` 를
읽어 `FloatingCompareCart` 의 카트 콘텐츠를 server-prefetch(`getProductsByIds(compareIds)`)
하기 시작했고, Next 15 는 `searchParams` 를 읽는 즉시 페이지를 자동 dynamic 으로
분류한다 → ISR 의도가 깨졌다.

부작용:

- 매 PDP 요청마다 6 병렬 DB 쿼리 (product/departures/wishlist/**compareProducts**/reviewStats/reviewList) 실행
- 무비교 트래픽(절대다수) 도 동일 비용 — 비교 모드를 안 쓰는 사용자가 비교 prefetch 의 손해를 본다
- `unstable_cache` 데이터 캐시가 일부 흡수해도 페이지 단위 render 비용은 그대로
- PDP 가 검색 엔진·CDN 캐시 친화적이지 않게 됨

`FloatingCompareCart` 는 이미 `'use client'` + `useSearchParams()` 였다. 서버에서
prefetch 한 단 하나의 이유는 **SSR 시점 카트 콘텐츠 깜빡임 회피** (props 로 product
title/이미지 미리 전달). 이 단일 이유만 격리하면 PDP 서버의 `searchParams` 의존이
사라진다.

## Decision (결정)

`compareIds` 의존 카트 콘텐츠 prefetch 를 **server → client 로 hoist**.
신규 Route Handler `/api/compare/products?ids=<csv>` 가 hydration 후 client-fetch
의 단일 endpoint. PDP RSC 는 `searchParams` 인자 자체를 받지 않는다.

```ts
// app/(site)/products/[id]/page.tsx — 정적 ISR 의도 박제
export const revalidate = 3600;

type PageProps = { params: Promise<{ id: string }> };   // ← searchParams 없음
// Promise.all 5 병렬 (compareProducts slot 제거)
// <FloatingCompareCart />   — props 없음
```

```tsx
// FloatingCompareCart — useEffect + AbortController + skeleton
useEffect(() => {
  if (ids.length === 0) { setProducts([]); return; }
  const ctrl = new AbortController();
  setProducts(null); // loading → skeleton ids.length 개
  fetch(`/api/compare/products?ids=${encodeURIComponent(idsKey)}`,
        { signal: ctrl.signal })
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(d => setProducts(d.products))
    .catch(e => { if (e?.name !== "AbortError") setErrored(true); });
  return () => ctrl.abort();
}, [idsKey]);
```

`getProductsByIds` 가 `unstable_cache(1h TTL + per-id 태그)` 로 메모이즈되므로
Route Handler 가 호출해도 DB hit 은 압축 + Cache-Control 헤더(브라우저 30s /
CDN 5min / SWR 60s) 로 클라이언트·엣지 캐시 적용.

## Consequences (결과)

**얻은 것:**

- PDP RSC 가 `searchParams` 의존 0. `parseCompareIds`·`getProductsByIds` import 제거
- 무비교 트래픽의 DB 쿼리 1건 감소 (6 → 5 병렬)
- 비교 카트 ids 변경 → 새 URL → 새 cache key 로 CDN 정확하게 분기
- `export const revalidate = 3600` 박제로 후속 wishlist island 분리 시점에 ISR 즉시 활성화
- FCC 가 PDP/`/products` 두 페이지에서 동일 시그니처(no-props) 사용 — 일관성 회복

**포기한 것 / 미해결:**

- 비교 카트 사용자는 hydration 후 1회 추가 round-trip (skeleton 200ms 가시) — 무비교 사용자(절대다수)는 비용 0
- PDP 의 **완전한** 정적 prerender 는 아직 미달성 — `auth()` + `isInWishlist` 가 cookies 의존이라 dynamic 잔존. `revalidate=3600` 은 현 시점에선 데이터 캐시 TTL 힌트로만 작동
- 후속 plan: wishlist 도 동일 client-fetch 패턴으로 island 분리 필요

## Alternatives Considered (대안)

### 옵션 B: Parallel Routes (`@compare` slot)

`app/(site)/products/[id]/layout.tsx` + `@compare/page.tsx` slot 으로 정적·동적 영역 분리.
메인 `page.tsx` 는 searchParams 미사용, `@compare` slot 만 dynamic 으로 server-prefetch.

- 거부 이유:
  - Next.js parallel routes 는 학습·디버깅 비용 높음 (`default.tsx`, slot fallback, intercept 패턴 등 비숙련)
  - UX 이득(server-prefetch 보존 → skeleton 회피)이 약 200ms 단축인데, 그 대가로 PDP 라우팅 구조에 layout/slot 한 단계 추가 + 후속 유지보수 부채
  - 비용 대비 효용 낮음

### 옵션 C: PPR (Partial Prerendering) opt-in

`next.config.mjs` 에 `experimental.ppr = true` + 페이지 `experimental_ppr = true` +
dynamic 부분을 `<Suspense>` 로 감싸 정적 prerender + dynamic hole.

- 거부 이유:
  - Next 15 에서 PPR 은 **experimental** — API/동작 변경 가능성
  - 결제·예약·웹훅 등 안정성 민감 도메인이 같은 빌드에서 영향 받을 수 있음. 🛑 **NO-REAL-MONEY** 원칙(CLAUDE.md §5, [ADR-0009]) 의 *부작용 회피 방침*과 충돌
  - 가장 우아한 모델이긴 하나 **시기상조**. Phase 2 후반 캐시 튜닝 PR(A5) 또는 PPR stable 후 재검토 권장
- 채택 조건: PPR stable 승격 시 본 ADR 을 `Superseded by ADR-XXXX` 로 마킹하고 옵션 C 로 전환

### 옵션 D: Middleware rewrite (compareIds 유무로 라우트 분기)

미들웨어가 `compareIds` 쿼리스트링 유무로 정적/동적 라우트(예: `/products/[id]` vs
`/products/[id]/with-compare`) 로 rewrite.

- 거부 이유: URL 의미 깨짐, SEO 부정적, 비표준 패턴. 평가 단계에서 제외

## Notes

- **후속 작업**: PDP 가 *완전한* 정적 ISR 이 되려면 wishlist(`auth()` + `isInWishlist`) 도 동일 client-fetch 패턴으로 island 분리 필요. 별도 plan(가칭 A6) 으로 추적
- **모니터링 지표**: PDP p95 응답 시간 — 현 시점은 dynamic baseline. wishlist island 분리 후 ISR 활성화 효과 비교
- **PPR 재검토 트리거**: Next.js PPR 의 `stable` 승격 또는 결제 도메인의 PPR 호환성 검증 완료 시. 두 조건 충족 시 옵션 C 채택 후 본 ADR supersede
- **6개월 뒤 의심받을 가능성**: "왜 PPR 안 썼지?" — 답: 결정 시점(2026-05-23) 에 experimental 이었고 NO-REAL-MONEY 도메인 안정성을 우선
