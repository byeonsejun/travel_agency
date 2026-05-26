# ADR-0018: `(site)/layout.tsx` 의 `auth()` 의존을 client island 로 격리 + PDP `generateStaticParams`

- **상태**: Accepted
- **결정일**: 2026-05-26
- **영향 범위**:
  - `src/app/(site)/layout.tsx`
  - `src/features/auth/ui/UserNav.tsx` (삭제) → `UserNavIsland.tsx` (신규)
  - `src/features/auth/ui/LogoutButton.tsx` (inline → module-level Server Action)
  - `src/features/auth/server/actions.ts` (`signOutAction` 추가)
  - `src/app/api/wishlist/count/route.ts` (신규)
  - `src/app/(site)/products/[id]/page.tsx` (`generateStaticParams` 추가)
  - `src/entities/product/api/queries.ts` (`getAllPublishedProductIds` helper 추가)
- **관련 commit**: 본 plan(`2026-05-26-layout-auth-island.md`) 의 실 변경

## Context (배경)

[ADR-0012] (A4 / pdp-isr) 에서 PDP 의 `searchParams.compareIds` 의존을 client-fetch island 로 분리했고, A6 (`2026-05-26-wishlist-island.md`) 에서 wishlist 의존까지 island 로 분리했음에도 `next build` 출력에서 `/products/[id]` 가 여전히 `ƒ` (Dynamic) 로 분류되는 현상이 관찰됐다.

원인 분석:

1. **layout 단의 cookies 의존** — `(site)/layout.tsx` 가 `<Suspense><UserNav /></Suspense>` 로 `UserNav` (RSC) 를 lazy render. `UserNav` 가 `await auth()` 호출 → layout 전체가 cookies 의존. Suspense 경계는 있으나 PPR 미활성 상태에서는 layout 의 cookies 의존이 **모든 자식 페이지를 dynamic 으로 분류시킨다**.
2. **dynamic route `[id]` + `generateStaticParams` 부재** — layout cookies 의존을 0으로 만들어도, `[id]` segment 가 dynamic 인 한 Next 는 build time 에 prerender 할 ID 를 모른다. 결과: `revalidate=3600` 만으로는 ISR-on-demand (`ƒ`) 표기에 머무름.

본 ADR 은 위 두 차단 요인을 동시에 해소하여 `[ADR-0012]` 가 의도한 빌드 출력 `●` 표기 (정식 ISR with SSG prerender) 를 완성한다. [ADR-0006] (PPR-ready layout) 의 의도 — *layout 의 cookies 의존을 PPR 없이도 정적 prerender 가능 영역으로 격리* — 의 자연스러운 후속.

## Decision (결정)

두 가지 결정을 한 plan 으로 묶어 박제:

### A. `UserNav` (RSC + `auth()`) → `UserNavIsland` (client + 분리 fetch)

`UserNav` RSC 컴포넌트를 삭제하고 `UserNavIsland` client component 로 교체. `auth()` 와 `countMyWishlist()` 두 서버 의존성을 각각 **NextAuth 표준 endpoint `/api/auth/session`** 과 **신규 `/api/wishlist/count`** 로 분리하여 client 가 mount 후 단일 `AbortController` + `Promise.all` 로 병렬 fetch:

```tsx
"use client";
// useEffect 내부
const controller = new AbortController();
const { signal } = controller;
Promise.all([
  fetch("/api/auth/session", { signal }).then(r => r.json()),
  fetch("/api/wishlist/count", { signal }).then(r => r.ok ? r.json() : { count: 0 }),
])
  .then(([session, countRes]) => setState({ phase: "ready", user, wishlistCount }));
return () => controller.abort();
```

`(site)/layout.tsx` 는 `<Suspense>` 와 `UserNav` import 를 모두 제거, `<UserNavIsland />` 한 줄로 교체 → layout 본체의 cookies 의존 **완전 0**.

**CLS 0 전략**: skeleton dimensions (`h-7 w-20`) = 비로그인 "로그인" 버튼 dimensions. 트래픽 다수 가정 (비로그인). 로그인 사용자만 hydration 후 width 확장 1회 발생 — [ADR-0012] / [ADR-0017] island 깜빡임 정책과 동질의 본질 비용.

