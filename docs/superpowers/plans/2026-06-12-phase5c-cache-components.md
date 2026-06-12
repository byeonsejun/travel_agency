# Phase 5-C: Next 16 Cache Components 전역 전환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax. 각 Task 완료 즉시 그 자리에서 `[x]` 처리(§4.1), 사전 체크 금지(§4.2).

**Goal:** `cacheComponents: true`를 켜고, `unstable_cache` 20곳 → `use cache`, force-dynamic/runtime/revalidate config export 43곳 제거 + 동적 page 24개 Suspense 격리, `revalidateTag('max')` 9곳 → `updateTag`/`revalidateTag` 정합화. 동작 보존(behavior-preserving) + 안전 도메인(payment/booking/admin) 캐시 금지 무손상.

**Architecture:** [ADR-0053] 박제. **2-gate 점진 전환** — Gate 1(컴파일/config export 43)을 제거해야 Gate 2(prerender/동적 page 24 Suspense)가 노출됨(masking). 전역 플래그가 kill-switch. 플래그 ON 이후 full build는 Phase 3 완료 전까지 의도적 red, 각 Phase는 **typecheck+test로 증분 검증**(전역 build green은 Phase 4 게이트). route handler 11곳은 Gate 1만(Suspense 작업 0).

**Tech Stack:** Next 16.2.9 (Turbopack, cacheComponents), React 19.2, Prisma 5, Vitest 2.

**페르소나:** 💳 Domain Booking(Phase 3 결제·예약 페이지 — 협상 불가), 🏛️ Architect(전 Phase — entities/app 경계), ⚙️ Backend(Phase 1·2 캐시·무효화), 🎨 Frontend(Phase 3·4 Suspense), 🔬 QA(완료 검증).

**핵심 원칙:**
- 동작 보존이 최우선 — TTL·태그·반환 타입·키 양자화(analytics day-key) 무손상.
- `cacheTag`/`cacheLife`는 `use cache` 스코프 밖(vitest)에서 throw → 데이터레이어 단위테스트는 `next/cache` 모킹 필수.
- 안전 도메인 force-dynamic 제거 = "캐시됨"이 아님 → 동적 읽기를 `<Suspense>`로 격리(여전히 per-request). strict 빌드가 우발적 캐싱을 컴파일 타임 차단.
- ADR-0020 태그 네임스페이스(`TAG_PRODUCTS_*`/`tagProductDetail`/`tagDeparturesByProduct`/`TAG_DASHBOARD`/`TAG_RUM`) SSOT 무손상 — `cacheTag()`로 이식.

---

## 전환 대상 인벤토리 (실측)

**`unstable_cache` 20곳:**
- product (5): `getDistinctDestinations`(3600/DEST), `getFeaturedProducts`(300/FEATURED), `getProductById`(3600/per-id), `getProductList`(300/LIST), `getProductsByIds`(3600/per-id fan-out)
- departure (1): `getDeparturesByProduct`(3600/per-product)
- analytics/queries (7): `getRevenueSummary`·`getPenaltyRevenue`·`getCancellationStats`·`getRevenueTrend`(60/DASHBOARD, day-key), `getSeatOccupancy`·`getBookingStatusDistribution`(60/DASHBOARD, product-key), `getProductOptions`(300/DASHBOARD)
- analytics/drilldown (4): `getRevenueRows`·`getPenaltyRows`·`getCancellationRows`(60/DASHBOARD, day-key), `getOccupancyRows`(60/DASHBOARD, product-key)
- analytics/rum (3): `getWebVitalSummary`·`getWebVitalByRoute`·`getWebVitalTrend`(60/RUM)

**Gate 1 config export 43곳:** `dynamic`×31, `runtime`×10, `revalidate`×2 (24 page + 11 route handler).
**Gate 2 동적 page 24곳:** site 8(home/PDP 포함 ISR 2) + admin 16. route handler 11곳은 제외.
**무효화 9곳:** `revalidateTag(_, 'max')` — 6 features actions.ts.

---

## Phase 1: 캐시 레이어 이식 (`unstable_cache` → `use cache`)

> 격리된 entities 레이어. flag ON + 20 함수 전환. 검증 = typecheck + 해당 슬라이스 test(전역 build는 Phase 3까지 red).

### Task 1.0: 플래그 ON + 테스트 하네스 방어
**Files:** Modify `next.config.mjs`, `src/entities/analytics/api/__tests__/rum.test.ts`, `src/features/admin-dashboard-drilldown/server/__tests__/actions.test.ts`

- [x] **Step 1:** `next.config.mjs`에 `cacheComponents: true` 추가 (주석: [ADR-0053] Phase 5-C).
- [x] **Step 2:** `vitest.setup.ts`에 `next/cache` **전역 모킹**(unstable_cache passthrough + cacheTag/cacheLife/revalidateTag/updateTag/revalidatePath no-op) 추가 + rum.test.ts 로컬 모킹 제거(전역 위임). 전이 importer까지 방어.
- [x] **Step 3:** analytics/drilldown/admin-product 65 tests green + rum 3 green 확인.

