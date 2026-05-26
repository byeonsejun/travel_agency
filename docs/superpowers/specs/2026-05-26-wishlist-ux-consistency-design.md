# Wishlist UX 일관성 — 비로그인 Confirm 인터셉트 통일 설계

- **작성일**: 2026-05-26
- **상태**: Draft → User Review
- **범위**: `features/wishlist` UI 레이어, `/products` · `/mypage` 페이지, `ProductCardList` · `WishlistGrid` 위젯
- **선행 ADR**: [ADR-0012](../adr/0012-pdp-searchparams-client-fetch-isr-return.md) (PDP ISR), ADR-0018(layout auth island)
- **관련 commit**: `31ebb1a feat(wishlist): 비로그인 찜 클릭 시 confirm 모달 → 동의 시 로그인 흐름`, `0c2f167 perf(pdp): A6 wishlist + 0018 layout auth island = PDP ● (SSG)`

## 1. Context (배경)

PDP에서는 `WishlistHeartIsland`가 `/api/wishlist/check`로 `loggedIn`을 직접 가져와 비로그인 클릭 시 `window.confirm` → `/login?callbackUrl=<resume>` 으로 유도하는 UX가 완성됐다. 그러나 같은 하트 버튼이 쓰이는 다른 화면(`/products` 상품 목록, `/mypage` 찜 목록)은 여전히 **confirm 없이** Server Action(`toggleWishlistAction`)으로 직행 → 서버에서 `redirect('/login?...')` 으로 무조건 튕긴다.

문제:

- 같은 하트 아이콘이 위치에 따라 다른 UX를 보인다(불일치).
- 사용자가 찜 의도가 없었더라도(오클릭) 로그인 페이지로 강제 이동된다.

목표: PDP와 동일한 confirm 인터셉트(취소 시 머묾, 확인 시 로그인 후 resume)를 `WishlistHeartButton`이 쓰이는 모든 화면에 적용하되, **SSR 이점은 100% 보존**한다.

### 핵심 제약사항

| 제약 | 이유 |
|---|---|
| **SSR 보존** — `inWishlist`는 페이지가 prefetch 한 `wishlistIds` Set에서 SSR로 주입 | `/products`, `/mypage`는 이미 dynamic. 클라이언트 1RT 추가 페이로드 없이 즉시 렌더 |
| **Island 남용 금지** — `WishlistHeartIsland`로 교체 ❌ | Island는 PDP ISR 활성화 한정 용도(ADR-0012/A6). 다른 페이지에 적용하면 hydration 후 `/api/wishlist/check` N건 호출 → 첫 화면 깜빡임·불필요 트래픽 |
| **Server Action 권위 유지** | 클라이언트 우회·CSRF·deeplink 대비. 비로그인 인터셉트는 UX 최적화일 뿐, 인증 강제는 서버에서 |

## 2. Decision (설계 결정)

### 2.1 컴포넌트 책임 분리 (그대로 유지)

| 컴포넌트 | 사용처 | `loggedIn` 출처 | `inWishlist` 출처 |
|---|---|---|---|
| `WishlistHeartButton` | `/products`, `/mypage` (ProductCardList/WishlistGrid) | **SSR prop** (신규 추가) | SSR prop (기존) |
| `WishlistHeartIsland` | PDP만 | client-fetch `/api/wishlist/check` | 동일 client-fetch |

→ 두 컴포넌트는 그대로 둔다. Button에 `loggedIn` prop을 추가해 **자체적으로 confirm 인터셉트** 하도록 만든다.

### 2.2 공용 헬퍼 추출

PDP Island와 Button이 사용하는 **메시지 문구·resume URL 형식**이 분기되지 않도록 한 곳으로 모은다.

```
src/features/wishlist/lib/loginPrompt.ts  (신규)
```

- `LOGIN_PROMPT_MESSAGE: string`
- `buildResumeCallbackUrl(productId: string, returnTo: string): string` — `/login?callbackUrl=...` 의 callbackUrl 부분만 생성(이미 인코딩된 형태)

