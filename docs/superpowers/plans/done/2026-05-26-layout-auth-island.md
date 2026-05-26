# 2026-05-26 — Layout Auth Island for PDP ISR (0018)

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:executing-plans`. 각 Task 의 모든 `- [ ]` 는 구현·검증 직후 그 자리에서 `- [x]` 로 갱신 (CLAUDE.md §4.1). **신규 plan 의 모든 체크박스는 `- [ ]` 로만 시작 (CLAUDE.md §4.2 — Pre-checking 금지).**

**Goal:** `(site)/layout.tsx` 의 `<UserNav>` (RSC + `auth()` cookies 의존) 을 **client island** 로 교체하여 layout 자체의 cookies 의존을 0으로 만들고, A6 의 verification checklist 마지막 미완료 1건인 **`/products/[id]` 의 build 출력 `●` (Static/ISR) 표기 승격**을 달성한다.

**Architecture:** Option B (`/api/auth/session` NextAuth 표준 + 신규 `/api/wishlist/count` 분리). `UserNavIsland` 가 mount 후 `Promise.all([session, count])` 로 2개 endpoint 를 단일 `AbortController` 로 묶어 fetch. CLS 0 보장 — skeleton dimensions 는 비로그인 "로그인" 버튼 dimensions 와 동일 (다수 트래픽 우선).

**Tech Stack:** Next.js 15 App Router (Route Handler, ISR), React 19 (`useEffect`, `useState`, `AbortController`), NextAuth v5 (표준 `/api/auth/session` 활용), Prisma 5, 표준 `fetch`.

---

## Context

- [ADR-0012] (A4 / pdp-isr) → A6 wishlist-island → 본 0018 작업 이 ISR 복귀 시리즈의 마지막 단계.
- A6 작업 후 `next build` 출력에서 `/products/[id]` 가 여전히 `ƒ` (Dynamic) 으로 분류되는 원인 분석 결과: `(site)/layout.tsx` 의 `<UserNav>` 가 `auth()` (cookies 의존) 호출 → PPR 미활성 상태에서 layout cookies 의존이 모든 자식 페이지를 dynamic 으로 끌어내림.
- 본 plan 은 [ADR-0017] (`useSearchParams` 내부 Suspense 박제) 의 후속 — layout 까지 PPR 없이 정적 prerender 가능하게 만든다.
- `UserNav` (RSC) 외부 사용처: **0개** (`grep` 결과 `layout.tsx` 한 곳). 교체 후 dead code 로 제거 가능.
- `LogoutButton` 은 React 19 form action + Server Action(`signOut`) 패턴 — client component 안에서도 `<form action={...}>` 으로 재사용 가능 (변경 없음).
- `SessionPoll` 이 이미 `fetch('/api/auth/session')` 클라이언트 페치 패턴을 사용 → 본 작업의 선례.

## Persona Activation

| 페르소나 | 발동 사유 |
|---|---|
| 🏛️ Architect | 신규 Route Handler 위치(`app/api/wishlist/count/`), `UserNavIsland` FSD 경계(features/auth), barrel 노출 정책, dead code 제거 |
| 🎨 Frontend Expert | `'use client'` 컴포넌트 신설 — `useEffect` + 단일 `AbortController` 로 묶은 `Promise.all` 2-fetch, hydration safe 초기 상태(skeleton), CLS 0 보장, cleanup 누락 0 |
| ⚙️ Backend Expert | Route Handler `auth()` 처리, 비로그인 `{count:0}` 응답 정책, `Cache-Control: private, no-store` (유저별 데이터 절대 캐싱 금지), env 직접 접근 0 |
| 🔬 QA Engineer | 보고 직전 자동 증거 — typecheck/test/lint + dev curl + **`next build` 출력에서 `/products/[id]` 가 `●` 표기로 승격되는지 확인** (본 작업의 핵심 검증) |

Domain Booking 비활성. NO-REAL-MONEY 무관 (auth + wishlist count read-only).

## Design Decisions

### 1. Route Handler — `GET /api/wishlist/count`

- Path: `src/app/api/wishlist/count/route.ts`. App Router Route Handler.
- 입력: 없음 (세션에서 userId 추출).
- 처리:
  - `auth()` 호출 → 세션 없음이면 `200 {count: 0}` (비로그인은 뱃지 미표시, UX 안전 디폴트).
  - 세션 있음 → `entities/wishlist` 의 `countMyWishlist(userId)` 재사용 → `200 {count: <number>}`.
- 응답 헤더: `Cache-Control: private, no-store`. 유저별 상태이므로 **CDN/브라우저 캐싱 금지**.
- 이유: `/api/wishlist/check` (A6) 와 동일 정책 — 유저별 read-only 데이터의 표준.

### 2. 신규 컴포넌트 — `UserNavIsland` (Client)

- Path: `src/features/auth/ui/UserNavIsland.tsx`.
- `'use client'`. Props: 없음 (페이지 위치 무관).
- 라이프사이클:
  - 초기 상태: `loading = true`, `user = null`, `wishlistCount = 0` (skeleton 렌더 — hydration-safe).
  - `useEffect` 에서 단일 `AbortController` + `Promise.all([fetch('/api/auth/session'), fetch('/api/wishlist/count')])`.
  - 양쪽 응답 모두 도착하면 `setState({ user, wishlistCount, loading: false })`.
  - Cleanup: `controller.abort()` — Frontend Expert R2-2 cleanup 누락 0.
- 분기:
  - `loading === true` → skeleton (`h-7 w-20` — 기존 `UserNavSkeleton` 과 동일 dimensions).
  - `user === null` → "로그인" 버튼 (`px-4 py-1.5` text-sm, 기존 마크업 그대로).
  - `user !== null` → 사용자명 + 마이페이지 (+ wishlistCount 뱃지) + 로그아웃 (`LogoutButton`).
- LogoutButton 재사용: React 19 form action + Server Action(`signOut`). client component 안에서도 그대로 동작 — 변경 없음.

### 3. `layout.tsx` 변경

- `import { UserNav, UserNavSkeleton } from "@/features/auth/ui/UserNav"` 제거, `import { Suspense }` 제거.
- `<Suspense fallback={<UserNavSkeleton />}><UserNav /></Suspense>` → `<UserNavIsland />` 한 줄로 교체.
- layout 본체가 cookies 의존 0 → 모든 자식 페이지(특히 `/products/[id]`) 정적 prerender 자격 회복.

### 4. CLS 0 보장 전략

- skeleton dimensions = 비로그인 "로그인" 버튼 dimensions (트래픽 다수 가정).
  - 기존 skeleton: `h-7 w-20` (28×80px).
  - 비로그인 버튼: `px-4 py-1.5 text-sm` (대략 28×60px).
  - skeleton 을 `h-7 w-[60px]` 정도로 정밀화하거나, 비로그인 컨테이너 자체를 동일 dimensions 로 설계.
- 로그인 사용자는 hydration 후 width 확장 1회 발생 — [ADR-0012] / [ADR-0017] island 깜빡임 정책과 동질의 본질 비용 (정적 prerender 의 트레이드오프).

### 5. dead `UserNav` RSC 제거

- `UserNav`, `UserNavSkeleton` 외부 사용처 0 확인 (사전 `grep` 검증 완료).
- 파일 자체 삭제 + barrel `features/auth/index.ts` 에서 export 라인 제거.
- 단, dev 환경에서 의도적 디버깅용으로 import 하는 곳이 있는지 Task 5 의 자동 grep 으로 재검증.

### 6. NO-REAL-MONEY 무관

- 본 변경은 auth/wishlist 조회만 영향. 결제·예약·상태머신 무영향.

## Files Touched

| 작업 | 파일 | 종류 |
|---|---|---|
| 신규 | `src/app/api/wishlist/count/route.ts` | Route Handler `GET` |
| 신규 | `src/app/api/wishlist/count/__tests__/route.test.ts` | Route Handler 단위 테스트 |
| 신규 | `src/features/auth/ui/UserNavIsland.tsx` | Client island |
| 신규 | `src/features/auth/ui/__tests__/UserNavIsland.test.tsx` | Client island 단위 테스트 |
| 수정 | `src/features/auth/index.ts` | barrel — `UserNavIsland` 추가, `UserNav` / `UserNavSkeleton` 제거 |
| 수정 | `src/app/(site)/layout.tsx` | `UserNav` → `UserNavIsland` |
| 삭제 | `src/features/auth/ui/UserNav.tsx` | 사용처 0 — dead code |

---

## Tasks

> **TDD 원칙 (CLAUDE.md §4 / QA Engineer R5):** 순수 함수·서버 헬퍼·Route Handler 는 **테스트 먼저 작성 → FAIL 확인 → 구현 → PASS 확인**. 클라이언트 컴포넌트는 happy-dom + `createRoot` + `act` 패턴으로 fetch mocking + cleanup 검증.

### Task 1 — Route Handler `/api/wishlist/count` (TDD)

**Files:**
- Create: `src/app/api/wishlist/count/__tests__/route.test.ts`
- Create: `src/app/api/wishlist/count/route.ts`

- [x] **Step 1 (RED): 테스트 먼저 작성** — 4 케이스
  - (a) 비로그인 (auth → null) → 200 `{count: 0}`, `countMyWishlist` 미호출
  - (b) 세션은 있으나 user.id 없음 → 200 `{count: 0}`
  - (c) 로그인 + 찜 N개 → 200 `{count: N}`, `countMyWishlist(userId)` 정확 호출
  - (d) Cache-Control 헤더 `private, no-store` (비로그인/로그인 모두)
  - `auth` / `countMyWishlist` 는 `vi.hoisted` + `vi.mock` 으로 격리

- [x] **Step 2: 테스트 FAIL 확인** — `npm run test -- src/app/api/wishlist/count` → RED

- [x] **Step 3 (GREEN): Route Handler 구현**

- [x] **Step 4: 테스트 PASS 확인** — GREEN (6/6)

- [x] **Step 5: Backend Expert 자가 점검**
  - ✅ env 직접 접근 0
  - ✅ N+1 없음 (단일 db.wishlist.count via countMyWishlist)
  - ✅ Cache-Control private, no-store (유저별 데이터)
  - ✅ NO-REAL-MONEY 무관

---

### Task 2 — `UserNavIsland` 클라이언트 컴포넌트 (TDD)

**Files:**
- Create: `src/features/auth/ui/__tests__/UserNavIsland.test.tsx`
- Create: `src/features/auth/ui/UserNavIsland.tsx`

- [x] **Step 1 (RED): 테스트 먼저 작성** — happy-dom 환경
  - (a) mount 시 `/api/auth/session` + `/api/wishlist/count` 두 endpoint 를 정확히 1회씩 호출 (Promise.all 병렬)
  - (b) 두 응답 모두 도착 후 비로그인(`session: null`) → "로그인" 링크 렌더
  - (c) 두 응답 도착 후 로그인(`session.user.id` 있음, count > 0) → 사용자명 + 마이페이지 + 뱃지 + 로그아웃 form 렌더
  - (d) 로그인 + count === 0 → 뱃지 미표시
  - (e) unmount 시 단일 `AbortController.abort()` 1회 호출 (in-flight 2 fetch 모두 취소)
  - (f) 초기 로딩 상태(skeleton) 의 dimensions = `h-7 w-20` 또는 합의된 dimensions

- [x] **Step 2: 테스트 FAIL 확인** — `npm run test -- UserNavIsland` → RED

- [x] **Step 3 (GREEN): 컴포넌트 구현**

- [x] **Step 4: 테스트 PASS 확인** — GREEN (6/6)

- [x] **Step 5: Frontend Expert 자가 점검**
  - ✅ 단일 `AbortController.abort()` cleanup 으로 2-fetch 모두 in-flight 누수 0
  - ✅ Hydration safe (서버는 island skeleton 만 prerender, 클라가 동일 마크업으로 hydrate)
  - ✅ `Promise.all` 로 2-fetch 병렬 — 워터폴 0
  - ✅ AbortError 분기 catch — silent ignore
  - ✅ skeleton dimensions = 비로그인 버튼 dimensions (CLS 0)

---

### Task 3 — Barrel 노출

**Files:**
- Modify: `src/features/auth/index.ts`

- [x] **Step 1: barrel 에 `UserNavIsland` 추가**
  - `export { UserNavIsland } from "./ui/UserNavIsland";` 추가
  - `UserNav` / `UserNavSkeleton` 라인 제거 (Task 5 에서 파일 자체 삭제 예정 — 미리 제거)

- [x] **Step 2: Architect 자가 점검** — ✅ 공개 API 만 노출, 깊은 경로 import 유도 0

---

### Task 4 — `layout.tsx` 교체

**Files:**
- Modify: `src/app/(site)/layout.tsx`

- [x] **Step 1: import 교체 + Suspense 제거**
  - `import { Suspense } from "react"` 제거
  - `import { UserNav, UserNavSkeleton } from "@/features/auth/ui/UserNav"` 제거
  - `import { UserNavIsland } from "@/features/auth"` 추가 (barrel 경유)
  - JSX: `<Suspense fallback={<UserNavSkeleton />}><UserNav /></Suspense>` → `<UserNavIsland />`
  - 코멘트 갱신: "cookies 의존 auth() 호출은 UserNavIsland 의 client-fetch 로 격리. layout 본체는 cookies 의존 0 → 모든 자식 페이지 정적 prerender 자격."

- [x] **Step 2: Architect 자가 점검**
  - ✅ FSD 단방향 유지 (app → features)
  - ✅ layout cookies 의존 0 (auth/cookies/headers import 0)
  - ✅ `'use client'` 선언 없음 (layout 은 RSC 유지)

---

### Task 5 — dead `UserNav` RSC 제거

**Files:**
- Delete: `src/features/auth/ui/UserNav.tsx`

- [x] **Step 1: 사용처 재확인**
  - `grep -rn "UserNav\b" src --include="*.ts" --include="*.tsx" | grep -v UserNavIsland | grep -v UserNavSkeleton`
  - 결과: UserNav.tsx 본체 + `entities/wishlist/api/queries.ts:61` 의 outdated 주석 1건. 후자도 island 패턴 반영해 갱신.

- [x] **Step 2: 파일 삭제**
  - `rm src/features/auth/ui/UserNav.tsx`

- [x] **Step 3: Architect 자가 점검**
  - ✅ dead code 0
  - ✅ barrel 정합성 (Task 3 에서 제거된 export 가 실제 파일 부재와 일치)

---

### Task 6 — 정적·동적 검증 (본 plan 의 핵심 검증)

- [x] **Step 1: `npm run typecheck`** → exit 0

- [x] **Step 2: `npm run test`** → 전체 GREEN (504/504, 신규 12 케이스 합산), 회귀 0건

- [x] **Step 3: `npx next lint` 변경 영역** → 0 warning (초기 `_req` 미사용 1건은 매개변수 자체 제거로 해소)
  ```bash
  npx next lint \
    --file src/app/api/wishlist/count \
    --file src/features/auth \
    --file 'src/app/(site)/layout.tsx'
  ```

- [x] **Step 4: dev 런타임 smoke** — 4건 통과:
  - `/api/wishlist/count` 비로그인 → `{"count":0}`
  - `Cache-Control: private, no-store`
  - `/api/auth/session` 비로그인 → `null`
  - 홈 HTML `aria-hidden="true"` 1건 (skeleton SSR 노출)
  - 부수 발견: `LogoutButton` 의 inline `"use server"` 가 client component import 컨텍스트에서 차단됨 → `signOutAction` 을 module-level Server Action 으로 분리, `LogoutButton.tsx` 가 그것을 form action 으로 dispatch 하도록 수정.
  ```bash
  npm run dev > /tmp/dev.log 2>&1 &
  until curl -s -o /dev/null http://localhost:3000/; do sleep 2; done

  # (a) /api/wishlist/count 비로그인 → {count: 0}
  curl -s http://localhost:3000/api/wishlist/count | jq .
  # Expected: {"count": 0}

  # (b) Cache-Control: private, no-store
  curl -sI http://localhost:3000/api/wishlist/count | grep -i cache-control
  # Expected: cache-control: private, no-store

  # (c) /api/auth/session 비로그인 → {} 또는 null
  curl -s http://localhost:3000/api/auth/session | jq .

  # (d) 홈 HTML 에 island skeleton 마크업 존재 (UserNavIsland 가 mount 전 상태로 prerender)
  curl -s http://localhost:3000/ | grep -c 'aria-hidden="true"'
  # Expected: >= 1 (skeleton 렌더링됨)
  ```

- [x] **Step 5: ISR 활성 증거 — `next build` 출력에서 `/products/[id]` 가 `●` 또는 `○` 으로 표기되는지 확인** (이전엔 `ƒ` 였음)
  - 1차 build (layout auth island 적용 후): 홈 `/` 가 `○ (Static)` 으로 승격됐으나 `/products/[id]` 는 여전히 `ƒ`. 원인: dynamic route `[id]` + `generateStaticParams` 부재 → Next 가 build time 에 prerender 할 ID 를 모름.
  - 추가 변경 (plan 범위 내 자연스러운 확장): `entities/product/api/queries.ts` 에 `getAllPublishedProductIds()` helper 추가 + barrel 노출 + PDP page.tsx 에 `export async function generateStaticParams()` 도입.
  - 2차 build: **`● /products/[id]    Revalidate 1h Expire 1y` + 9개 PUBLISHED 상품 모두 build time prerender 완료**. `dynamicParams = true` (default) 이므로 신규 등록 상품은 첫 요청 시 ISR-on-demand.

- [x] **Step 6: dev 서버 종료**
  ```bash
  pkill -f "next dev" || true
  ```

---

### Task 7 — A6 잔여 체크박스 해소 + ADR-0018 박제 + done/ 이동

- [x] **Step 1:** A6 plan(`2026-05-26-wishlist-island.md`) 의 verification checklist 마지막 `[ ]` 항목 (`next build` `●` 표기) 을 `[x]` 로 갱신.
- [x] **Step 2:** ADR-0018 작성 (`docs/superpowers/adr/0018-layout-auth-client-island.md`) — `generateStaticParams` 도입 결정도 ADR 의 Decision 섹션 B 로 박제.
- [x] **Step 3:** `docs/superpowers/adr/README.md` 인덱스에 0018 추가, 향후 후보에서 0018(가칭) 제거.
- [x] **Step 4:** `git mv` 로 A6 + 0018 두 plan 파일 모두 `docs/superpowers/plans/done/` 으로 이동.
- [x] **Step 5:** 본 plan 의 모든 `- [ ]` 가 `- [x]` 로 갱신됐는지 grep 으로 재확인.
- [x] **Step 6:** 보고 양식 §7.1 준수 (🏗️ / ♻️ / 🧠) + `※ recap:` 한국어 한 줄.

---

## Verification Checklist (최종)

- [x] `(site)/layout.tsx` 가 `auth` / `cookies` / `headers` import·호출 모두 미사용
- [x] `(site)/layout.tsx` 가 `Suspense` import 도 제거 (island 내부 self-managed)
- [x] `/api/wishlist/count` 가 비로그인 → `{count:0}`, 로그인 → 실제 count
- [x] 응답 헤더 `Cache-Control: private, no-store`
- [x] `UserNavIsland` 가 mount 후 `Promise.all` 2-fetch, unmount 시 단일 `AbortController.abort()` 호출
- [x] dead `UserNav` RSC 파일 삭제 + barrel 정리 (`UserNav` / `UserNavSkeleton` export 0)
- [x] **`next build` 출력에서 `/products/[id]` 가 `●` (SSG with ISR) 표기** ← 본 plan 의 핵심 검증 (+ 9개 PUBLISHED 상품 build time prerender)
- [x] typecheck / test / lint 그린, 회귀 0건 (504/504)
- [x] CLS 0 (skeleton dimensions = 비로그인 "로그인" 버튼 dimensions)
- [x] A6 잔여 checklist 1건 `[x]` 처리, ADR-0018 박제, A6 + 0018 plan 모두 `done/` 이동

## Out of Scope

- **PPR (Partial Prerendering) opt-in**: [ADR-0012] / [ADR-0017] 에서 이미 거부. NO-REAL-MONEY 안정성 + experimental 부담.
- **`SessionPoll` 변경**: 이미 client-fetch 패턴이라 본 작업과 동일 노선이고 별도 변경 불필요.
- **`LogoutButton` 변경**: Server Action(`signOut`) 재사용 — React 19 form action 패턴은 client component 안에서도 동작.
- **다른 layout 의 `auth()` 사용**: 본 작업은 `(site)/layout.tsx` 한정. admin/auth layout 은 별도 결정.
- **NextAuth `<SessionProvider>` 도입**: 옵션 A 거부 — provider tree pollution + 외부 패키지 의존.

## ADR Candidate

본 plan 의 핵심 결정 (UserNav RSC + `auth()` → client island + `/api/auth/session` + `/api/wishlist/count` 분리) 는 ADR 박제 가치 후보. Task 7 에서 ADR-0018 작성 예정.