### Task 1.1: product/api/queries.ts (5 함수)
**Files:** Modify `src/entities/product/api/queries.ts`

- [x] **Step 1:** `getDistinctDestinations` → `async function` + `"use cache"` + `cacheTag(TAG_DESTINATIONS_LIST)` + `cacheLife({ revalidate: 3600 })`. keyParts 제거.
- [x] **Step 2:** `getFeaturedProducts(limit)` → `"use cache"` + `cacheTag(TAG_PRODUCTS_FEATURED)` + `cacheLife({ revalidate: 300 })`. `limit` 자동 키.
- [x] **Step 3:** `getProductById(id)` → outer/inner 병합, `"use cache"` + `cacheTag(tagProductDetail(id))` + `cacheLife({ revalidate: 3600 })`.
- [x] **Step 4:** `getProductList(params)` → 정규화 primitive를 받는 private `_getProductListCached`(use cache) 추출, `cacheTag(TAG_PRODUCTS_LIST)` + `cacheLife({ revalidate: 300 })`. (Date 인자 없음 — 안전)
- [x] **Step 5:** `getProductsByIds(ids)` → private `_getProductsByIdsCached`(use cache) + `cacheTag(...ids.map(tagProductDetail))` fan-out + `cacheLife({ revalidate: 3600 })`. 빈 배열 early-return 보존.
- [x] **Step 6:** `unstable_cache` import 제거, `cacheTag`/`cacheLife` import 추가. typecheck 0 errors.

### Task 1.2: departure/api/queries.ts (1 함수)
**Files:** Modify `src/entities/departure/api/queries.ts`

- [x] **Step 1:** `getDeparturesByProduct(productId)` → `"use cache"` + `cacheTag(tagDeparturesByProduct(productId))` + `cacheLife({ revalidate: 3600 })`. uncached 함수들(listDepartureSeats/getDepartureById/listAdminDepartures/getAdminDepartureById)은 **미변경**(의도적 신선도).
- [x] **Step 2:** import 정리 + typecheck green.

### Task 1.3: analytics/api/queries.ts (7 함수 — day-key 보존)
**Files:** Modify `src/entities/analytics/api/queries.ts`

- [x] **Step 1:** day-key 전략 확정 — filter.ts 실측으로 `from`/`to`가 **UTC 자정 day-aligned 결정론적**(from=startDay 00:00, to=endDay+1d 00:00)임을 확인. 따라서 raw Date를 use cache 인자로 직접 넘겨도 키가 일 단위 안정 → 기존 private `_revenue/_penalty/...`에 use cache 직접 부여(재구성 불요).
- [x] **Step 2:** range 종속 4종(`_revenue`/`_penalty`/`_cancellation`/`_trend`)에 `"use cache"` + `cacheTag(TAG_DASHBOARD)` + `cacheLife({ revalidate: 60 })`. public 래퍼는 pass-through.
- [x] **Step 3:** 스냅샷 2종(`_occupancy`/`_statusDistribution`) → productId 단일 인자 키, 동일 태그/TTL.
- [x] **Step 4:** `_productOptions` → `cacheLife({ revalidate: 300 })`. CACHE_OPTS 상수 제거.
- [x] **Step 5:** import 정리 + analytics 테스트 green.

### Task 1.4: analytics/api/drilldown.ts (4 함수)
**Files:** Modify `src/entities/analytics/api/drilldown.ts`

- [x] **Step 1:** Task 1.3과 동형으로 private `_revenue`/`_penalty`/`_cancellation`(day-key) + `_occupancy`(product-key)에 use cache 직접 부여. `cacheTag(TAG_DASHBOARD)` + `cacheLife({ revalidate: 60 })`. CACHE_OPTS 제거.
- [x] **Step 2:** drilldown actions.test.ts 5 tests green.

### Task 1.5: analytics/api/rum.ts (3 함수)
**Files:** Modify `src/entities/analytics/api/rum.ts`

- [x] **Step 1:** private `_summary`/`_byRoute`/`_trend`에 `"use cache"` + `cacheTag(TAG_RUM)` + `cacheLife({ revalidate: 60 })`. 무인자(고정 키). 시간윈도우는 SQL NOW()라 미스마다 재평가. CACHE_OPTS 제거.
- [x] **Step 2:** rum.test.ts 3 tests green.

### Task 1.6: Phase 1 종합 검증
- [x] **Step 1:** `npm run typecheck` 0 errors.
- [x] **Step 2:** `npm run test` 전체 green (157 파일 / 1188 tests).
- [x] **Step 3:** `npm run lint` 0 errors (10 pre-existing warnings, 변환 파일 무관).
- [x] **Step 4:** 잔여 `unstable_cache` 0 실사용 확인(주석 2건만 — types.ts JSDoc·rum.test 주석).
- [ ] **Step 5:** 커밋 `feat(cache): migrate entities unstable_cache to use cache (Phase 5-C/1)`.

---

## Phase 2: 무효화 컨트랙트 전환 (`'max'` → `updateTag`/`revalidateTag`)

