# GA4 + GTM 분석 파이프라인 Implementation Plan

> **For agentic workers (Claude Code / Cursor 공통):** 이 문서는 자기완결형이다. 작업 시작 전 아래 "0. 핸드오프 규칙"을 반드시 읽을 것. Steps use checkbox (`- [ ]`) syntax for tracking. Task 완료 즉시 해당 Task의 체크박스를 이 파일에 직접 `- [x]`로 갱신한다(나중에 몰아서 처리 금지 — CLAUDE.md §4.1).

**Goal:** Nextour 공개 사이트(`(site)` 셸)에 GTM을 설치하고 GTM 안에서 GA4를 연결한다. GA4 표준 전자상거래 퍼널(`view_item_list → view_item → add_to_wishlist → begin_checkout → add_payment_info → purchase`)과 `refund`를 수집한다. `purchase`·`refund`는 광고차단기 유실이 없도록 **서버 사이드(GA4 Measurement Protocol) + 트랜잭셔널 아웃박스**로 전송한다.

**Architecture (3줄):**
1. **클라이언트 퍼널 이벤트**: GTM(dataLayer) → GA4. 이벤트 스키마 SSOT는 `shared/lib/analytics`(client-safe 순수 모듈)에 두고, RSC 페이지는 `features/analytics`의 `<TrackEvent>` client island에 직렬화 가능한 payload만 넘긴다. 페이지를 `'use client'`로 바꾸지 않으므로 ISR/PPR 무손상.
2. **서버 매출 이벤트**: `purchase`(booking PAID 전이)와 `refund`(RefundJob settle)는 기존 EmailJob과 같은 **트랜잭셔널 아웃박스 패턴**으로 `AnalyticsJob`을 같은 Tx에 적재한다. cron dispatcher 워커가 GA4 MP로 발송한다(외부 IO는 Tx 밖, ADR-0003 원칙).
3. **CSP**: 정적 경로(`'self' 'unsafe-inline'`)와 동적 경로(`nonce + 'strict-dynamic'`)에서 모두 GTM/GA4 도메인을 허용하도록 `buildCspHeader`를 확장한다. `CSP_MODE=enforce` 실측을 게이트로 둔다.

**Tech Stack:** Next.js 16.2 (App Router, Cache Components), React 19.2, `@next/third-parties`, Prisma 5, Zod 3, Vitest 2, Playwright.

**브랜치:** `feat/ga4-gtm-analytics` (main에서 분기)

**페르소나 (CLAUDE.md §3):**
- 🏛️ Architect: 전 Task
- 🎨 Frontend: Task 3·5·6
- ⚙️ Backend: Task 2·8~12
- 💳 Domain Booking: Task 9·11 (checkout action과 결제/환불 Tx에 한 줄씩 추가)
- 🔬 QA: 각 Task 완료 시 + Task 15

---

## 0. 핸드오프 규칙 (Cursor 등 다른 에이전트가 이어받을 때 필독)

1. **먼저 읽을 것:** `CLAUDE.md` 전체(특히 §4.1·§4.2 체크박스 규칙, §5 절대 규칙, §7.1 보고 양식). 그다음 `docs/superpowers/skills/`의 `architect.md`, `frontend-expert.md`, `backend-expert.md`, `qa-engineer.md`, `domain-booking.md`.
2. **진행 위치 파악:** `grep -n "\- \[ \]" docs/superpowers/plans/2026-10-14-ga4-gtm-analytics.md`를 실행해 처음으로 미체크인 Task부터 재개한다. 체크된 Task는 다시 하지 않는다. 단, 직전 Task의 커밋이 실제로 있는지는 `git log --oneline -15`로 검증한다.
3. **커밋:** 영문 Conventional Commits(`feat(analytics): ...`). Task 단위 커밋. `--no-verify`, force push, `git reset --hard`는 금지.
4. **결제·예약 도메인 경계:** Task 9·11에서 결제/환불 코드에는 **아웃박스 enqueue 호출 한 줄과 gaClientId 캡처**만 추가한다. 금액 계산·상태 전이·좌석 로직은 0줄 변경이다. 실거래(live 키)는 절대 금지(§5 NO-REAL-MONEY).
5. **금지 패턴 재확인:**
   - client에서 쓰는 `shared` 모듈은 `@/shared/lib/env` import 금지 → `process.env.NEXT_PUBLIC_*` 직접 접근 (CLAUDE.md §8 photoMime 사고)
   - client 컴포넌트는 `@/entities/product`·`@/entities/departure` 배럴 value import 금지 (빌드 깨짐, `use cache` 누출)
   - 깊은 경로 import 금지 → 슬라이스 `index.ts` 배럴 경유 (ADR-0061, lint가 차단)
   - `any`, `@ts-ignore` 금지. 금액은 정수(원)만 사용
6. **dev 서버 가동 중 `npm run build` 금지** (`.next` 충돌로 CSS 404 발생). 빌드 검증은 dev를 끄고 하거나, `cp -Rc`로 node_modules를 APFS 클론한 별도 워크트리에서 한다.
7. **보고:** 한국어, CLAUDE.md §7.1 3섹션 포맷(Core Architecture / Boilerplate / Concept Insight) + QA 증거 인용.

---

## File Structure

**신규**
- `src/shared/lib/analytics/` — client-safe 순수 모듈 (env import 금지)
  - `events.ts`: GA4 이벤트 타입 + `toGa4Item()` 등 순수 빌더
  - `track.ts`: `trackEvent()` (window.dataLayer push)
  - `gaClientId.ts`: `_ga` 쿠키 → client_id 파싱(순수)
  - `index.ts`
  - `__tests__/`
- `src/shared/lib/analytics-job/` — server 전용 (`import "server-only"`)
  - `enqueue.ts`, `mp.ts`(Measurement Protocol 클라이언트), `worker.ts`, `index.ts`, `__tests__/`
