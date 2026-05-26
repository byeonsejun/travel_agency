# ADR-0017: `useSearchParams` 클라이언트 컴포넌트의 Suspense 박제(內) 패턴

- **상태**: Accepted
- **결정일**: 2026-05-26
- **영향 범위**:
  - `src/features/product-compare/ui/CompareToggleButton.tsx`
  - `src/features/product-compare/ui/FloatingCompareCart.tsx`
  - (향후) `useSearchParams` 를 도입하는 모든 클라이언트 컴포넌트
- **관련 commit**: A6 wishlist island 작업의 build 검증 단계에서 발견·해결

## Context (배경)

[ADR-0012] 에서 PDP 의 `searchParams.compareIds` 의존을 client-fetch island
(`FloatingCompareCart`) 로 분리했고, 본 작업(A6 / `2026-05-26-wishlist-island.md`)
에서 wishlist 의존까지 island 로 분리한 뒤 `next build` 를 시도했더니 다음 에러로
빌드가 prerender 단계에서 중단됐다:

```
⨯ useSearchParams() should be wrapped in a suspense boundary at page "/".
Error occurred prerendering page "/".
Export encountered an error on /(site)/page: /, exiting the build.
```

원인은 Next.js 15 의 prerender 경계 규칙:

- `useSearchParams()` 는 정적 prerender 시점에 `null` 을 반환한다.
- Next 는 이를 감지하면 페이지 트리 전체를 CSR fallback 으로 강제 전환한다 (bailout-to-CSR).
- Suspense 경계 없이 page 트리 안에 `useSearchParams` client 컴포넌트가 있으면 build 가 거부됨.

`features/product-compare` 의 두 컴포넌트가 정적 prerender 대상 페이지에 노출되어 있다:

| 컴포넌트 | `useSearchParams` | 노출되는 prerender 대상 |
|---|:---:|---|
| `CompareToggleButton` | ✅ | `/` (revalidate=300), `/products/[id]` (A6 후 revalidate=3600), 모든 product card |
| `FloatingCompareCart` | ✅ | `/products/[id]` |
| `CompareRemoveButton` | ✅ | (FloatingCompareCart 내부 한정 — 부모 Suspense 안에 위치) |

이 문제는 단순 버그가 아니라 **"클라이언트 컴포넌트의 URL state 의존을 어디서 흡수할 것인가"** 라는 구조적 결정이다.

## Decision (결정)

`useSearchParams` 를 사용하는 client component 는 **컴포넌트 파일 내부에서 자체 Suspense 경계를 박제**한다. 외부 export 는 Suspense 래퍼, 내부 로직은 private `XInner` 로 분리:

```tsx
"use client";
import { Suspense } from "react";

function CompareToggleButtonInner(props: Props) {
  const searchParams = useSearchParams();
  // ... 실제 로직
}

function CompareToggleButtonFallback(
  props: Pick<Props, "size" | "className">,
) {
  // dimensions 동일, inactive 기본 상태 (URL 미해석)
  return <button disabled aria-pressed={false} ...>+ 비교</button>;
}

export function CompareToggleButton(props: Props) {
  return (
    <Suspense fallback={<CompareToggleButtonFallback {...props} />}>
      <CompareToggleButtonInner {...props} />
    </Suspense>
  );
}
```

핵심 원칙:

- **소유권 위치 = 의존성 위치.** URL state 의존은 `features/product-compare` 의 내부 사정이므로, 그 비용(Suspense 경계) 도 같은 슬라이스 안에서 흡수한다.
- **Fallback 은 dimensions 동일 + inactive 기본 상태.** Layout shift 0, hydration 후 1회 active 전환만 발생.
- **Consumer 는 0 cost.** 호출처는 `<CompareToggleButton ... />` 만 호출하면 자동 prerender-safe — 모든 product card 가 무수정으로 보호받음.

`CompareRemoveButton` 은 `FloatingCompareCart` 내부 한정 사용이라 부모 Suspense 안에 자연스럽게 위치 → 별도 박제 불필요 (YAGNI). `SortSelect` 는 `/products` (dynamic 페이지) 한정 사용이라 동일 사유로 미수정.

## Consequences (결과)

**얻은 것:**

- 정적 prerender 빌드 통과 (14/14 페이지 생성 성공, 이전엔 prerender error 로 중단).
- 모든 product card 호출처가 무수정으로 자동 보호 — DRY 절대값 큼 (홈/PDP/`/products` × N 카드).
- URL state 흡수 책임이 `features/product-compare` 한 슬라이스에 캡슐화 → 새 `useSearchParams` 컴포넌트 추가 시 동일 패턴 복사로 안전 확보.
- Fallback 마크업과 실제 마크업의 dimensions 가 동일해 CLS 0.

**포기한 것 / 미해결:**

