# Phase 7 — 네비게이션 UX & 렌더링 성능 최적화 (설계)

> 작성일: 2026-06-04
> 에픽: Phase 7 (Frontend Performance & UX Optimization)
> 페르소나: 🎨 Frontend Expert (필수), 🏛️ Architect (필수 — shared/ui 배치·FSD 경계)

---

## 1. 문제 정의 (Why)

사용자가 체감하는 "클릭 후 아무 피드백 없이 지연되다가 페이지가 이동하는 현상"의 근본 원인은 두 가지다.

| 근본 원인 | 현재 상태 (증거) |
|---|---|
| **A. 라우트 레벨 즉각 피드백 부재** | `loading.tsx` 가 전체 App Router 에서 `(site)/search/` **단 1곳**. `/products`(무거운 `Promise.all` 3쿼리), `/mypage`(`force-dynamic` + auth + 4쿼리), `/products/[id]`(ISR-on-demand 미스 시) 진입 시 RSC 가 해석되는 동안 **직전 화면에서 멈춤** |
| **B. 클라이언트 인터랙션 펜딩 미표시** | `SortSelect`·`SearchBox` 가 `router.push` 를 **`useTransition` 없이** 호출 → 클릭/제출 후 스피너·dimming 0. 정렬 드롭다운/검색 버튼이 그냥 굳음 |

> 참고: `useTransition` 은 이미 6곳에 있으나 전부 **mutation 용**(wishlist·compare·review). **네비게이션 펜딩 처리는 0곳** — 이것이 "답답한 지연"의 정체다.

### 결정된 환경 제약
- **Next.js 15.5.18** (설치 버전 확인 완료, ≥ 15.3) → `next/link` 의 **`useLinkStatus` 네이티브 훅 사용 가능**. `nprogress` 등 외부 라이브러리 추가 **금지**(YAGNI + 번들 증가).
- React 19 — `useTransition` / Suspense 정식.

---

## 2. 타겟 UX 병목 3곳 (우선순위)

1. **`/products` 필터·정렬·검색 인터랙션** (가장 체감 큼)
   - `SortSelect`(`router.push`)·`SearchBox`(`router.push`) → 펜딩 미표시
   - 필터 탭·페이지네이션(`<Link>`) → 진입 시 `loading.tsx` 부재
2. **`/mypage` 진입 지연** — `force-dynamic` + auth + 4쿼리인데 `loading.tsx` 0
3. **PDP(`/products/[id]`) 리뷰 블로킹** — 리뷰/통계/분포 3쿼리가 상품 본문 초기 페인트를 동기 지연

---

## 3. 아키텍처 (How)

### 3.1 shared/ui 스켈레톤 primitive (Architect 경계)

FSD 단방향 무손상 원칙: **도메인 무지(domain-agnostic) primitive 만 `shared/ui` 에 배치**, 도메인 셰입을 모방하는 스켈레톤은 **해당 위젯 옆에 배치**.

| 파일 | 레이어 | 책임 |
|---|---|---|
| `shared/ui/Skeleton.tsx` | shared | 베이스 펄스 박스. `className` 만 받는 순수 프레젠테이션. `'use client'` 불필요(RSC 안전, CSS 애니메이션). |
| `widgets/product-card-list/ui/ProductCardSkeleton.tsx` | widgets | `Skeleton` 조합으로 `ProductCard` 레이아웃(이미지+제목+가격+태그) 모방 |
| `widgets/booking-list/ui/BookingRowSkeleton.tsx` | widgets | mypage 예약 리스트 행 모방 |

- `shared/ui/Skeleton` 은 `env` import 금지(client-safe 규칙) — 단, CSS only 라 client 번들 진입 위험 자체가 없음.
- 기존 `(site)/search/loading.tsx` 의 인라인 카드 펄스를 `ProductCardSkeleton` 으로 **교체(dedupe)**.

### 3.2 라우트 레벨 `loading.tsx` (즉각 피드백 A 해결)

각 라우트의 `loading.tsx` 는 위 primitive 를 **조합만** 한다(레이아웃 셸은 라우트 소유). Next App Router 가 RSC 펜딩 동안 자동 표시.

| 신규 파일 | 구성 |
|---|---|
| `(site)/products/loading.tsx` | 필터바 펄스 + `ProductCardSkeleton` 그리드(`PAGE_SIZE` 개) |
| `(site)/mypage/loading.tsx` | 프로필 카드 펄스 + `BookingRowSkeleton` × N + 위시리스트 그리드 펄스 |
| `(site)/products/[id]/loading.tsx` | PDP 히어로(이미지+제목+가격) + 본문 펄스. ISR-on-demand 미스/`dynamicParams` 첫 요청 시 표시 |
| `(site)/search/loading.tsx` | (리팩토링) `ProductCardSkeleton` 재사용으로 중복 제거 |

> PDP 는 ISR(`revalidate=3600`)이라 캐시 히트 시 즉시 응답 → `loading.tsx` 는 캐시 미스/온디맨드 생성 시에만 노출(안전망).

### 3.3 PDP Suspense 스트리밍 (병목 #3 해결)

리뷰 3쿼리(`getProductReviewStats`·`listReviewsByProduct`·`getReviewRatingDistribution`)를 **비동기 자식 서버 컴포넌트로 추출**, `<Suspense>` 로 감싸 본문과 분리 스트리밍.

