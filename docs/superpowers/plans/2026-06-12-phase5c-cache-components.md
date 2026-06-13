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
- [x] **Step 5:** 커밋 `feat(cache): migrate entities unstable_cache to use cache (Phase 5-C/1)` (`3f8df71`).

---

## Phase 2: 무효화 컨트랙트 전환 (`'max'` → `updateTag`/`revalidateTag`)

> ADR-0052 `'max'` 워크어라운드 청산. same-request 즉시성 필요처만 `updateTag`.

### Task 2.1: 무효화 호출 9곳 분류·전환
**Files:** `src/features/{admin-product,admin-departure,admin-booking-cancel,booking-cancel,checkout,admin-departure-cancel}/server/actions.ts`

> **⚠️ 실측 발견 (계획 가정 정정):** Next 16.2.9의 `revalidateTag` 타입 시그니처는 `revalidateTag(tag, profile)`로 **2-arg 강제**다(`node_modules/next/dist/server/web/spec-extension/revalidate.d.ts` 확인) — 본 plan과 ADR-0053 §4가 가정한 "1-arg 복원"은 **불가능**. 1-arg 무효화기는 `updateTag(tag)`(Server Action 전용, read-your-writes)뿐이다. 9곳 모두 Server Action이고, plan Final Checklist가 `revalidateTag(_, 'max')` **0**을 요구하므로 → **9곳 전부 `updateTag`로 일원화**. 좌석 무효화는 stale-window 0이 정합성에 최선이라 customer 경로(checkout/booking-cancel)도 `updateTag`가 오히려 우월. ADR-0053 §4 "백그라운드 revalidateTag" 조항은 사문화 → Phase 4.3에서 ADR 정정 필요.

- [x] **Step 1:** 각 호출을 same-request 즉시성(admin 수정→PDP 즉시 반영) vs 백그라운드로 분류. → 타입 실측 결과 1-arg revalidateTag 부재 + Final Checklist "max 0" 요구로 9곳 전부 즉시성(`updateTag`)로 수렴.
- [x] **Step 2:** 9곳 전부 `updateTag(tag)`로 전환(2-arg `'max'` 제거). admin 4곳(product×4태그/departure/departure-cancel/booking-cancel) + customer 2곳(checkout/booking-cancel).
- [x] **Step 3:** 병렬 `revalidatePath` 보완 관계 유지(전부 보존). ADR-0020 태그 네임스페이스 무손상, 6개 actions.ts 주석 갱신(updateTag=no-stale 근거 박제).
- [x] **Step 4:** typecheck 0 errors + 6 features test green(admin-product 36 / admin-departure 10 / admin-departure-cancel 4 / checkout 9 / booking-cancel 12 + orderSeq/schemas). 전역 test 157파일/1188 green. lint 0 errors.
- [x] **Step 5:** 커밋 `refactor(cache): replace revalidateTag 'max' with updateTag (Phase 5-C/2)`.

---

## Phase 3: 동적 라우트 Suspense 재배치 (Gate 1 + Gate 2)

> 💳 안전 도메인 우선. config export 제거 → 동적 읽기를 Suspense 격리. Phase 7 `loading.tsx` 스켈레톤 재활용.