- `src/entities/booking/model/analyticsPolicy.ts` (+ test) — 전이 → AnalyticsJob 매핑(순수, `emailPolicy.ts` 동형)
- ~~`src/features/analytics/`~~ → **`src/shared/ui/TrackEvent.tsx`** (Task 6에서 이관: features/checkout 이 렌더해야 하는데 features 간 cross-slice import 는 FSD 금지. 도메인 무지 컴포넌트라 shared 가 맞음)
- `src/entities/product/model/analytics.ts` — `toGa4ItemInput()` (상품→GA4 item 입력, 배럴 export)
- `src/features/checkout/model/analytics.ts` — `buildPaxItems()` (인원 유형별 item + `item_variant`)
- `scripts/analytics/mp-validate.ts` — GA4 MP debug 엔드포인트 검증 스크립트
- `tests/e2e/analytics.spec.ts`
- `prisma/migrations/<timestamp>_analytics_job/migration.sql`
- `docs/superpowers/adr/0062-ga4-gtm-hybrid-analytics-outbox.md`

**수정**
- `src/shared/lib/env.ts` — `NEXT_PUBLIC_GTM_ID`, `GA4_MEASUREMENT_ID`, `GA4_API_SECRET`
- `src/shared/lib/security/csp.ts` (+ `__tests__/csp.test.ts`, `csp-fixtures.test.ts`)
- `src/app/(site)/layout.tsx` — GTM 삽입
- `src/app/(site)/products/page.tsx`, `src/app/(site)/search/page.tsx`, `src/app/(site)/products/[id]/page.tsx`, `src/app/(site)/products/[id]/checkout/page.tsx`
- `src/features/search/ui/SearchBox.tsx`, `src/features/wishlist/ui/WishlistHeartIsland.tsx`, `src/features/checkout/ui/CheckoutForm.tsx`, `src/features/checkout/server/actions.ts`
- `prisma/schema.prisma` — `Booking.gaClientId`, `AnalyticsJob` 모델
- `src/entities/booking/api/mutations.ts` (`transitionStatusTx`)
- `src/entities/payment/api/refund.ts`, `src/entities/payment/api/refundRetry.ts` (settle Tx)
- `src/app/api/cron/dispatcher/route.ts`
- `.env.example`, `docs/superpowers/adr/README.md`, `CLAUDE.md` §8

---

## Task 0: 사전 준비 (사용자 수동 — Google 콘솔 작업, 코드 아님)

> 에이전트가 자동화할 수 없는 유일한 구간이다. 값이 준비되기 전에도 Task 1~6은 진행할 수 있다(ID 미설정 시 no-op으로 설계했기 때문).

- [x] **Step 1: GA4 속성 생성** — analytics.google.com → 관리 → 속성 만들기 (통화 **KRW**, 시간대 Asia/Seoul) → 웹 데이터 스트림 추가 → **측정 ID(`G-XXXXXXX`)** 확보
  - 권장: 개발/스테이징용 속성을 별도로 만든다(테스트 결제 데이터가 운영 리포트를 오염시키지 않게).
- [x] **Step 2: 향상된 측정 설정** — 데이터 스트림 → 향상된 측정 → "페이지 조회 → 브라우저 기록 이벤트 기반 페이지 변경" **ON** (App Router의 SPA 이동을 page_view로 잡기 위해 필요)
- [x] **Step 3: MP API Secret 발급** — 데이터 스트림 → Measurement Protocol API secrets → 생성 → **api_secret** 확보 (서버 전용, 절대 클라이언트로 노출 금지)
- [x] **Step 4: GTM 컨테이너 생성** — tagmanager.google.com → 컨테이너(웹) → **컨테이너 ID(`GTM-XXXXXXX`)** 확보
- [x] **Step 5: `.env`에 값 기입** (커밋 금지)
  ```
  NEXT_PUBLIC_GTM_ID=GTM-XXXXXXX
  GA4_MEASUREMENT_ID=G-XXXXXXX
  GA4_API_SECRET=xxxxxxxx
  ```
  Vercel에는 3개 모두 **Production 환경에만** 등록한다(`GA4_API_SECRET`은 Sensitive). Preview는 의도적 제외 — Vercel Preview도 `NODE_ENV=production`이라 키가 있으면 프리뷰 배포의 테스트 결제가 MP로 실제 GA4에 적재되어 리포트를 오염시킨다. `NEXT_PUBLIC_*`는 빌드 타임 인라인이므로 등록 후 **재배포 필요**.

---

## Task 1: env 스키마 + 의존성

**Files:** `src/shared/lib/env.ts`, `src/shared/lib/__tests__/env*.test.ts`(기존 env 테스트 위치 확인 후 추가), `.env.example`, `package.json`

- [x] **Step 1: 테스트 먼저 작성** — `envSchema.safeParse`로 다음을 검증한다:
  - 3개 변수 모두 미설정이어도 통과 (optional)
  - `NEXT_PUBLIC_GTM_ID`는 `/^GTM-[A-Z0-9]+$/`, `GA4_MEASUREMENT_ID`는 `/^G-[A-Z0-9]+$/` 포맷
  - `GA4_MEASUREMENT_ID`와 `GA4_API_SECRET`은 **페어**: 하나만 있으면 실패 (기존 Google OAuth 페어 superRefine 패턴과 동형)
  - 빈 문자열(`""`)은 미설정으로 간주 (`SENTRY_DSN`과 같은 preprocess 패턴)
- [x] **Step 2: FAIL 확인** — `npx vitest run <env test 파일>`
- [x] **Step 3: 구현** — `env.ts`에 3개 필드와 페어 superRefine을 추가한다. 주석에 "GA4_API_SECRET은 서버 전용, NEXT_PUBLIC_ 접두사 금지"를 명시한다.
- [x] **Step 4: PASS 확인** — 같은 명령으로 확인
- [x] **Step 5: 의존성 설치** — `npm i @next/third-parties@<설치된 next와 동일 메이저.마이너>` (`npm ls next`로 버전 확인 후 맞춘다)
- [x] **Step 6: `.env.example`에 3개 키 추가** (값은 비움, 주석으로 Task 0 참조)
- [x] **Step 7: 검증 + 커밋** — `npm run typecheck && npm run test` 그린 확인 후 `feat(analytics): add GTM/GA4 env schema and third-parties dep`