```
ProductDetailPage (RSC)
  └─ await [product, departures]          ← 본문 즉시 페인트
  └─ reviewsSection = <Suspense fallback={<ReviewsSkeleton/>}>
                         <ProductReviewsSection productId={id} />   ← 스트리밍
                       </Suspense>
```

- 신규: `widgets/product-detail/ui/ProductReviewsSection.tsx` (async RSC) — 내부에서 리뷰 3쿼리 `Promise.all`, 기존 `ReviewStatsBar`/`RatingDistribution`/`ReviewFeed` 조합 렌더. 기존 page.tsx 의 인라인 JSX 를 그대로 이동.
- 신규: `widgets/product-detail/ui/ReviewsSkeleton.tsx` — fallback 펄스.
- `page.tsx` 는 `product`·`departures` 만 await(리뷰는 더 이상 page 의 `Promise.all` 에 없음).
- **트레이드오프**: 전체 5쿼리 병렬 → 본문 2쿼리 우선 + 리뷰 스트리밍. 총 시간 약간 증가하나 **첫 페인트(상품 본문) 대폭 단축**. PDP 의 핵심 콘텐츠는 상품 정보이므로 의도된 선택.

### 3.4 인터랙션 펜딩 — `useTransition` (병목 #1-a 해결)

`router.push` 를 `startTransition` 으로 감싸고 `isPending` 으로 시각 처리.

| 컴포넌트 | 변경 |
|---|---|
| `features/search/ui/SearchBox.tsx` | `useTransition` 추가. 제출 시 `startTransition(() => router.push(...))`, `isPending` 동안 버튼에 스피너 + `disabled` |
| `widgets/product-card-list/ui/SortSelect.tsx` | `useTransition` 추가. 변경 시 `startTransition(() => router.push(...))`, `isPending` 동안 select `opacity-50` + 우측 스피너 |

- `useTransition` 은 타이머/리스너 없음 → **cleanup 불필요**(frontend 규칙 준수).

### 3.5 전역 라우트 프로그레스 바 — `useLinkStatus` (병목 #1-b 해결)

`<Link>` 기반 네비게이션(필터 탭·페이지네이션)의 펜딩을 상단 바로 표시. **프레임워크 네이티브 `useLinkStatus`** 사용 — 의존성 0, 타이머 0, 수동 cleanup 0.

- 신규: `shared/ui/RouteProgress.tsx` (`'use client'`) — `useLinkStatus()` 의 `pending` 을 읽어 `position: fixed; top-0` 상단 바를 렌더. `pending` 일 때만 표시. **`<Link>` 의 자식으로 렌더되어야** 동작(훅 제약).
- 신규: `shared/ui/ProgressLink.tsx` (`'use client'`) — `next/link` `<Link>` 래퍼. `children` + `<RouteProgress/>` 를 함께 렌더. 클릭된 Link 만 `pending` → 단일 상단 바처럼 보임.
- 적용: `ProductFilterBar` 의 destination 탭 `<Link>` + `Pagination` 의 `<Link>` 를 `ProgressLink` 로 교체.
- `loading.tsx` 존재로 펜딩 윈도우가 생겨 시너지(바가 실제로 보임).
- `env` import 금지 규칙 준수(CSS only, 순수 훅).

> `useLinkStatus` 는 `<Link>` 내부에서만 동작하므로 `router.push`(프로그래매틱) 는 커버 못 함 → 그쪽은 §3.4 의 컴포넌트별 `isPending` 으로 처리. 역할 분담 명확.

---

## 4. FSD / 페르소나 경계 점검

- 🏛️ **Architect**: `shared/ui` 에는 도메인 무지 primitive(`Skeleton`/`RouteProgress`/`ProgressLink`)만. 도메인 셰입 스켈레톤은 위젯 레이어. 깊은 경로 import 0, cross-slice import 0. `entities/**/ui` 에 `'use client'` 추가 0.
- 🎨 **Frontend Expert**: page/layout 에 `'use client'` 0. 신규 client island(`SortSelect`·`SearchBox`·`RouteProgress`·`ProgressLink`)는 모두 leaf. `useTransition`/`useLinkStatus` 는 타이머·리스너 없음 → cleanup 불필요. `shared` client 헬퍼 `env` import 0.
- 🔬 **QA**: 각 변경에 typecheck/test + 런타임 증거(스켈레톤 노출·펜딩 표시) 수집.

## 5. 비범위 (Out of Scope / YAGNI)

- 헤더 nav(`UserNavIsland` 등) 의 `ProgressLink` 채택 — 후속(패턴 정착 후).
- admin 셸(`(admin)/**`) 의 loading.tsx — 내부 운영 화면, 체감 우선순위 낮음.
- `nprogress` 등 외부 프로그레스 라이브러리.
- PDP 외 추가 페이지 Suspense 분할.
- 이미지 lazy/우선순위 튜닝, 번들 분석 — 별도 에픽.

## 6. 검증 전략

- `npm run typecheck` / `npm run test` / `npm run lint` 그린.
- `grep -c "use client" src/shared/ui/RouteProgress.tsx src/shared/ui/ProgressLink.tsx` → 각 1.
- `find src/app -name loading.tsx` → 4개(products·mypage·products/[id]·search).
- 런타임: dev 서버에서 느린 네트워크(throttle)로 ① 정렬 변경 시 스피너 ② 필터 탭 클릭 시 상단 바 ③ /products·/mypage 진입 시 스켈레톤 ④ PDP 본문 먼저, 리뷰 나중 스트리밍 확인.
