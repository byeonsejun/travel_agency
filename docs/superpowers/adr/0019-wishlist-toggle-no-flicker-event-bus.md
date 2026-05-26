# ADR-0019: Wishlist 토글 — `useOptimistic` 폐기 + CustomEvent 기반 cross-island 동기화

- **상태**: Accepted
- **결정일**: 2026-05-27
- **영향 범위**: `src/features/wishlist/ui/WishlistHeartButton.tsx`, `src/features/wishlist/ui/WishlistHeartIsland.tsx`, `src/features/auth/ui/UserNavIsland.tsx`, `src/entities/wishlist/model/wishlistChangeBus.ts`
- **관련 commit**: `4222b2b` (bus), `80b62c7` (manual useState fix), `f191e95` (UserNav listener)
- **관련 ADR**: [ADR-0012](./0012-pdp-searchparams-client-fetch-isr-return.md) (PDP ISR 정책), [ADR-0018](./0018-layout-auth-client-island.md) (layout auth island)

## Context (배경)

`/products` 목록 페이지와 PDP 의 하트(찜) 토글에서 두 가지 UX 결함이 동시에 발견됨:

1. **깜빡임(flicker)**: 사용자가 하트를 누르면 잠시 채워졌다가 즉시 원래 상태로 복귀, 다시 갱신되지 않음.
2. **헤더 카운트 뱃지 미갱신**: 마이페이지 옆 위시리스트 개수 뱃지가 토글 후에도 초기값에 머묾.

원인 분석:

### (1) 깜빡임 — `useOptimistic` 의 의미와 Next.js dynamic 페이지의 충돌
- `useOptimistic` 은 transition 이 살아있는 동안만 optimistic 값을 노출, transition 종료 시 base prop 으로 즉시 복귀하는 시소 패턴.
- 이게 잘 동작하려면 transition 종료 시점에 base prop(`inWishlist`) 이 이미 새 값으로 갱신되어 있어야 함.
- `/products` 는 `searchParams` 를 사용하므로 Next.js 가 dynamic 으로 강제 분류 → `revalidatePath` 가 사실상 no-op.
- 추가로 프로그램적 Server Action 호출(`<form onSubmit>` 안의 `await toggleWishlistAction(formData)`)은 form action attribute 와 달리 자동 `router.refresh()` 를 트리거하지 않음.
- 결과: transition 이 끝나도 부모 RSC 가 re-render 되지 않아 base prop 이 영원히 stale → 클릭 → optimistic(true) → 즉시 복귀(stale false) → 영원히 stale 의 깜빡임.

### (2) 헤더 카운트 — layout 컴포넌트의 RSC 비격동
- `UserNavIsland` 는 layout(`(site)/layout.tsx`)에 위치, `useEffect(() => {…}, [])` 으로 mount 시 1회만 `/api/wishlist/count` fetch.
- 같은 layout 안의 페이지를 navigate 해도 layout 컴포넌트는 re-mount 되지 않음 → effect 재실행 없음.
- `router.refresh()` 는 RSC 트리만 갱신, client island 의 `useEffect` 는 재발화 안 함.
- 토글이 다른 island(`WishlistHeartButton`)에서 일어남 — 부모-자식 prop 전달 경로도 없음.

## Decision (결정)

### 결정 A — `useOptimistic` 폐기, manual `useState` + `useEffect(prop sync)` 채택

```tsx
const [displayed, setDisplayed] = useState(inWishlist);
useEffect(() => { setDisplayed(inWishlist); }, [inWishlist]);

// 클릭:
const next = !displayed;
setDisplayed(next);
startTransition(async () => {
  await toggleWishlistAction(formData);
  router.refresh();
  dispatchWishlistChanged();
});
```

핵심 의미 차이: `useOptimistic` 의 "default revert" → manual `useState` 의 "stay until prop changes". 한 번 commit 된 클릭 상태는 외부에서 새 prop 이 도착하기 전까지 유지되므로 깜빡임이 구조적으로 불가능.

### 결정 B — Cross-island 통신은 native `CustomEvent` (wishlistChangeBus)

```ts
// entities/wishlist/model/wishlistChangeBus.ts
export const WISHLIST_CHANGED_EVENT = "wishlist-changed";

export function dispatchWishlistChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WISHLIST_CHANGED_EVENT));
}

export function subscribeWishlistChanged(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(WISHLIST_CHANGED_EVENT, handler);
  return () => window.removeEventListener(WISHLIST_CHANGED_EVENT, handler);
}
```

토글 측은 액션 `await` 후 `dispatchWishlistChanged()` 호출, `UserNavIsland` 는 별도 `useEffect` 에서 listener 등록 → `/api/wishlist/count` 만 재호출. session 은 변하지 않으므로 중복 fetch 없음.

## Consequences (결과)

**얻은 것 (+):**
- 깜빡임 0 — 클릭 즉시 채워진 상태가 안정적으로 유지.
- 헤더 뱃지 실시간 동기화 — Button/Island 어디서 토글해도 즉시 갱신.
- Context/Zustand/Redux 등 전역 상태 도입 회피 — 단일 이벤트 채널(payload 없음, 알림만)로 충분.
- ADR-0018 의 PDP ISR 정책(`layout` 이 cookies 의존 0) 그대로 보존 — 카운트는 여전히 client-fetch.
- SSR 안전 — `typeof window === "undefined"` 가드.