---

## Task 2: CSP 확장 (TDD)

**Files:** `src/shared/lib/security/csp.ts`, `src/shared/lib/security/__tests__/csp.test.ts`, `csp-fixtures.test.ts`

허용할 도메인:

| 지시어 | 추가 값 | 이유 |
|---|---|---|
| `script-src` (static·dynamic 모두) | `https://www.googletagmanager.com` | gtm.js와 GTM이 로드하는 gtag.js. dynamic 모드에서는 CSP3 브라우저가 host를 무시하고 strict-dynamic 전파로 허용하지만, CSP2 폴백용으로 같이 둔다 |
| `connect-src` | `https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com` | GA4 수집 엔드포인트(region1 등 포함) |
| `img-src` | `https://*.google-analytics.com https://*.googletagmanager.com` | 픽셀 폴백 |

- [x] **Step 1: 테스트 먼저 작성** — static/dynamic 양쪽 모드에서 위 도메인이 각 지시어에 포함되는지 단언한다. 기존 Toss·Sentry·Supabase 도메인이 그대로 남아 있는지 회귀 단언도 추가한다. `frame-ancestors 'none'`, `object-src 'none'`이 불변인지도 단언한다.
- [x] **Step 2: FAIL 확인** — `npx vitest run src/shared/lib/security`
- [x] **Step 3: 구현** — 도메인 문자열을 `GOOGLE_ANALYTICS_SOURCES` 같은 상수로 모으고 주석에 ADR-0062를 참조한다. 기존 주석 스타일을 유지한다.
- [x] **Step 4: PASS 확인 + fixtures 테스트 갱신** (스냅샷이면 diff를 확인한 뒤 갱신)
- [x] **Step 5: 커밋** — `feat(security): allow GTM/GA4 origins in CSP`

---

## Task 3: GTM 설치 + CSP enforce 실측 게이트

**Files:** `src/app/(site)/layout.tsx`

- [x] **Step 1: 설치** — `(site)/layout.tsx`에 다음을 추가한다:
  ```tsx
  import { GoogleTagManager } from "@next/third-parties/google";
  import { env } from "@/shared/lib/env";
  // ...
  {env.NEXT_PUBLIC_GTM_ID ? <GoogleTagManager gtmId={env.NEXT_PUBLIC_GTM_ID} /> : null}
  ```
  - **root `app/layout.tsx`가 아니라 `(site)`에 넣는 이유:** `(admin)` 셸 트래픽이 GA4 데이터에 섞이지 않게 하기 위함. 주석으로 남긴다.
  - layout 본체는 `headers()`/`cookies()`를 읽으면 안 된다. 읽으면 홈 `○`과 PDP `◐`가 dynamic으로 강등된다.
- [x] **Step 2: dev 동작 확인** — `npm run dev`로 홈을 연 뒤 Playwright(또는 Chrome MCP)로 다음을 확인한다:
  - `window.dataLayer`가 존재하고 `gtm.js` 요청이 200인지
  - `/admin/*`에서는 `gtm.js` 요청이 0건인지
- [x] **Step 3: ⚠️ CSP enforce 실측 게이트 (가장 중요)** — 현재 CSP는 기본이 report-only라 차단이 드러나지 않는다. `CSP_MODE=enforce`로 dev를 띄운 뒤 다음 3개 경로에서 콘솔의 CSP violation이 0건이고 `gtm.js`가 로드되는지 확인한다:
  1. `/` (static 모드)
  2. `/products/<id>` (static 모드, ISR)
  3. `/products/<id>/checkout` (dynamic 모드, nonce + strict-dynamic)
  - **예상:** `@next/third-parties`는 `next/script`(afterInteractive)로 **JS가 동적 삽입**하므로, strict-dynamic 하에서도 신뢰된 Next 런타임이 삽입한 스크립트로 전파되어 허용될 것이다.
  - **실패 시 대안 B:** middleware에서 `requestHeaders.set("Content-Security-Policy", csp.value)`를 dynamic 경로에 추가한다. Next가 요청 헤더의 nonce를 읽어 자체 스크립트에 자동으로 nonce를 부여하는 공식 패턴이다. 그 후 같은 3개 경로를 재검증한다.
  - 결과(어느 경로에서 무엇이 됐는지)를 이 Step 아래에 한 줄로 기록한다 → ADR-0062 근거로 사용
  - **실측 결과 (2026-10-14, Playwright, `CSP_MODE=enforce`):** `/`(enforce/static)·`/products/<id>`(enforce/static)·`/products/<id>/checkout`(enforce/dynamic, strict-dynamic) 3경로 모두 `gtm.js` 200 + `window.google_tag_manager` 로드 + dataLayer `gtm.js/gtm.dom/gtm.load` + **CSP violation 0건** → **대안 B 불필요**(next/script 동적 삽입이 strict-dynamic 신뢰 전파로 통과). `/admin/dashboard`(ADMIN 세션) gtm 요청 0건·`dataLayer` 부재 확인.
- [x] **Step 4: 빌드 검증** — dev를 끈 상태(또는 클론 워크트리)에서 `npm run build`를 실행한다. 출력에서 **홈 `○`, PDP `◐` 유지, 신규 `ƒ` 0건**을 확인한다.
- [x] **Step 5: 커밋** — `feat(analytics): load GTM in public site shell`

---

## Task 4: 이벤트 스키마 SSOT — `shared/lib/analytics` (TDD)

**Files:** `src/shared/lib/analytics/{events,track,gaClientId,index}.ts`, `__tests__/`

**규칙:** 이 모듈은 client island가 import한다 → `@/shared/lib/env`, `@/shared/lib/db`, `server-only`, entities import는 **모두 금지**. 입력은 plain 객체만 받는다.