**Server Action 패턴 부수 변경**: 기존 `LogoutButton` 이 inline `"use server"` 패턴을 사용 (RSC 컨텍스트에서만 합법). client component(`UserNavIsland`) 안에서 import 되면 Next.js 가 `"It is not allowed to define inline 'use server' annotated Server Actions in Client Components"` 로 차단. 해결: `signOutAction` 을 `features/auth/server/actions.ts` 의 module-level Server Action 으로 분리, `LogoutButton` 이 `<form action={signOutAction}>` 으로 dispatch.

### B. PDP `generateStaticParams` 도입

layout cookies 의존을 0으로 만들면 홈(`/`) 은 즉시 `○ (Static)` 으로 승격되지만, dynamic route `[id]` 는 별개 차원. `●` (SSG with ISR) 표기를 받으려면 build time 에 어떤 ID 를 prerender 할지 명시 필요:

```ts
// src/app/(site)/products/[id]/page.tsx
export async function generateStaticParams(): Promise<{ id: string }[]> {
  const ids = await getAllPublishedProductIds();
  return ids.map((id) => ({ id }));
}
```

`entities/product` 에 `getAllPublishedProductIds()` helper 추가 (PUBLISHED 상품만 prerender 후보 — CLOSED 는 첫 요청 시 ISR-on-demand). `dynamicParams = true` (Next default) 이므로 신규 등록 상품은 첫 요청 시 자동 prerender → 새 PR 마다 별도 작업 불필요.

## Consequences (결과)

**얻은 것:**

- **빌드 출력 `● /products/[id]` 승격 달성** + 9개 PUBLISHED 상품 모두 build time prerender + Revalidate 1h + Expire 1y. [ADR-0012] / A6 의 ISR 복귀 시리즈가 빌드 표기까지 완성.
- 홈(`/`) 도 `○ (Static)` 으로 승격 (Revalidate 5m). layout cookies 의존 0 의 부수 효과.
- layout 본체가 cookies 의존 0 → 향후 `(site)/` 아래 추가되는 모든 RSC 페이지가 본질적으로 정적 prerender 자격을 갖춤. 새 ADR 없이도 패턴 따라가면 됨.
- `LogoutButton` 의 Server Action 이 module-level 로 분리되어 향후 다른 client component 에서도 import 가능 — 재사용성 ↑.
- dead `UserNav.tsx` 제거 → 코드 표면적 감소.

**포기한 것 / 미해결:**

- 로그인 사용자는 hydration 후 `로그인` 버튼 폭 (~60px) → 사용자명+마이페이지+로그아웃 (~280px) 으로 width 확장 1회 발생. 비로그인 사용자는 변화 0. ADR-0012/0017 island 깜빡임 정책과 동질의 본질 비용.
- `generateStaticParams` 가 build time 에 모든 PUBLISHED 상품 ID 를 DB 조회 — 현재 seed 9개라 무시 가능. production 에서 수만 개로 늘어나면 build 시간 + 메모리 압박 가능. **모니터링 트리거**: build duration / static pages 갯수가 `> 1000` 으로 늘어나면 admin-popular subset prerender + 나머지 ISR-on-demand 패턴으로 전환 검토.
- NextAuth `useSession` 옵션 거부 → `<SessionProvider>` 가 없음. 향후 다른 client component 에서 session 이 필요하면 `/api/auth/session` 직접 fetch 패턴을 따라야 함 (SessionPoll, UserNavIsland 가 선례).

## Alternatives Considered (대안 — 가장 중요한 섹션)

### 옵션 A: NextAuth `useSession()` hook

`next-auth/react` 의 `useSession()` 을 사용. 부모 트리에 `<SessionProvider>` 필요.

- ❌ Provider tree pollution — layout 또는 그 상위에 `<SessionProvider>` 추가 필요. 본 시점의 RSC-first 원칙에 역행.
- ❌ 외부 패키지(`next-auth/react`) 의 client bundle 추가 — `/api/auth/session` 직접 fetch 와 본질적으로 동일한 round-trip 인데 wrapper 비용만 더해짐.
- ❌ `SessionPoll` 이 이미 `fetch('/api/auth/session')` 패턴을 채택한 선례와 일관성 깨짐.
- 거부.

### 옵션 C: 통합 endpoint `/api/auth/me` (session + wishlistCount)

단일 endpoint 가 session 과 wishlist count 를 함께 반환.

- ✅ Client fetch 1회 — race 0.
- ❌ UI-specific endpoint — RESTful 단일 책임 위반.
- ❌ 향후 다른 곳에서 `count` 만 또는 `session` 만 필요할 때 분리 비용 발생.
- ❌ `/api/auth/session` 은 NextAuth 무료 제공 — 통합 endpoint 작성 시 그 자산을 버리는 셈.
- 거부.