> ADR-0052 `'max'` 워크어라운드 청산. same-request 즉시성 필요처만 `updateTag`.

### Task 2.1: 무효화 호출 9곳 분류·전환
**Files:** `src/features/{admin-product,admin-departure,admin-booking-cancel,booking-cancel,checkout,admin-departure-cancel}/server/actions.ts`

- [ ] **Step 1:** 각 호출을 same-request 즉시성(admin 수정→PDP 즉시 반영) vs 백그라운드로 분류.
- [ ] **Step 2:** 즉시성 필요처 → `updateTag(tag)`(2-arg `'max'` 제거), 백그라운드 → `revalidateTag(tag)`(1-arg 복원).
- [ ] **Step 3:** 병렬 `revalidatePath` 보완 관계 유지 확인(ADR-0020/0052 주석 갱신).
- [ ] **Step 4:** typecheck + 해당 features test green.
- [ ] **Step 5:** 커밋 `refactor(cache): replace revalidateTag 'max' with updateTag/revalidateTag (Phase 5-C/2)`.

---

## Phase 3: 동적 라우트 Suspense 재배치 (Gate 1 + Gate 2)

> 💳 안전 도메인 우선. config export 제거 → 동적 읽기를 Suspense 격리. Phase 7 `loading.tsx` 스켈레톤 재활용.

### Task 3.0: Gate 1 — config export 43곳 제거 (기계적)
- [ ] **Step 1:** `dynamic`×31 / `runtime`×10 / `revalidate`×2 export 라인 제거(작은따옴표 webhook 포함). 주변 주석 정리.
- [ ] **Step 2:** `runtime="nodejs"` 제거 후 route handler가 Edge 강등 안 됨 확인(default nodejs).

### Task 3.1: 안전 도메인 page Suspense (💳 우선)
**Files:** `(site)/products/[id]/checkout`, `(site)/bookings/[id]{,/success,/failed}`, `(site)/mypage`, `(site)/reviews/new`

- [ ] **Step 1:** 각 page의 `auth()`/`searchParams`/`cookies()`/uncached db 읽기를 `<Suspense>` 경계 child로 격리. 정적 셸은 즉시 prerender.
- [ ] **Step 2:** 결제·예약 상태가 절대 prerender(static)되지 않음을 빌드 출력(`ƒ`/dynamic 표기)으로 확인.

### Task 3.2: admin page Suspense (16곳)
**Files:** `(admin)/admin/**/page.tsx` 16개

- [ ] **Step 1:** 각 admin page 동적 읽기를 Suspense 격리(운영 즉시성 보존).
- [ ] **Step 2:** 반복 빌드로 Gate 2 에러 0까지 수렴(첫-에러-중단 특성 → 페이지별 순차).
- [ ] **Step 3:** 커밋 `feat(routing): suspense boundaries for dynamic routes, remove force-dynamic (Phase 5-C/3)`.

---

## Phase 4: ISR 전환 + 전역 검증

### Task 4.1: ISR 2개 (home/PDP)
**Files:** `(site)/page.tsx`, `(site)/products/[id]/page.tsx`

- [ ] **Step 1:** `export const revalidate` 제거 → 데이터 fn의 `cacheLife`로 TTL 이전(home 300s / PDP 3600s). `generateStaticParams` 보존.
- [ ] **Step 2:** 빌드 출력에서 home/PDP가 PPR(부분 prerender)로 표기되는지 확인.

### Task 4.2: 🔬 전역 검증 (증거 기반)
- [ ] **Step 1:** `npm run build` green (Gate 1 + Gate 2 0 errors).
- [ ] **Step 2:** `npm run typecheck` 0 / `npm run test` 157 green / `npm run lint` 0.
- [ ] **Step 3:** dev 런타임 스모크 — PDP 캐시 hit, admin 수정→PDP `updateTag` 즉시 반영, 결제 페이지 동적성(매 요청 신선) 증거 수집.
- [ ] **Step 4:** 잔여 `unstable_cache`/`force-dynamic`/`revalidate` export 0 확인.

### Task 4.3: 종합 보고 + CLAUDE.md 갱신
- [ ] **Step 1:** [ADR-0053] `관련 commit` 채움.
- [ ] **Step 2:** CLAUDE.md §8 "Phase 5-C 완료" + 혼란 방지 노트(2-gate masking, updateTag 정책, route handler Gate1-only) 추가.
- [ ] **Step 3:** PR 생성(§7.1 보고 양식).

---

## Final Checklist
- [ ] `unstable_cache` 0 (src 전역, 주석 제외)
- [ ] `export const dynamic/runtime/revalidate` 0 (src/app)
- [ ] `revalidateTag(_, 'max')` 0 (`updateTag` 또는 1-arg로 전환)
- [ ] `npm run build` / `typecheck` / `test`(157) / `lint` 전부 green
- [ ] 결제·예약 상태 prerender 0 (빌드 출력 dynamic 표기로 증명)
- [ ] [ADR-0053] commit 채움 + CLAUDE.md 갱신