- [x] **Step 1: 테스트 먼저 작성**
  - `toGa4Item({ productId, title, destination, unitPrice, quantity })` → `{ item_id, item_name, item_category, price, quantity }`
    - `item_category`는 destination `"도시, 국가"`에서 국가 suffix를 뽑는다(`오사카, 일본` → `일본`). 기존 `regionOf` 로직이 `widgets` 레이어에 있으므로 shared에서 import하지 않고 같은 규칙을 순수 함수로 재구현한다. 주석에 SSOT 위치를 명시한다.
    - `price`는 정수(원) 단언. 소수가 입력되면 throw
  - 이벤트 빌더: `buildViewItemList`, `buildViewItem`, `buildSearch`, `buildAddToWishlist`, `buildBeginCheckout`, `buildAddPaymentInfo` → `{ event, ecommerce: { currency: "KRW", value, items } }` 형태
    - `value === Σ price×quantity` 불변식 (※ 구현 노트: GA4 스펙상 `view_item_list` 는 value/currency 를 받지 않아 `item_list_name`+`index` 만 담는다. `add_payment_info` 의 value 는 서버 재계산 금액 우선)
    - 입력 배열을 변이하지 않음(§5 공통)
  - `trackEvent(payload)`:
    - `window.dataLayer`가 없으면 생성 후 push
    - ecommerce 이벤트는 직전에 `{ ecommerce: null }`을 push (GA4 공식 권장 — 이전 ecommerce 객체 잔존 방지)
    - SSR(`typeof window === "undefined"`)에서는 no-op
  - `parseGaClientId("GA1.1.123456789.1700000000")` → `"123456789.1700000000"`. 형식이 다르거나 undefined이면 `null`
  - **PII 가드:** 빌더 입력 타입에 email/name/phone 필드가 존재하지 않음(타입 레벨). 테스트에 그 의도를 주석으로 남긴다
- [x] **Step 2: FAIL 확인** — `npx vitest run src/shared/lib/analytics`
- [x] **Step 3: 구현** (index.ts는 named export만, `export *` 금지)
- [x] **Step 4: PASS 확인** — 같은 명령
- [x] **Step 5: 커밋** — `feat(analytics): add GA4 ecommerce event schema SSOT`

---

## Task 5: `<TrackEvent>` client island

**Files:** `src/features/analytics/ui/TrackEvent.tsx`, `src/features/analytics/index.ts`, 테스트

- [x] **Step 1: 테스트 먼저 작성** (jsdom, `@testing-library/react`)
  - mount 시 `trackEvent`가 1회 호출된다
  - StrictMode 이중 effect에서도 1회만 호출된다 (`useRef` 가드 — `ConfirmPayment.tsx`의 `calledRef` 패턴)
  - 같은 payload로 리렌더해도 재호출되지 않는다. `dedupeKey` prop이 바뀌면(예: 다른 상품 PDP로 client 이동) 재호출된다
- [x] **Step 2: FAIL 확인**
- [x] **Step 3: 구현**
  ```tsx
  "use client";
  // props: { payload: Ga4EventPayload; dedupeKey: string } — 직렬화 가능한 값만
  // useEffect(() => { if (firedKey.current === dedupeKey) return; firedKey.current = dedupeKey; trackEvent(payload); }, [dedupeKey, payload]);
  // return null;
  ```
  - react-hooks@7 규칙(`refs`, `set-state-in-effect`)을 위반하지 않는지 lint로 확인한다
- [x] **Step 4: PASS + `npm run lint` 0 errors**
- [x] **Step 5: 커밋** — `feat(analytics): add TrackEvent client island`

---

## Task 6: 클라이언트 퍼널 이벤트 배선

> 서버 페이지는 `@/shared/lib/analytics`의 빌더로 payload를 만들고 `<TrackEvent>`에 넘긴다. 데이터 조회는 페이지가 이미 하고 있는 것을 재사용한다(**추가 DB 쿼리 0**).

| 이벤트 | 위치 | 비고 |
|---|---|---|
| `view_item_list` | `(site)/products/page.tsx`, `(site)/search/page.tsx` | 이미 렌더하는 상품 배열로 생성. Suspense 안의 결과 컴포넌트에 둔다. `item_list_name`: `"products"` / `"search"` |
| `search` | ~~SearchBox submit~~ → **`search/page.tsx`의 `SearchResults`** | 구현 변경: 칩 클릭·URL 직접 진입까지 "결과를 본 검색"을 단일 지점에서 수집. SearchBox 무변경 |
| `view_item` | `(site)/products/[id]/page.tsx` | `dedupeKey=productId`. PDP `◐` 1h 캐시 유지 — payload는 캐시된 상품 데이터에서 생성 |
| `add_to_wishlist` | `WishlistHeartIsland`(PDP) + `WishlistHeartButton`(목록 카드) — `analyticsItem` prop 옵트인, 위젯(서버)이 주입. 마이페이지 `WishlistGrid`는 해제 전용이라 제외 | **추가 성공 시에만** (해제·실패 시 없음). 상품 정보는 island가 이미 받는 prop을 쓰고, 부족하면 서버 부모가 prop으로 주입(entities 배럴 import 금지) |
| `begin_checkout` | `(site)/products/[id]/checkout/page.tsx`의 `CheckoutContent` | 인증 가드 **통과 후**에 렌더. 인원 미정이면 quantity=1·성인가 기준 |
| `add_payment_info` | `features/checkout/ui/CheckoutForm.tsx` | `createCheckoutBooking` 성공(type=success) 후 토스 결제창 호출 직전. `value`=서버가 반환한 `amount` |
| ~~`purchase`~~ | **클라이언트에서 보내지 않음** | 서버 MP 단일 경로(Task 8~12). 이중 집계 방지 — ADR-0062 |