**포기한 것 / 미해결 (−):**
- React 19 `useOptimistic` 의 표준 패턴 포기 — 일반적 가이드와 다른 모양이라 신규 기여자가 의아할 수 있음(주석으로 명시).
- 이벤트 페이로드 없음 → 어떤 상품이 어떻게 바뀌었는지 모르므로 listener 는 무조건 count 재호출 (≈ 7~80KB 트래픽/토글). 사용자 단위로는 사소.
- 여러 탭 동시 토글 시 동기화 없음 — `BroadcastChannel` 도입 가능하나 현재 요구 아님.
- 네트워크 오류 시 클릭 상태가 그대로 유지(되돌리지 않음) — Server Action 안전망이 redirect 로 처리, 일반 사용자에겐 invisible.

## Alternatives Considered (대안)

### 옵션 A — `useOptimistic` + `router.refresh()` 명시 호출

```tsx
startTransition(async () => {
  applyOptimistic(!active);
  await toggleWishlistAction(formData);
  router.refresh();  // RSC 트리 재요청
});
```

**왜 안 골랐나:**
- `router.refresh()` 는 `void` 반환, 내부적으로 별도 transition 을 만들지만 호출자 transition 과 merge 되지 않음.
- timeline: t=100ms await 완료 → t=101 outer transition 종료 → useOptimistic = base(stale) → t=200ms refresh 완료 → 새 prop 도착 → useOptimistic = new.
- 100ms 의 flicker window 잔존 → 사용자에 여전히 보임. 1차 수정에서 이 패턴 시도 후 사용자가 "같은 현상"으로 보고함.

### 옵션 B — `useOptimistic` 사용 + `<form action={fn}>` 패턴 회귀

기존 React 19 form action 패턴(`<form action={(formData) => startTransition(...)}>`)으로 회귀하면 React 가 form 제출을 자동 transition 으로 감싸 useOptimistic 이 더 오래 유지될 가능성.

**왜 안 골랐나:**
- 비로그인 confirm 인터셉트(`window.confirm` 취소 시 navigation 차단)를 `<form action>` 안에 넣으려면 action 함수 안에서 confirm 호출 → `useOptimistic` 의 transition 이 confirm 동안 묶임 → 사용자가 confirm 응답을 결정하는 동안 transition pending 상태(버튼 disabled 등) 가 UI 에 잠깐 노출되는 어색한 동작.
- 또한 confirm 결과에 따라 router.push 분기를 깨끗하게 처리하기 어려움.
- 무엇보다, transition lifetime 이 React/Next 의 내부 구현에 의존 — 버전 업그레이드에 깨질 위험.

### 옵션 C — Context + Provider (전역 wishlist 상태)

`features/wishlist` 에 Context Provider 를 두고 모든 island 가 같은 상태 구독.

**왜 안 골랐나:**
- Provider 를 어디에 두느냐 결정 자체가 layout cookies 의존을 다시 만들 수 있음(ADR-0018 위반 위험).
- 단순 카운트 갱신과 단일 토글 동기화에 Provider 도입은 ROI 낮음.
- island 간 결합도 증가 — 현재는 wishlist 도메인 외부에서도 dispatch 만 알면 충분.

### 옵션 D — Layout 컴포넌트에서 polling

`UserNavIsland` 가 30초마다 `/api/wishlist/count` 폴링.

**왜 안 골랐나:**
- 토글 즉시 반영이 목적인데 30초 지연은 UX 후퇴.
- 폴링 주기 단축 시 서버 부하 증가, 의미 없는 트래픽.
- 이벤트 기반이 폴링보다 모든 차원에서 우월.

### 옵션 E — `<form action={serverAction}>` 직접 패턴

`toggleWishlistAction` 을 form action 으로 직접 바인딩.

**왜 안 골랐나:**
- 비로그인 confirm 인터셉트가 client-side 분기 → server action 이 action 으로 직접 호출되면 confirm 단계 끼울 자리 없음.
- 비로그인 시 callbackUrl 합성도 client 에서 해야 함.

## Notes

- `WishlistHeartButton.tsx` 와 `WishlistHeartIsland.tsx` 의 헤더 주석에 "왜 useOptimistic 안 쓰는지" 명시 — 향후 기여자가 "왜 정공법을 안 쓰지?" 라며 되돌리는 것을 방지.
- 추후 React/Next.js 버전 업그레이드 시 `useOptimistic` + `router.refresh` 의 transition merging 동작이 개선되면 옵션 A 로 회귀 검토 가치 있음.
- 여러 탭 동시 사용 케이스가 실제 보고되면 `BroadcastChannel("wishlist-changed")` 로 확장 가능 — 현재 인터페이스(`dispatchWishlistChanged`/`subscribeWishlistChanged`) 는 내부 구현 교체에 영향 없음.
- 옵션 A 의 100ms flicker window 는 dev 환경(slow network 시뮬레이션) 에서 재현되며 prod fast 네트워크에서도 보이는 수준.