- 호출처가 fallback UI 를 커스터마이즈할 수 없음. 단, 본 시스템의 사용 맥락(고정 dimensions 버튼/카트) 에서는 디폴트 fallback 이 모든 상황을 커버.
- `?compareIds=...` 가 URL 에 있는 페이지에 진입한 사용자는 hydration 후 "+ 비교" → "✓ 비교함" 1회 시각 전환 발생. ADR-0012 의 카트 깜빡임, A6 의 wishlist 깜빡임과 동질의 비용 — 정적 prerender 의 본질적 트레이드오프.
- 본 ADR 은 **빌드 통과**만 보장. `/products/[id]` 가 빌드 출력에서 `●` (ISR) 표기로 승격되려면 추가로 `(site)/layout.tsx` 의 `UserNav.auth()` 의존이 PPR 옵트인이나 layout 격리로 처리되어야 함 — 별도 결정 대상 ([ADR-0006] PPR-ready layout 의 후속 결정 필요).

## Alternatives Considered (대안 — 가장 중요한 섹션)

### 옵션 A: 호출처마다 `<Suspense>` 래핑 (consumer-side)

```tsx
// 모든 호출처
<Suspense fallback={<Skeleton />}>
  <CompareToggleButton productId={id} />
</Suspense>
```

- ❌ 호출처가 매우 많음 (모든 product card × 모든 page). 누락 위험 + DRY 위배.
- ❌ Consumer 가 features 의 내부 사정(URL state 의존) 을 알아야 함 — encapsulation 깨짐.
- ❌ 새 product card 호출처 추가 시 매번 Suspense 작성을 강제. 누락하면 prerender 다시 깨짐.
- ✅ Fallback UI 를 호출처마다 다르게 줄 수 있음. 하지만 본 시스템에서 그럴 필요 없음 (모든 호출처가 동일 dimensions·동일 상태 의미).
- 본 시스템에는 비대칭 비용. 거부.

### 옵션 B: `useSearchParams` 제거 → `window.location.search` 파싱 (`useEffect`)

`useEffect` 안에서 `window.location.search` 를 파싱하고 client state 로 보관.

- ❌ Hydration mismatch 위험 (SSR `null` vs 클라 실제값).
- ❌ Next.js router 와 동기화 손실 — `router.replace(...)` 후 URL 변경에 반응 못 함 (이벤트 구독 필요).
- ❌ 기존 router-aware 동작(`startTransition` + `router.replace`) 재구현 비용.
- ❌ Next.js 가 권장하지 않는 패턴 — 향후 유지보수자가 의심.
- 거부.

### 옵션 D: page/layout 최상위 단일 `<Suspense>`

`(site)/page.tsx` 와 `(site)/products/[id]/page.tsx` 의 `<ProductCardList>` / `<ProductDetail>` 전체를 Suspense 로 감쌈.

- ❌ Suspense 안의 모든 자식이 fallback 으로 표시됨 — ProductCardList 의 상품 목록 자체가 prerender 안 됨.
- ❌ ISR 의 가장 큰 이득(RSC 가 정적으로 미리 prerender 된 상품 목록 HTML 전송)을 무효화 — 페이지 절반이 CSR fallback.
- ❌ A4(ADR-0012) + A6 의 island 분리 노력 자체가 무의미해짐.
- 거부.

### 옵션 E: PPR (Partial Prerendering) opt-in

`next.config.mjs` 에 `experimental.ppr = 'incremental'` 옵트인 → 정적/동적 영역을 자동 분리.

- ❌ Next 15 에서 PPR 은 **experimental** — [ADR-0012] 의 거부 사유 동일하게 유효:
  - API/동작 변경 가능성
  - 결제·예약·웹훅 등 안정성 민감 도메인이 영향 받을 수 있음 (🛑 NO-REAL-MONEY 원칙 [ADR-0009])
- ✅ 가장 우아한 장기 모델. PPR stable 승격 후 본 ADR 은 부분 supersede 대상이 될 수 있음 (`Suspense` 박제 자체는 PPR 에서도 유효한 패턴 — 호환).
- 채택 보류. 시기상조.

## Notes

- **후속 작업 후보**: `SortSelect` 가 정적 페이지에 사용될 경우 동일 패턴 적용. 현재 `/products` (dynamic) 한정 사용이라 미수정.
- **신규 작성 가이드**: `useSearchParams` 를 새 client component 에 도입할 때 본 ADR 의 박제 패턴(`XInner` + `XFallback` + Suspense 래퍼 export) 을 따른다.
- **ISR 완전 활성화 후속**: 본 ADR 은 빌드 통과까지만 보장. `/products/[id]` 가 build 출력에서 `●` (ISR) 표기로 승격되려면 `(site)/layout.tsx` 의 `auth()` 의존을 PPR 옵트인 또는 layout 격리로 처리해야 함 ([ADR-0006] 의 PPR-ready layout 의도와 정합 — 후속 ADR/plan 필요).
- **6개월 뒤 의심받을 가능성**: "왜 호출처에서 Suspense 안 감쌌지?" — 답: features/product-compare 내부 사정인 URL state 의존을 consumer 에게 누설하지 않기 위함. encapsulation 우선 + 호출처 다수에 따른 DRY.
- **본 ADR 의 위상**: [ADR-0012] (PDP searchParams → client-fetch island) 의 구조적 후속. `useSearchParams` 의존을 island 로 격리한 결과 발생한 새 제약(Suspense) 을 동일 슬라이스 안에서 흡수하는 패턴.