- [x] **Step 1: `view_item_list` + `search`** 배선
- [x] **Step 2: `view_item`** 배선
- [x] **Step 3: `add_to_wishlist`** 배선 (기존 wishlist 테스트 green 유지)
- [x] **Step 4: `begin_checkout` + `add_payment_info`** 배선 (기존 checkout 테스트 green 유지)
- [x] **Step 5: 검증** — dev에서 각 화면 이동 후 `window.dataLayer`를 덤프해 이벤트 6종의 payload를 확인한다(Playwright/Chrome MCP로 직접 확인, 사용자에게 떠넘기지 않음). 확인된 payload 1건씩을 보고에 인용한다.
- [x] **Step 6: 경계 회귀 검사**
  - `git diff main --stat -- 'src/app/**/page.tsx'`에 `'use client'` 추가 0건
  - `grep -rn "@/entities/product\"\|@/entities/departure\"" src/features/analytics src/shared/lib/analytics` → 0건
- [x] **Step 7: 커밋** — `feat(analytics): wire client-side GA4 funnel events`

> **Task 6 실측 (2026-10-14, Playwright, dev):** dataLayer 덤프로 6종 확인 — `view_item_list`(/products 목록·/search 20건), `search`(`"오사카 온천"`), `view_item`(value 790000), `add_to_wishlist`(추가 시만), `begin_checkout`(성인1·`item_variant:"adult"`), `add_payment_info`(value=서버 금액·`payment_type:"toss"`). 빌드: 홈 `○` / products·PDP·checkout·search `◐` 유지, 비-API `ƒ` 0.
> ⚠️ **발견:** 시드 출발일이 전부 과거(2026-10-14 기준 미래 출발편 0건)라 PDP에 "예약하기" 링크가 없다 → 기존 `tests/e2e/checkout.spec.ts`가 현재 데이터로는 실패한다. ~~시드 수정 필요~~ → **해소(2026-10-14):** `prisma/seed.ts`는 이미 상대일(`addDays(today, N)`)이라 코드 문제가 아니라 5월에 적재된 로컬 DB가 낡은 것. 재시드는 비-시드 상품·임베딩·찜을 삭제하므로 사용자 결정으로 **로컬 Departure 43건의 출발/귀국일을 +160일 일괄 이동**(최소 10/15, 미래 SCHEDULED 39건). 다른 에이전트가 같은 증상을 보면 동일하게 날짜 이동 또는 `npm run db:seed` 후 임베딩 cron 재생성.

---

## Task 7: GTM 콘솔 설정 (수동 — 절차 명시)

> GTM은 코드가 아니라 콘솔에서 설정한다. 에이전트는 이 절차를 사용자에게 안내하고, 완료 후 Preview로 검증한다.

- [x] **Step 1: 변수 생성**
  - 상수 변수 `GA4 Measurement ID` = `G-XXXXXXX`
  - 데이터 영역 변수 `DLV - search_term` (데이터 영역 변수 이름 `search_term`)
  - ※ `ecommerce` 변수는 불필요 — GA4 이벤트 태그의 "전자상거래 데이터 보내기(Data Layer)"가 직접 읽는다
- [x] **Step 2: GA4 기본 태그** — 태그 유형 "Google 태그", 태그 ID = `{{GA4 Measurement ID}}`, 트리거 = **Initialization - All Pages**
- [x] **Step 3: 전자상거래 이벤트 태그** — 태그 유형 "GA4 이벤트", 이벤트 이름 = `{{Event}}`, "전자상거래 데이터 보내기" ON (데이터 소스: Data Layer)
  - 트리거: 맞춤 이벤트, 정규식 `^(view_item_list|view_item|search|add_to_wishlist|begin_checkout|add_payment_info)$`
  - `search` 이벤트에는 이벤트 매개변수 `search_term` = 데이터 영역 변수 `search_term`을 추가로 매핑
- [x] **Step 4: Preview 검증** — GTM 미리보기에 `http://localhost:3000` 연결 → 6종 이벤트 발화와 태그 Fired 확인 → GA4 관리 → DebugView에서 수신 확인
  - Preview 모드는 추가 Google 도메인을 사용하므로 `CSP_MODE` report-only(기본) 상태에서 진행한다
- [x] **Step 5: 컨테이너 게시(Submit → Publish)**, 버전 이름 `v1 ecommerce funnel`
- [x] **Step 6: GA4 전환 설정** — GA4 관리 → 이벤트 → `purchase`를 "주요 이벤트(key event)"로 표시

> **Task 7 실측 (2026-10-14, 사용자 수행):** Tag Assistant 미리보기에서 `GA4 - Google 태그` 실행 + `GA4 - ecommerce events` 3회 실행(view_item / add_to_wishlist / begin_checkout), 실행 안 됨 0.
> ⚠️ **함정 2건 (다음 작업자 참고):** (1) 트리거의 "정규 표현식 일치 사용" 미체크 시 조건이 `_event 같음 ^(...)$` 로 표시되며 전부 실패 — 반드시 체크. (2) 미리보기가 "localhost에 연결할 수 없음(시간 초과)"이면 원인은 우리 보안 헤더 `Cross-Origin-Opener-Policy: same-origin`(ADR-0039)이 Tag Assistant 의 window.opener 통신을 끊는 것 — 헤더를 풀지 말고 Chrome 확장 **Tag Assistant Companion** 설치로 해결. 확장이 `<html>` 에 data-* 속성을 주입해 dev hydration 경고가 나므로 root layout `<html suppressHydrationWarning>` 적용(커밋 494b3ec).

---

## Task 8: Prisma — `Booking.gaClientId` + `AnalyticsJob`

**Files:** `prisma/schema.prisma`, `prisma/migrations/<ts>_analytics_job/migration.sql`