### 옵션 D: UserNav 의 wishlist 뱃지 제거 → `/api/auth/session` 만 fetch

기능 축소로 fetch 1회만 사용.

- ❌ Feature loss — 현재 UI 에서 헤더 뱃지가 wishlist 진입을 유도하는 어드밴티지.
- 거부.

### 옵션 E: PPR (Partial Prerendering) opt-in (`experimental.ppr`)

`next.config.mjs` 에 `experimental.ppr = 'incremental'` 추가 → layout 의 Suspense 가 dynamic hole 로 동작, layout chrome 만 정적 prerender.

- ❌ [ADR-0012] 및 [ADR-0017] 에서 이미 거부:
  - Next 15 PPR 은 **experimental** — API/동작 변경 가능성
  - 결제·예약·웹훅 등 안정성 민감 도메인이 영향 받을 수 있음 (🛑 NO-REAL-MONEY 원칙 [ADR-0009])
- ✅ 가장 우아한 장기 모델. PPR stable 승격 후 본 ADR 의 일부가 재논의될 수 있음 — `UserNavIsland` 자체는 PPR 환경에서도 유효한 패턴이므로 호환.
- 채택 보류 — 시기상조.

### 옵션 F: PDP 에 `generateStaticParams` 미도입, `ƒ` 표기 수용

layout cookies 의존만 제거하고, `[id]` 는 ISR-on-demand 로 운영. 빌드 출력은 `ƒ` 이지만 첫 요청 후 ISR cache 작동.

- ✅ Build duration 추가 비용 0.
- ❌ 사용자 명시 요구사항 (`●` 표기) 미달성.
- ❌ A4 + A6 시리즈의 명시적 expected outcome 미달성.
- ❌ Build 출력으로 ISR 의도를 박제하지 못함 — 6개월 뒤 누군가 "왜 dynamic 이지?" 라고 다시 질문할 위험.
- 거부.

### 옵션 G: `LogoutButton` 의 inline `"use server"` 우회 — UserNavIsland 가 LogoutButton 을 prop slot 으로 받기

layout 이 `<UserNavIsland logoutSlot={<LogoutButton />} />` 형태로 RSC slot 주입.

- ✅ inline Server Action 제약 우회 가능.
- ❌ Layout 이 UserNavIsland 의 내부 마크업을 알아야 함 — encapsulation 깨짐.
- ❌ Layout 이 cookies 의존인 LogoutButton (signOut import) 을 import 하면 layout 의 cookies 의존을 다시 끌어옴 — 원래 문제 재발.
- 거부. module-level Server Action 분리가 표준 패턴.

## Notes

- **A4-A6-0018 시리즈 완결**: [ADR-0012] (PDP searchParams → island) → A6 wishlist island → [ADR-0017] (useSearchParams Suspense 박제) → 본 ADR. PDP 의 진정한 정적 ISR 활성 + 빌드 표기 `●` 까지 완성됨. 후속 모니터링 지표는 PDP p95 응답 시간 (CDN cache hit ratio 상승 기대).
- **신규 client component 가이드**: 본 작업 이후 `(site)/` 아래에 추가되는 RSC 페이지는 layout 의존 cookies 0 기준이므로 본질적으로 정적 prerender 자격을 갖춤. 사용자별 데이터가 필요하면 island 패턴 (`useEffect` + `AbortController` + 분리 endpoint) 을 따른다.
- **6개월 뒤 의심받을 가능성**: "왜 `UserNav` 를 client 로 만들었지? 서버에서 prefetch 가 더 빠르지 않나?" — 답: 단일 컴포넌트의 prefetch 이득보다 layout cookies 의존 0 으로 전체 페이지 ISR 활성화 이득이 절대적으로 큼. 또한 island 패턴은 [ADR-0012] / A6 / [ADR-0017] 시리즈의 일관된 결정 계보.
- **`generateStaticParams` 의 의미**: build time prerender 는 PUBLISHED 상품만. 신규 상품은 `dynamicParams = true` (default) 로 첫 요청 시 자동 prerender. admin 이 product 상태를 `PUBLISHED` 로 변경하는 시점에 `revalidatePath('/products/[id]')` 호출하면 즉시 cache 갱신.
- **모니터링 트리거**: build duration / static pages 갯수가 `> 1000` 으로 늘어나면 admin-popular subset prerender + 나머지 ISR-on-demand 로 전환 검토.