두 UI 컴포넌트 모두 이 헬퍼를 사용. 향후 메시지·resume 경로 변경 시 단일 파일.

### 2.3 `WishlistHeartButton` 변경

#### 새 시그니처

```ts
type Props = {
  productId: string;
  inWishlist: boolean;
  loggedIn: boolean;        // ← 신규
  returnTo: string;
  size?: "sm" | "md";
  className?: string;
};
```

#### 동작

- `loggedIn=true`: 기존과 동일. `useOptimistic` + `startTransition(() => toggleWishlistAction(formData))`.
- `loggedIn=false`: form `onSubmit` 인터셉트 → `window.confirm(LOGIN_PROMPT_MESSAGE)`
  - 취소 → `e.preventDefault()` 만, 아무 동작 없음(상태 변경 없음, navigation 없음).
  - 확인 → `router.push('/login?callbackUrl=' + encodeURIComponent(buildResumeCallbackUrl(productId, returnTo)))`. Server Action 호출하지 않음.

#### form 패턴 변경

현재 Button: `<form action={(fd) => startTransition(...)}>` (React 19 form action prop)
변경 후: `<form onSubmit={(e) => { e.preventDefault(); ... }}>` + 명시적 `new FormData(e.currentTarget)`

→ Island와 동일 패턴. `loggedIn=false` 인터셉트와 `loggedIn=true` 정상 토글이 같은 분기점에서 결정되어야 하므로 `onSubmit`이 자연스럽다.

### 2.4 호출처 변경

| 파일 | 변경 |
|---|---|
| `widgets/product-card-list/ui/ProductCardList.tsx` | `loggedIn: boolean` prop 추가, Button에 그대로 전달 |
| `app/(site)/products/page.tsx` | `loggedIn = !!session?.user?.id` 계산 후 `<ProductCardList loggedIn={...} />` |
| `widgets/wishlist-list/ui/WishlistGrid.tsx` | Button에 `loggedIn={true}` 하드코딩 — 이 페이지는 비로그인이 redirect로 차단되는 invariant |
| `app/(site)/page.tsx` (홈) | **변경 없음** — 현재 wishlistIds 미전달로 하트 자체 미노출. 하트 노출 정책은 별도 PR |
| `widgets/product-detail/ui/ProductDetail.tsx` | **변경 없음** — Island 그대로 |

### 2.5 Server Action 변경 없음

`toggleWishlistAction`은 그대로. 비로그인 진입 시 `redirect('/login?callbackUrl=<resume>')` 로직은 안전망으로 유지한다(클라이언트 인터셉트 우회 시 발동). UI 인터셉트는 UX 최적화일 뿐, 인증 강제의 위치가 아니다.

## 3. 데이터 흐름

### 3.1 비로그인 사용자 — `/products`에서 하트 클릭

```
1. 페이지(RSC): auth() → session=null → loggedIn=false
2. SSR: <WishlistHeartButton loggedIn={false} inWishlist={false} ... />
3. 클라이언트: 사용자 클릭 → onSubmit
4. Button: e.preventDefault() → window.confirm()
   - 취소 → 끝. 아무 일 없음.
   - 확인 → router.push('/login?callbackUrl=' + buildResumeCallbackUrl(...))
5. /login에서 로그인 성공 → callbackUrl(=/api/wishlist/resume?...) 으로 redirect
6. resume route: idempotent upsert(add-only) → returnTo로 redirect
7. 사용자가 /products로 돌아옴, 다음 RSC 사이클에서 inWishlist=true 반영
```

### 3.2 로그인 사용자 — 클릭 흐름 (변경 없음)

```
1. 페이지(RSC): auth() → session → loggedIn=true
2. SSR: <WishlistHeartButton loggedIn={true} inWishlist={?} ... />
3. 클라이언트: 클릭 → onSubmit → applyOptimistic(!active) + toggleWishlistAction(fd)
4. Server Action: 토글 → revalidatePath(returnTo) → SSR 재실행
```

## 4. 테스트 계획 (TDD)

### 4.1 신규 — `WishlistHeartButton.test.tsx`