- [x] **Step 1: 스키마 작성**
  ```prisma
  // Booking 모델에 추가
  gaClientId String? // GA4 client_id 스냅샷(_ga 쿠키). 체크아웃 시점 캡처, MP 발송 시 귀속용. PII 아님.
  analyticsJobs AnalyticsJob[]

  enum AnalyticsEventType {
    PURCHASE
    REFUND
  }

  enum AnalyticsJobStatus {
    PENDING
    IN_PROGRESS // CAS claim (EmailJob 워커 동형, stale reaper 대상)
    SUCCEEDED
    FAILED
    SKIPPED // MP 72h 백데이트 한도 초과 등 영구 미발송
  }

  model AnalyticsJob {
    id          String             @id @default(cuid())
    type        AnalyticsEventType
    dedupeKey   String             @unique // "ga-purchase:<bookingId>" / "ga-refund:<refundJobId>"
    bookingId   String
    refundJobId String?            // REFUND일 때만. 워커가 hydration 시 금액 조회
    occurredAt  DateTime           // 이벤트 발생 시각 → MP timestamp_micros
    status      AnalyticsJobStatus @default(PENDING)
    attempts    Int                @default(0)
    lastError   String?            @db.Text
    nextRunAt   DateTime           @default(now())
    createdAt   DateTime           @default(now())
    updatedAt   DateTime           @updatedAt

    booking Booking @relation(fields: [bookingId], references: [id], onDelete: Cascade)

    @@index([status, nextRunAt])
  }
  ```
  - payload 컬럼 없음 → 워커가 발송 시점에 hydrate한다(EmailJob과 동형, ADR-0030)
- [x] **Step 2: 마이그레이션** — `npx prisma migrate dev --name analytics_job`
  - **shadow DB pgvector 에러로 실패하면** 이 프로젝트의 우회 절차를 따른다:
    1. `npx prisma db push`
    2. `prisma/migrations/<YYYYMMDDHHMMSS>_analytics_job/migration.sql`을 수동 작성(CREATE TYPE ×2, CREATE TABLE, ALTER TABLE "Booking" ADD COLUMN, 인덱스·FK)
    3. `npx prisma migrate resolve --applied <폴더명>`
  - `npm run build`는 `prisma migrate deploy`를 선실행하므로 migration.sql이 정확해야 운영 배포가 성공한다
- [x] **Step 3: 검증** — `npx prisma migrate status`가 "up to date"인지, `npm run typecheck` 0인지 확인. seed 영향 없음 확인(`npm run db:seed` 1회 실행)
- [x] **Step 4: 커밋** — `feat(db): add AnalyticsJob outbox and Booking.gaClientId`

> **Task 8 실측 (2026-10-14):** shadow DB 우회를 db push 대신 `prisma migrate diff --from-url <DB> --to-schema-datamodel` 로 정확한 diff SQL 을 뽑아 `20261014000000_analytics_job/migration.sql` 로 저장 → `prisma migrate deploy` 적용(drift 0, `migrate status` up to date). seed 영향: `Booking` 삭제 시 FK `ON DELETE CASCADE` 로 AnalyticsJob 자동 정리 — seed/e2e teardown 수정 불요.

---

## Task 9: 체크아웃 시 `gaClientId` 캡처

**Files:** `src/features/checkout/server/actions.ts`, `src/entities/booking`(createBooking 입력 타입), 테스트

- [x] **Step 1: 테스트 먼저 작성** — `_ga` 쿠키가 있으면 `createBooking`에 `gaClientId`가 전달되고, 없거나 형식이 깨졌으면 `null`이 전달되는지 확인한다(`next/headers`의 `cookies` mock)
- [x] **Step 2: FAIL 확인**
- [x] **Step 3: 구현**
  - action에서 `(await cookies()).get("_ga")?.value` → `parseGaClientId()`로 파싱 → `createBooking({ ..., gaClientId })`
  - `CreateBookingSchema`에 `gaClientId: z.string().max(64).nullable().optional()` 추가
  - **가격·좌석·상태 로직 0줄 변경** (💳 Domain Booking 자가점검)
- [x] **Step 4: PASS + 기존 checkout/booking 테스트 전부 green**
- [x] **Step 5: 커밋** — `feat(checkout): snapshot GA client id on booking`

> **Task 9 실측 (2026-10-14, Playwright, dev):** 게시된 GTM 의 GA4 태그가 실제 발급한 `_ga=GA1.1.730834906.1791944543` 로 체크아웃 → DB `Booking.gaClientId = "730834906.1791944543"` 저장 확인 후 E2E 마커 예약 purge. 💳 자가점검: `mutations.ts` diff 는 `gaClientId` 저장 1줄뿐 — 가격·좌석·상태 로직 무변경.

---

## Task 10: `analytics-job` 모듈 — policy / enqueue / MP / worker (TDD)

**Files:** `src/entities/booking/model/analyticsPolicy.ts`, `src/shared/lib/analytics-job/{enqueue,mp,worker,index}.ts`, 각 `__tests__`

- [x] **Step 1: `analyticsPolicy` 테스트 → 구현**
  - `analyticsJobForTransition(from, to, bookingId)` → `to === "PAID"`이면 `{ type: "PURCHASE", dedupeKey: "ga-purchase:<bookingId>" }`, 그 외에는 `null`
  - 환불은 여기서 다루지 않는다(RefundJob settle에서 직접 적재 — 부분 환불이 전이 없이 발생하기 때문)
- [x] **Step 2: `enqueue` 테스트 → 구현** — `enqueueEmailJob`과 동형인 find-then-create 멱등 처리(P2002 Tx abort 회피). 같은 dedupeKey로 두 번 호출 시 1행만 생성되는지 확인
- [x] **Step 3: `mp.ts` 테스트 → 구현** (`fetch` mock)
  - `POST https://www.google-analytics.com/mp/collect?measurement_id=..&api_secret=..`
  - body: `{ client_id, timestamp_micros, non_personalized_ads: false, events: [{ name, params: { transaction_id, value, currency: "KRW", items, engagement_time_msec: 1 } }] }`
  - `client_id`가 null이면 `"srv.<bookingId>"` 폴백(귀속은 잃지만 매출 집계는 보존). 주석으로 트레이드오프 명시
  - **dev/test 폴백:** `NODE_ENV !== "production"`이거나 키가 미설정이면 실제 fetch 없이 `logger.info("analytics.mp.dev", { body })`만 남기고 성공 처리(외부 IO 분기는 NODE_ENV만 기준 — 프로젝트 규칙)
  - 응답이 2xx가 아니면 throw (MP collect는 보통 2xx를 반환하므로 네트워크·5xx만 재시도 대상)