### Task 3.0: Gate 1 — config export 43곳 제거 (기계적) + 잠복 누출 봉합
- [x] **Step 1:** `dynamic`×31 / `runtime`×10 / `revalidate`×2 export 43곳 전량 제거(작은따옴표 webhook 포함). home/PDP/departures-route 주석 갱신(unstable_cache/ISR/force-dynamic 언급 정정).
- [x] **Step 2:** `runtime="nodejs"` 제거 후 Edge 강등 0 — Next 16 route handler default=nodejs, `runtime="edge"` 0건(grep 확인)이라 구조적으로 안전.
- [x] **Step 3 (잠복 결함 — Phase 1 회귀, 빌드만 포착):** `cacheComponents` 첫 빌드가 드러낸 **client→배럴→`use cache` 누출** 15건 봉합. client island이 `use cache`를 품은 entity 배럴을 **value import**하면 서버 그래프가 client 번들로 compile돼 `It is not allowed to define inline "use cache" ... in Client Components` 에러. 3곳:
  - `LiveDepartureList`(departure 배럴 `DEPARTURE_BADGE_THRESHOLD`) → 서버부모 `ProductDetail`이 `badgeThreshold` prop 주입.
  - `DateRangePicker`(analytics 배럴 `PRESETS`/`presetRange`) → 서버부모 `AdminDashboard`가 `presets`(사전계산) prop 주입, client는 `import type`만.
  - `DrilldownSheet`(analytics 배럴 `DRILLDOWN_COLUMNS`/`DRILLDOWN_LABEL`, **접근자 함수라 non-serializable → props 불가**) → 프레젠테이션 메타데이터를 feature로 이관(`features/admin-dashboard-drilldown/model/drilldownColumns.ts`), 배럴 re-export 제거, 테스트 동반 이동.
  - 교훈: server/client 경계·배럴 변경은 typecheck+test로 불충분 → `npm run build` 필수(memory `feedback_run_build_for_boundaries`). Phase 1 QA가 build를 안 돌려 잠복.
- [x] **Step 4:** Gate 1 종료 검증 — use-cache-in-client 에러 0, 빌드가 **Gate 2(prerender "Uncached data outside Suspense")로 전환**(masking 해소 실증). typecheck 0 / test 157·1188 green / lint 0.

### Task 3.1: 안전 도메인 page Suspense (💳 우선)
**Files:** `(site)/products/[id]/checkout`, `(site)/bookings/[id]{,/success,/failed}`, `(site)/reviews/new`, `(site)/login{,/error,/success,/verify}`, `(site)/compare`; 전역 차단원 `(site)/layout.tsx`

- [x] **Step 1:** 각 page의 `auth()`/`searchParams`/uncached db 읽기를 async `*Content` child로 추출 → `<Suspense fallback={skeleton}>`로 격리. 정적 셸(컨테이너·제목·아이콘)은 prerender. mypage는 기존 `loading.tsx`가 이미 경계 제공(무수정).
- [x] **Step 1.5 (전역 차단원):** `(site)/layout.tsx`의 `<WebVitalsReporter/>`(RUM, `usePathname()` 동적)가 **모든 (site) 페이지** prerender를 막던 것을 발견 → `<Suspense fallback={null}>`로 격리(GlobalRouteProgress 동형, ADR-0035 선례). 단일 수정이 checkout 등 다수 페이지 동시 해소.
- [x] **Step 2:** 결제·예약 상태가 prerender 셸에 baked 0임을 **실증** — `.next/server/app/{products/[id]/checkout,bookings/[id]/success,admin/bookings}.html` grep: skeleton(animate-pulse) present, session/booking/payment(`test_ck_`/`paymentKey`/`예약 ID`/`ADMIN`) **전부 ABSENT**. 라우트 표: 안전 page 16곳 `◐`(PPR=정적셸+per-request 스트리밍), route handler 10곳 `ƒ`(Dynamic), `○`는 home+not-found뿐.

### Task 3.2: admin page Suspense (16곳)
**Files:** `(admin)/admin/layout.tsx` (단일 수정으로 16 page 전부 커버)

- [x] **Step 1:** admin layout의 top-level `await auth()`가 16 admin route 전부의 prerender 차단원임을 발견 → 가드(auth+redirect)+nav+`{children}`을 단일 `AdminAuthedShell` async 컴포넌트에 모으고 `<Suspense fallback={AdminShellFallback}>`로 감쌈. children이 가드 통과 후 렌더되도록 순서 보존 + 16 page 동적 데이터가 이 단일 경계에 수렴 → **페이지별 Suspense 불요**(layout 1곳 수정으로 16 page 동시 green).
- [x] **Step 2:** 반복 빌드(7회)로 Gate 2 0까지 수렴 — 순서: admin layout → site 6 page → login 3 → `(site)` WebVitalsReporter(전역) → compare. **빌드 68/68 GREEN**(exit 0).
- [x] **Step 3:** 커밋 `feat(routing): suspense boundaries for dynamic routes (Phase 5-C/3 Gate 2)`.

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