Vitest + `react-dom/client` + `act`(Island 테스트와 동일 패턴).

`/api/wishlist/server/actions`, `next/navigation`을 `vi.hoisted` + `vi.mock`으로 격리.

- (a) `loggedIn=true` + 클릭 → `toggleWishlistAction` 1회, `window.confirm` 미호출
- (b) `loggedIn=false` + 클릭 → `window.confirm` 호출, `toggleWishlistAction` 미호출
- (c) `loggedIn=false` + confirm 취소 → `routerPush` 미호출, `toggleWishlistAction` 미호출
- (d) `loggedIn=false` + confirm 확인 → `routerPush` 가 `/login?callbackUrl=` 로 시작하는 URL로 1회, callbackUrl 디코딩 시 `/api/wishlist/resume`, `productId=...`, `returnTo=...` 포함
- (e) `loggedIn=true` + `inWishlist=true` → `aria-pressed="true"`
- (f) `loggedIn=true` + `inWishlist=false` → `aria-pressed="false"`

### 4.2 신규 — `loginPrompt.test.ts`

- `buildResumeCallbackUrl('p1', '/products?page=2')` → 인코딩 정확성(특히 `&`, `?`, `/`).
- `LOGIN_PROMPT_MESSAGE` 가 "로그인" 문자열을 포함(스모크).

### 4.3 기존 통과 유지

- `WishlistHeartIsland.test.tsx` — 메시지·URL 형식 동일하게 유지되도록 헬퍼로 리팩토링. 9개 케이스 그대로 통과.
- `/api/wishlist/check/__tests__/*` — 영향 없음.

### 4.4 타입체크·린트

- `npm run typecheck` — Button prop 변경으로 호출처 누락 시 fail 유도 → 호출처 3곳 모두 수정 후 pass.
- `npm run lint` — 추가 룰 없음.

## 5. 마이그레이션 영향

- **Phase 2 영향 없음** — 결제/예약 도메인과 분리. 🛑 NO-REAL-MONEY 무관.
- **PDP ISR**(ADR-0012/A6) **영향 없음** — Island 변경하지 않음. 헬퍼 import만 추가.
- **DB 마이그레이션 없음** — 스키마 변경 없음.
- **Breaking change**: `WishlistHeartButton` prop signature(직접 import 사용처는 widgets 2곳뿐, 모두 본 PR에서 같이 수정).

## 6. ADR 후보

본 결정은 ADR 발행 임계점에는 미치지 않는다고 판단:

- 옵션 검토(A/B/C) 결과지만 *기존 PDP A6 결정(client-fetch + Island)* 의 일관된 적용에 가까움.
- Architecture invariant(FSD 단방향·결제 안전 등)에 영향 없음.

다만 작업 완료 보고 시 사용자에게 "ADR로 박제할 가치가 있는가" 한 줄 제안만 남긴다(스팸 방지).

## 7. 단계별 작업(Plan 골자)

writing-plans 스킬이 상세 plan을 생성하지만, spec 차원에서 기대하는 큰 단계:

1. `features/wishlist/lib/loginPrompt.ts` + 테스트 작성 (RED → GREEN)
2. `WishlistHeartButton.test.tsx` 신규 작성 (RED — 새 prop·동작 명세)
3. `WishlistHeartButton.tsx` 구현 (GREEN — 위 테스트 통과)
4. 호출처 3곳 수정 (`ProductCardList`, `/products/page.tsx`, `WishlistGrid`)
5. 전체 `typecheck` / `test` / `lint` 통과
6. 수동 검증: 비로그인 상태에서 `/products`·`/mypage` 하트 클릭 → confirm → 취소·확인 두 경로 모두 의도대로

## 8. Out of scope

- 홈(/)에 하트 노출 정책 변경(현재 미노출 유지) — 별도 PR.
- `window.confirm`을 커스텀 모달로 교체(브랜드 디자인 갱신 시 별도 spec).
- `loggedIn` 정보를 layout context로 끌어올리기(현재 페이지마다 `auth()` 호출 — prop drilling이 깊지 않아 무리한 추상화 회피).