- [x] **Step 4: `worker.ts` 테스트 → 구현** — `processAnalyticsJobBatch({ limit })`
  - `status=PENDING AND nextRunAt<=now` 픽업 (EmailJob 워커 구조를 그대로 따른다)
  - hydrate:
    - PURCHASE: `Booking`(totalPrice, gaClientId, departure → product title·destination, 인원) → `transaction_id = bookingId`, `value = totalPrice`
    - REFUND: `RefundJob.amount` → `transaction_id = bookingId`, `value = amount`. items는 생략(GA4 부분환불은 value만으로 허용)
  - **72h 가드:** `now - occurredAt > 72h`이면 MP가 거부하므로 `SKIPPED` + lastError 기록 (daily cron 지연·장애 대비)
  - 실패 시 attempts++, 지수 백오프로 nextRunAt 설정, 최대 시도 후 `FAILED`
  - per-job 격리(한 건 실패가 배치를 죽이지 않음)
  - `index.ts` 배럴은 `import "server-only"` 포함
- [x] **Step 5: PASS 확인** — `npx vitest run src/shared/lib/analytics-job src/entities/booking`
- [x] **Step 6: 커밋** — `feat(analytics): add server-side GA4 MP outbox worker`

> **Task 10 실측 (2026-10-14, 로컬 DB + tsx):** 실제 PAID 예약으로 enqueue ×2 → 1행(멱등), 배치 실행 → `analytics.mp.dev` 로그(dev 폴백, 외부 IO 0) 후 `SUCCEEDED`, 80h 전 occurredAt 은 `SKIPPED`("beyond MP 72h backdate limit"). Task 9 이전 예약은 gaClientId=null → `client_id: srv.<bookingId>` 폴백 확인. 프로브 행 삭제.
> 구현 노트: purchase items 는 출발일 현재가가 아니라 **Traveler.paxType/unitPrice 예약 시점 스냅샷**으로 구성(paxType 없는 레거시는 totalPrice 단일 item). 상태값은 EmailJob 과 맞춰 `SUCCEEDED`(plan 초안의 `SENT` 대체).

---

## Task 11: 아웃박스 배선 (결제·환불 Tx에 enqueue 한 줄씩)

**Files:** `src/entities/booking/api/mutations.ts`, `src/entities/payment/api/refund.ts`, `src/entities/payment/api/refundRetry.ts`

- [ ] **Step 1: 테스트 먼저 작성**
  - `transitionStatusTx` PAID 전이 → 같은 tx에서 AnalyticsJob(PURCHASE) 적재. 기존 `updateTag×N`·EmailJob 단언은 불변
  - refund settle(첫 시도 성공 경로 `refund.ts`, cron 재시도 성공 경로 `refundRetry.ts`) → AnalyticsJob(REFUND, `ga-refund:<refundJobId>`) 적재. **FULL_CANCEL 포함 모든 kind**에서 적재
  - `refundAmount === 0`(100% 위약금, Toss-skip)이면 적재하지 않음
- [ ] **Step 2: FAIL 확인**
- [ ] **Step 3: 구현**
  - `mutations.ts`: `emailJobForTransition` 블록 바로 아래에 `analyticsJobForTransition` → `enqueueAnalyticsJob(tx, { ..., occurredAt: new Date() })` 추가
  - `refund.ts`/`refundRetry.ts`: settle `$transaction` 안의 기존 `enqueueEmailJob` 근처에 추가. `if` 분기(`kind !== FULL_CANCEL`) **밖**에 둔다
  - **💳 자가점검:** 외부 IO 0(enqueue는 DB insert뿐), 금액은 RefundJob 동결 스냅샷만 참조, 상태 전이·좌석 로직 diff 0
- [ ] **Step 4: PASS + 결제/환불 관련 기존 테스트 전체 green** — `npx vitest run src/entities/booking src/entities/payment`
- [ ] **Step 5: 커밋** — `feat(analytics): enqueue purchase/refund jobs in transactional outbox`

---

## Task 12: cron 등록 + MP 검증 스크립트

**Files:** `src/app/api/cron/dispatcher/route.ts`, `scripts/analytics/mp-validate.ts`, `package.json`

- [ ] **Step 1: dispatcher WORKERS에 추가** — `{ name: "analytics", run: () => processAnalyticsJobBatch({ limit: 20 }) }`
- [ ] **Step 2: dispatcher 런타임 검증** — dev에서 `curl -s -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/dispatcher | jq '.workers'` → `analytics` 워커가 `fulfilled`인지 확인
- [ ] **Step 3: MP 검증 스크립트** — `scripts/analytics/mp-validate.ts`: 샘플 purchase body를 `https://www.google-analytics.com/debug/mp/collect`로 POST하고 `validationMessages`를 출력한다(debug 엔드포인트는 데이터를 적재하지 않으므로 안전). `package.json`에 `"analytics:validate": "tsx scripts/analytics/mp-validate.ts"` 추가
- [ ] **Step 4: 실행** — `npm run analytics:validate` → `validationMessages: []`(빈 배열)인지 출력을 인용
- [ ] **Step 5: 커밋** — `feat(analytics): register MP worker in cron dispatcher`

---

## Task 13: E2E (Playwright)

**Files:** `tests/e2e/analytics.spec.ts`, `playwright.config.ts`(webServer.env)

- [ ] **Step 1: 설정** — `webServer.env`에 `NEXT_PUBLIC_GTM_ID=GTM-E2ETEST` 주입. spec에서 `page.route("**/gtm.js*", r => r.fulfill({ body: "" }))`로 외부 GTM 호출을 차단한다(네트워크 비의존)
- [ ] **Step 2: 클라이언트 퍼널 spec** — 목록 → PDP → 체크아웃 이동 후 `page.evaluate(() => window.dataLayer)`에서 `view_item_list`, `view_item`, `begin_checkout` 존재와 `currency === "KRW"`, `value`가 정수인지 단언한다. `/admin`에서는 gtm.js 요청 0건을 단언한다
- [ ] **Step 3: 서버 purchase spec** — 기존 `checkout.spec.ts`의 Mock 결제 흐름(localhost:4242)을 재사용해 결제 완료 후 `tests/e2e/helpers/db.ts`로 `AnalyticsJob(type=PURCHASE, dedupeKey=ga-purchase:<bookingId>)` 1행 존재를 단언한다. teardown에 해당 행 정리를 추가한다(자기정리 원칙)
- [ ] **Step 4: 실행** — `npm run test:e2e` 그린 출력 인용
- [ ] **Step 5: 커밋** — `test(e2e): cover GA4 funnel dataLayer and purchase outbox`

---

## Task 14: 문서화

- [ ] **Step 1: ADR-0062 작성** — `docs/superpowers/adr/0062-ga4-gtm-hybrid-analytics-outbox.md` (`template.md`의 4섹션 형식)
  - Decision: GTM 단일 설치 + GA4는 GTM 내부 / 클라이언트 퍼널 + 서버 purchase·refund 하이브리드 / 트랜잭셔널 아웃박스 / CSP 확장
  - **Alternatives Considered (필수):**
    - (a) gtag.js 직접 설치 — 마케터가 코드 배포 없이 태그를 바꿀 수 없어서 거부
    - (b) 클라이언트 purchase — 광고차단기 유실과 성공 페이지 즉시 redirect로 인한 누락 때문에 거부
    - (c) 클라이언트+서버 이중 purchase — transaction_id 중복제거에 의존하는 것이 불확실해서 거부
    - (d) 결제 confirm 핸들러에서 MP 동기 호출 — 외부 IO가 결제 경로에 직결되고 롤백 시 불일치가 생겨서 거부(ADR-0003)
    - (e) 쿠키 동의 배너(Consent Mode v2) — 국내 대상 서비스라 현 범위 밖, 개인정보처리방침 고지로 대체. EEA 확장 시 재논의
  - Task 3 Step 3의 CSP 실측 결과를 근거로 인용
- [ ] **Step 2: `docs/superpowers/adr/README.md`** 인덱스에 한 줄 추가하고, README의 ADR 범위 표기(0001-0061)를 0062로 갱신
- [ ] **Step 3: CLAUDE.md §8** — 완료 내용 한 줄과 "다음 작업자 혼란 방지 노트" 3개 추가:
  - "purchase가 왜 dataLayer에 없나?" → 서버 MP 단일 경로
  - "GA4 리포트에 purchase가 하루 늦게 뜬다?" → daily cron dispatcher, 72h 한도 내 timestamp_micros 백데이트라 날짜는 정확
  - "GTM 태그를 바꾸려면?" → 코드가 아니라 GTM 콘솔
- [ ] **Step 4: 개인정보처리방침 고지 확인** — 사이트에 처리방침/약관 페이지가 있으면 "Google Analytics 사용 및 쿠키 수집" 문구를 추가한다. 없으면 백로그로 기록하고 사용자에게 보고한다
- [ ] **Step 5: 커밋** — `docs(adr): 0062 GA4/GTM hybrid analytics with outbox`

---

## Task 15: 최종 QA (🔬 증거 기반 — 완료 보고 전 필수)

- [ ] **Step 1:** `npm run typecheck` → 0 errors (출력 인용)
- [ ] **Step 2:** `npm run test` → 전체 green (출력 인용)
- [ ] **Step 3:** `npm run lint` → 0 errors (ADR-0061 배럴 규칙 포함)
- [ ] **Step 4:** `npm run build` (dev 종료 상태 또는 클론 워크트리) → 홈 `○` / PDP `◐` / 안전 도메인 `◐` 유지, 신규 `ƒ` 0건
- [ ] **Step 5:** `npm run test:e2e` → green
- [ ] **Step 6:** `CSP_MODE=enforce`로 `/`, `/products/<id>`, `/products/<id>/checkout` 콘솔 CSP violation 0건 (Task 3 재확인)
- [ ] **Step 7:** 경계 grep
  ```bash
  grep -rn "shared/lib/env" src/shared/lib/analytics          # 기대: 0
  grep -rn "GA4_API_SECRET" src --include=*.tsx               # 기대: 0 (서버 전용)
  grep -rn "'use client'\|\"use client\"" src/app --include=page.tsx  # 기대: 0
  ```
- [ ] **Step 8 (운영 키가 있을 때):** GA4 DebugView / 실시간 보고서에서 클라이언트 퍼널 이벤트 수신 확인. 서버 purchase는 staging에서 Mock 결제 1건 → dispatcher 수동 트리거 → GA4 실시간에서 `purchase` 확인. **토스 샌드박스/Mock 결제만 사용 (NO-REAL-MONEY)**
- [ ] **Step 9: 체크박스 최종 점검** — `grep -n "\- \[ \]" docs/superpowers/plans/2026-10-14-ga4-gtm-analytics.md` → 0건 확인 후 plan을 `docs/superpowers/plans/done/`으로 이동
- [ ] **Step 10:** 사용자 확인 후 PR 생성 (main 대상)

---

## 범위 밖 (의도적 제외)

- 쿠키 동의 배너 / Consent Mode v2 (ADR-0062 Alternatives (e))
- GTM Server-side 컨테이너(sGTM) — 별도 인프라(Cloud Run)가 필요하고, 이 규모에서는 MP 직접 호출로 충분
- `(admin)` 셸 분석 — 내부 운영 트래픽이라 제외
- BigQuery Export, Looker Studio 대시보드 — GA4 콘솔에서 토글하면 되므로 코드 범위 밖
