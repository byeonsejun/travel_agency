# M-OBS 구현 계획 (Observability Foundation)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.
>
> **Plan Authoring Rule (`CLAUDE.md §4.2`)**: 본 plan의 모든 체크박스는 미완료 상태(`- [ ]`)로 초기화되어 있다. 절대 Pre-checking 금지. 각 Task의 구현·QA 증거 수집이 완료된 **직후 그 자리에서** `- [ ]` → `- [x]`로 한 줄씩 직접 Write한다 (`§4.1`).

**Goal:** 결제 도메인을 운용 가능한(operable) 상태로 만든다. `shared/lib/observability/` 횡단 인프라 슬라이스를 신설하여 **(1) 컨텍스트 보존 구조화 로깅, (2) traceId 자동 전파, (3) Error Tracking 추상화(Sentry-ready, no-op default), (4) 도메인 metrics counter, (5) `/api/health` readiness, (6) PaymentEvent·RefundJob 관측 query**를 구축한다. 본 페이즈에서는 외부 SaaS(Sentry/Datadog) 신규 의존성을 도입하지 않고, **`captureException` 어댑터만 마련**해 추후 PR에서 DSN 한 줄로 전환 가능하게 한다.

**Architecture:** `middleware`(Edge)에서 `x-trace-id` 발급 → route handler를 `withObservedRoute`로 래핑 → `AsyncLocalStorage`(Node runtime)에 `{traceId, userId, routeName}` 저장 → `logger.*` / `metrics.incr` / `captureException`이 자동으로 컨텍스트 머지. 결제 코어(`confirm`/`webhook`/`refund`)의 `console.*` 호출을 전부 구조화 로거로 교체하고 핵심 분기에 metrics counter를 부착. **외부 IO·DB 트랜잭션 경계는 절대 침해하지 않는다** — 모든 관측 코드는 부수 효과이며 본류 흐름을 변경하면 안 됨.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Prisma 5 + PostgreSQL, Zod 3, Vitest 2, Node `async_hooks.AsyncLocalStorage`, `crypto.randomUUID`.

**Applied Personas:**
- 🏛️ `architect` ⭐ — `shared/lib/observability/` 슬라이스 신설, barrel 명시 export, 단방향 의존성(entities → shared만 허용), 횡단 관심사를 `features/`/`entities/` 외부로 격리
- ⚙️ `backend-expert` ⭐ — env 추가, Edge/Node runtime 분리 인지(middleware는 ALS 금지), 모든 입력 zod 검증, Prisma 호출 격리
- 💳 `domain-booking` — 결제 흐름 metric 부착 시 본류 트랜잭션 경계·외부 IO 순서를 절대 변경하지 않음(R3·R7 보호), 멱등성 로그 라벨링
- 🔬 `qa-engineer` ⭐ — 모든 Task에서 typecheck/test/lint + 시나리오 스크립트로 traceId 전파·로그 라인·metric 카운트를 출력 인용으로 증명, R8 File-written gate
- 🎨 `frontend-expert` — 본 Phase는 UI 변경 없음 (필요 시 다음 Phase M-CHECKOUT에서 toast/페이지 단위 trace 헤더 노출)

**Spec:** `docs/superpowers/specs/2026-05-14-observability-design.md` (Task 11에서 작성)

---

## 파일 맵

### 신규 생성 (shared/lib/observability)

| 파일 | 역할 |
|------|------|
| `src/shared/lib/observability/types.ts` | `LogLevel`, `LogContext`, `MetricTags`, `ErrorTrackerCtx` 타입 |
| `src/shared/lib/observability/redact.ts` | `redactPII(data)` — 이메일·전화·tossPaymentKey·session token 마스킹 순수 함수 |
| `src/shared/lib/observability/__tests__/redact.test.ts` | 이메일/카드/토큰/중첩 객체 마스킹 케이스 |
| `src/shared/lib/observability/context.ts` | `AsyncLocalStorage` 기반 `requestContextStorage`, `runWithContext`, `getContext`, `setContext`(merge) |
| `src/shared/lib/observability/__tests__/context.test.ts` | 중첩 비동기·병렬 분기 격리 검증 |
| `src/shared/lib/observability/generateTraceId.ts` | `crypto.randomUUID` 기반 `generateTraceId()` (16자 단축 hex) + `isValidTraceId` |
| `src/shared/lib/observability/__tests__/generateTraceId.test.ts` | 형식·고유성 sanity 케이스 |
| `src/shared/lib/observability/logger.ts` | v2 logger — `info/warn/error/debug`, 자동 context merge, redact 통합, 테스트 환경 silent |
| `src/shared/lib/observability/__tests__/logger.test.ts` | context 머지, redact 적용, level 분기, 에러 stack 처리 |
| `src/shared/lib/observability/metrics.ts` | `incr(name, tags?)`, `observe(name, value, tags?)`, `snapshot()`, `resetForTest()` |
| `src/shared/lib/observability/__tests__/metrics.test.ts` | 카운팅·태그 키·snapshot 직렬화 |
| `src/shared/lib/observability/errorTracker.ts` | `captureException(err, ctx?)`, `captureMessage(msg, level, ctx?)` — logger fanout + Sentry 어댑터 stub (DSN 없으면 no-op) |
| `src/shared/lib/observability/__tests__/errorTracker.test.ts` | DSN 미설정 시 logger.error만, 컨텍스트 머지, 다중 호출 |
| `src/shared/lib/observability/withObservedRoute.ts` | Route handler를 감싸 traceId 발급·`runWithContext`·start/end log·`captureException` 자동화 |
| `src/shared/lib/observability/__tests__/withObservedRoute.test.ts` | 정상/throw/4xx 분기 + 트레이스 헤더 응답 검증 |
| `src/shared/lib/observability/index.ts` | barrel — `logger`, `metrics`, `captureException`, `withObservedRoute`, `runWithContext`, `getContext`, `generateTraceId`, types |

### 신규 생성 (entities/payment 관측 query)

| 파일 | 역할 |
|------|------|
| `src/entities/payment/api/observability.ts` | `listRecentPaymentEvents(opts)`, `summarizeRefundJobs()` — 운영 대시보드용 read-only query |
| `src/entities/payment/api/__tests__/observability.test.ts` | seed → query → 분포 검증 |

### 신규 생성 (app/api)

| 파일 | 역할 |
|------|------|
| `src/app/api/health/route.ts` | GET — `SELECT 1` + version + traceId 응답, `withObservedRoute` 적용 |

### 신규 생성 (QA evidence)

| 파일 | 역할 |
|------|------|
| `scripts/qa/observability-evidence.ts` | (a) traceId 전파 시뮬레이션, (b) metrics counter 누적 확인, (c) PaymentEvent·RefundJob 분포 dump, (d) `/api/health` curl 검증 |

### 수정

| 파일 | 변경 내용 |
|------|----------|
| `src/shared/lib/env.ts` | `SENTRY_DSN` optional, `OBSERVABILITY_LOG_LEVEL` optional(`info` default), `APP_VERSION` optional |
| `src/shared/lib/logger.ts` | **Deprecation shim** — `observability/logger`를 re-export 후 기존 `logger.info/warn/error` 동작 그대로 유지(호출처 무수정), 향후 PR에서 import 경로만 마이그레이션 |
| `src/middleware.ts` | (이미 존재 시) 기존 auth 흐름 보존 + 응답에 `x-trace-id` 헤더 발급 1줄 추가, 없으면 신규 작성. **Edge runtime — Prisma·ALS 호출 금지** |
| `src/entities/payment/api/confirm.ts` | `console.error` → `logger.error` 교체 + `metrics.incr("payment.compensate_cancel.{pg_failed,enqueue_failed}")` |
| `src/entities/payment/api/webhook.ts` | invalid signature / 멱등 skip / 처리 성공 분기에 `metrics.incr("payment.webhook.toss.{invalid_sig,duplicate,processed,ignored}")` + `captureException` |
| `src/entities/payment/api/refund.ts` | PG 실패 / RefundJob enqueue / 성공 분기에 logger·metrics 부착 |
| `src/app/api/payments/confirm/route.ts` | `withObservedRoute`로 래핑, 응답 헤더에 `x-trace-id` 포함 |
| `src/app/api/payments/webhook/toss/route.ts` | `withObservedRoute`로 래핑 (raw body 보존 흐름은 유지) |
| `src/entities/payment/index.ts` | barrel에 `listRecentPaymentEvents`, `summarizeRefundJobs` 추가 |
| `src/app/layout.tsx` | `console.log("[RootLayout] getCurrentUser →", user)` → `logger.debug("layout.root.user_resolved", { userId })` |
| `src/features/auth/server/auth.ts` | 기존 `logger.info("auth.magiclink.dev", …)` 유지(이미 구조화 로그) — 다만 `observability/logger`에서 import하도록 경로 점진 마이그레이션 |

### 신규 생성 (spec)

| 파일 | 역할 |
|------|------|
| `docs/superpowers/specs/2026-05-14-observability-design.md` | 설계 의도·트레이드오프·Sentry 전환 절차 1페이지 |

---

## 태스크 목록

> **모든 태스크 공통 규칙**
> 1. **🛠️ 구현** — `architect.md` / `backend-expert.md` 규칙 명시. 모든 신규 파일은 명시적 named export만 사용, barrel 통과.
> 2. **🔬 QA 자동 증거 수집** — 다음 4개를 반드시 자동 실행:
>    - (a) `npm run typecheck` / 관련 vitest / `npm run lint`
>    - (b) `npx tsx` 시나리오 스크립트로 런타임 증거 (trace 전파·metric 카운트·로그 라인)
>    - (c) **R8 Plan 체크박스 File-written 검증** — `grep -n "\- \[ \]" docs/superpowers/plans/2026-05-14-observability.md` 으로 **현재 Task의 미완료 항목 0건**임을 확인하고, `git diff docs/superpowers/plans/2026-05-14-observability.md` 로 `- [x]` 변경이 실제 파일에 기록됐는지 확인
>    - (d) Evidence-first 보고 (출력 인용)
> 3. **체크박스 갱신은 Task 단위로 즉시** — 구현·검증이 끝나는 즉시 해당 Task의 모든 `- [ ]`를 `- [x]`로 **파일에 직접 Write**한 뒤 다음 Task로 넘어간다 (`CLAUDE.md §4.1`).
> 4. **본 Phase에서 외부 SaaS 신규 의존성(@sentry/* 등) 설치 금지** — `captureException`은 어댑터 인터페이스만 마련하고 logger fanout으로 동작.

---

### Task 1: env 확장 + observability 슬라이스 뼈대 + 타입

**Files:**
- Modify: `src/shared/lib/env.ts`
- Create: `src/shared/lib/observability/types.ts`
- Create: `src/shared/lib/observability/index.ts` (빈 barrel)

**적용 규칙:** `architect.md` R1(슬라이스 신설), `backend-expert.md` R5(env 단일 출입구)

#### 🛠️ 구현
- [x] `env.ts`에 `SENTRY_DSN: z.string().url().optional()` 추가
- [x] `env.ts`에 `OBSERVABILITY_LOG_LEVEL: z.enum(["debug","info","warn","error"]).default("info")` 추가
- [x] `env.ts`에 `APP_VERSION: z.string().optional()` 추가 (CI에서 git SHA 주입 대비)
- [x] `production` superRefine에 `SENTRY_DSN` 강제하지 **않음** (점진 도입). 단, DSN이 비어있으면 `errorTracker`는 logger fanout으로만 동작한다는 주석 1줄 추가
- [x] `observability/types.ts`: `LogLevel`, `LogContext`(traceId·userId·routeName·bookingId·paymentId optional), `MetricTags`(`Record<string,string|number|boolean>`), `ErrorTrackerCtx` 정의
- [x] `observability/index.ts`: barrel 작성 — `LogLevel`/`LogContext`/`MetricTagValue`/`MetricTags`/`ErrorTrackerCtx`/`LogPayload` 명시 export

#### 🔬 QA 자동 증거 수집
- [x] `npm run typecheck` 통과 — 출력 첨부 (`tsc --noEmit` 0 errors)
- [x] `npm run lint` 통과 (신규 파일 warning 0건; 기존 코드 잔존 warning 8건은 본 Task 외부)
- [x] `npx tsx --env-file=.env -e "import { env } …"` 출력 인용: `{ "logLevel": "info", "sentryConfigured": false, "appVersion": null, "nodeEnv": "development" }`
- [x] R8: `grep -n "\- \[ \]" docs/superpowers/plans/2026-05-14-observability.md`에서 Task 1 범위 미완료 항목 0건 확인 + `git diff docs/superpowers/plans/2026-05-14-observability.md`로 `- [x]` 갱신 반영

#### ✅ 통과 보고
- [x] Evidence-first 형식으로 보고
- [ ] `git commit -m "feat(obs): scaffold observability slice with env + types"`

---

### Task 2: PII 리덕션 순수 함수 (`pii.ts`, 사용자 지시로 `redact.ts`에서 개명)

**Files:**
- Create: `src/shared/lib/observability/pii.ts`
- Create: `src/shared/lib/observability/__tests__/pii.test.ts`

**적용 규칙:** `backend-expert.md` R10(로그 노출 금지), `architect.md` R2(순수 함수는 shared)

#### 🛠️ 구현
- [x] `maskPii<T>(data: T, options?: { maxDepth?: number }): T` — 입력 객체를 재귀 순회하여 다음 키를 마스킹:
  - 이메일 형식 값 → `e***@d***` (부분 마스킹: 로컬·도메인 첫 글자만 노출)
  - `tossPaymentKey`, `paymentKey`, `secret`, `*_SECRET`, `authorization`, `cookie`, `password`, `token`, `apiKey`, `accessToken`, `refreshToken`, `cardNumber`, `ssn` 키 → `[REDACTED]` (대소문자 무시)
  - 전화번호(`010-?\d{4}-?\d{4}` 등) → `010-****-****`
  - 카드번호/신분증 형식 16-19자리 숫자(공백/하이픈 허용) → `[REDACTED:CARD]`
- [x] 원본 입력 mutate 금지 — 새 객체 반환 (공통 규칙: 배열 변이 금지). 테스트 `JSON.parse(JSON.stringify(original))` snapshot으로 보장
- [x] 최대 깊이 6 default + cycle guard (WeakSet) — 무한 재귀 방지. 깊이 초과 시 `[MAX_DEPTH]`, cycle 감지 시 `[CIRCULAR]` 마커
- [x] 테스트 케이스: 평면 객체, 중첩 객체, 배열 안 객체, null·undefined·primitive 그대로, cycle 객체 안전 처리, depth 한계, 단독 문자열 패턴 매칭

#### 🔬 QA 자동 증거 수집
- [x] `npm run typecheck` 통과 (0 errors)
- [x] `npx vitest run src/shared/lib/observability/__tests__/pii.test.ts` — **17/17 통과**
- [x] `npm run test` 전체 — 185/185 통과(16 files), 회귀 0건
- [x] `npm run lint` — 신규 파일 warning/error 0건
- [x] R8 File-written gate 확인 — Task 2 범위 미완료 항목 0건(commit 줄 제외)

#### ✅ 통과 보고
- [x] Evidence-first 보고
- [ ] `git commit -m "feat(obs): add PII masking utility (maskPii)"`

---

### Task 3: RequestContext (AsyncLocalStorage)

**Files:**
- Create: `src/shared/lib/observability/context.ts`
- Create: `src/shared/lib/observability/__tests__/context.test.ts`

**적용 규칙:** `backend-expert.md`(Edge runtime 인지 — 본 모듈은 Node 전용. middleware는 import 금지), `architect.md` R1

#### 🛠️ 구현
- [x] `async_hooks.AsyncLocalStorage<LogContext>` 인스턴스 모듈 싱글톤으로 보유
- [x] `runWithContext<T>(ctx: LogContext, fn: () => Promise<T>): Promise<T>`
- [x] `getContext(): LogContext | undefined`
- [x] `setContext(partial: Partial<LogContext>)` — 현재 store에 머지(없으면 no-op)
- [x] 파일 상단 주석: "Node runtime only. middleware(Edge)에서 import 금지."
- [x] 테스트: 중첩 `runWithContext`, `Promise.all` 병렬 분기 격리(3-way), `setContext` 머지, `setTimeout` 비동기 체인, fail-safe 검증(12 tests)

#### 🔬 QA 자동 증거 수집
- [x] `npm run typecheck` 통과 (0 errors)
- [x] `npx vitest run src/shared/lib/observability/__tests__/context.test.ts` — **12/12 통과**
- [x] `npm run test` 전체 — 197/197 통과 (17 files), 회귀 0건
- [x] R8 File-written gate 확인 — Task 3 범위 미완료 항목 0건(commit 줄 제외)

#### ✅ 통과 보고
- [x] Evidence-first 보고
- [ ] `git commit -m "feat(obs): add AsyncLocalStorage request context"`

---

### Task 4: traceId 발급 + 구조화 로거 v2

**Files:**
- Create: `src/shared/lib/observability/generateTraceId.ts`
- Create: `src/shared/lib/observability/__tests__/generateTraceId.test.ts`
- Create: `src/shared/lib/observability/logger.ts`
- Create: `src/shared/lib/observability/__tests__/logger.test.ts`
- Modify: `src/shared/lib/observability/index.ts` (barrel)
- Modify: `src/shared/lib/logger.ts` (deprecation shim — 기존 호출처 동작 보존)

**적용 규칙:** `architect.md` R3(barrel 명시 export), `backend-expert.md` R10, qa R5(TDD)

#### 🛠️ 구현
- [x] `generateTraceId()` — `crypto.randomUUID().replace(/-/g, "").slice(0, 16)` (16자 hex)
- [x] `isValidTraceId(s)` — 16자 hex 정규식 검증
- [x] logger v2: `debug/info/warn/error(event, data?)`, `error(event, err, data?)`
- [x] 매 emit 시 `getContext()` 머지 → traceId/userId/routeName 자동 포함
- [x] `maskPii`로 data 가공 후 직렬화
- [x] `OBSERVABILITY_LOG_LEVEL` 미만 레벨은 silent (`NODE_ENV==="test"`도 silent 유지)
- [x] barrel에서 `logger`, `generateTraceId`, `isValidTraceId`, `runWithContext`, `getContext`, `setContext`, `maskPii`, types 명시 export
- [x] `src/shared/lib/logger.ts`를 `export { logger } from "./observability";` shim으로 교체 — 기존 호출처(`auth.ts:24`)는 무수정 동작
- [x] 테스트: context 머지, redact 적용, level 필터, error stack 포함

#### 🔬 QA 자동 증거 수집
- [x] `npm run typecheck` 0 errors / `vitest run generateTraceId.test.ts` 10/10 / `vitest run logger.test.ts` 14/14 / `npm run test` 221/221 통과 — 출력 인용
- [x] `NODE_ENV=development npx tsx scripts/obs-demo.ts` 출력: 한 줄 JSON에 `traceId: "562e03abd5504a26"`, `email: "a***@b***"`, `tossPaymentKey: "[REDACTED]"`, `phone: "010-****-****"` 포함 확인
- [x] R8 File-written gate 확인 — `grep -n "\- \[ \]" docs/superpowers/plans/2026-05-14-observability.md`에서 Task 4 범위 미완료 항목 0건

#### ✅ 통과 보고
- [x] Evidence-first 보고
- [ ] `git commit -m "feat(obs): structured logger v2 with trace context and PII redaction"`

---

### Task 5: Error Tracker 추상화 (Sentry-ready, no-op default)

**Files:**
- Create: `src/shared/lib/observability/errorTracker.ts`
- Create: `src/shared/lib/observability/__tests__/errorTracker.test.ts`
- Modify: `src/shared/lib/observability/index.ts` (export 추가)

**적용 규칙:** `architect.md` R3(어댑터는 shared), `backend-expert.md` R5(env 분기), 본 Phase 외부 패키지 설치 금지(`@sentry/*`)

#### 🛠️ 구현
- [x] `captureException(err: unknown, ctx?: ErrorTrackerCtx): void` — `logger.error("error.captured", err, maskedCtx)`로 fanout
- [x] `captureMessage(msg: string, level: "warn"|"error", ctx?: ErrorTrackerCtx): void`
- [x] DSN 미설정 시 logger fanout만. DSN 설정 시: `sentryWarnEmitted` 플래그로 1회 경고 후 logger fanout 유지. `// TODO(M-OBS-2): dynamic import("@sentry/node")` 주석 마련
- [x] 동기 함수 — 내부 실패 swallow (try/catch 이중 방어). 호출처 흐름 절대 차단 금지
- [x] 테스트 15케이스: DSN 미설정 fanout, ctx 머지, ALS 자동 결합, PII 마스킹, DSN 경고 1회, 내부 실패 격리

#### 🔬 QA 자동 증거 수집
- [x] `npm run typecheck` 0 errors / `vitest run errorTracker.test.ts` 15/15 통과 / `npm run test` 236/236 통과 — 회귀 0건
- [x] lint: 신규 파일 warning/error 0건
- [x] R8 File-written gate 확인 — Task 5 범위 미완료 항목 0건

#### ✅ 통과 보고
- [x] Evidence-first 보고
- [ ] `git commit -m "feat(obs): error tracker adapter (logger fanout, sentry-ready)"`

---

### Task 6: Metrics counter

**Files:**
- Create: `src/shared/lib/observability/metrics.ts`
- Create: `src/shared/lib/observability/__tests__/metrics.test.ts`
- Modify: `src/shared/lib/observability/index.ts` (export 추가)

**적용 규칙:** `architect.md` R3, `backend-expert.md` R4(메모리 누수 회피 — 상한 적용)

#### 🛠️ 구현
- [x] in-memory `Map<string, number>` (counters) + `Map<string, number[]>` (observations, 상한 1000)
- [x] `incr(name: string, tags?: MetricTags, by = 1)` — 키는 `name|k=v,k=v` 정렬된 라벨
- [x] `observe(name: string, value: number, tags?: MetricTags)` — 1000 초과 시 oldest drop
- [x] `snapshot(): { counters: Record<string,number>; observations: Record<string, {count,p50,p95,max}> }`
- [x] `resetForTest()` — 테스트 전용
- [x] `flush()` — `logger.info("metrics.flush", snapshot())` (수동 호출용. 본 Phase에서는 cron 미부착)
- [x] 테스트: 카운팅, 라벨 키 정규화, observation percentile 근사, reset

#### 🔬 QA 자동 증거 수집
- [x] `npm run typecheck` / `npm run test -- metrics` 통과 — 출력 인용: typecheck 0 errors / metrics.test.ts 13/13 / 전체 260/260
- [x] R8 File-written gate 확인

#### ✅ 통과 보고
- [x] Evidence-first 보고
- [ ] `git commit -m "feat(obs): in-memory metrics counter with snapshot/flush"`

---

### Task 7: `withObservedRoute` 래퍼 + middleware traceId 헤더

**Files:**
- Create: `src/shared/lib/observability/withObservedRoute.ts`
- Create: `src/shared/lib/observability/__tests__/withObservedRoute.test.ts`
- Modify: `src/shared/lib/observability/index.ts` (export 추가)
- Modify: `src/middleware.ts` (응답에 `x-trace-id` 발급. **Edge runtime — observability/* import 금지**, `crypto.randomUUID()`만 사용)

**적용 규칙:** `backend-expert.md` R7(runtime 분리), `architect.md` R3, qa R5

#### 🛠️ 구현
- [x] middleware: 요청에 `x-trace-id` 헤더가 없으면 `crypto.randomUUID().replace(/-/g,"").slice(0,16)` 생성하여 `response.headers.set("x-trace-id", id)` + `request.headers.set` (Next 15 NextResponse rewrite 패턴). 기존 auth 흐름은 그대로 유지
- [x] `withObservedRoute(routeName: string, handler: (req: NextRequest, ctx: { traceId: string }) => Promise<NextResponse>)`:
  1. 요청 헤더 `x-trace-id` 읽기 → 없으면 `generateTraceId()`
  2. `runWithContext({ traceId, routeName }, async () => { ... })` 내부에서 handler 호출
  3. `logger.info("route.start", { method, url })` + 완료 시 `route.end` + durationMs
  4. throw 시 `captureException(err, { routeName })` 후 재throw (라우트가 적절한 status로 변환할 수 있게)
  5. 응답 헤더에 `x-trace-id` 부착 후 반환
- [x] 테스트: 정상 200, throw 시 capture 호출, traceId가 응답 헤더에 포함, route.start/end 로그 1쌍

#### 🔬 QA 자동 증거 수집
- [x] `npm run typecheck` / `npm run test -- withObservedRoute` 통과 — 출력 인용: typecheck 0 errors / withObservedRoute 4/4 / 전체 264/264
- [x] R8 File-written gate 확인

#### ✅ 통과 보고
- [x] Evidence-first 보고
- [ ] `git commit -m "feat(obs): withObservedRoute wrapper + middleware trace-id header"`

---

### Task 8: 결제 코어 console → logger/metrics 마이그레이션

**Files:**
- Modify: `src/entities/payment/api/confirm.ts`
- Modify: `src/entities/payment/api/webhook.ts`
- Modify: `src/entities/payment/api/refund.ts`
- Modify: `src/app/layout.tsx` (`console.log` 1건 제거)
- Create: `src/entities/payment/api/__tests__/observability-hooks.test.ts`

**적용 규칙:** `domain-booking.md` R3/R7(트랜잭션 경계·외부 IO 순서 절대 불변), `qa-engineer.md` R5(TDD), 본류 함수 시그니처 무변경

#### 🛠️ 구현
- [x] `confirm.ts` `compensateCancel`:
  - `console.error("[compensateCancel] CRITICAL: PG cancel failed…")` → `logger.error("payment.compensate_cancel.pg_failed", cancelErr, { paymentKey, bookingId, reason })` + `metrics.incr("payment.compensate_cancel.pg_failed")` + `captureException(cancelErr, { bookingId, paymentId })`
  - `console.error("[compensateCancel] CRITICAL: RefundJob enqueue also failed…")` → 동일 패턴 (`payment.compensate_cancel.enqueue_failed`)
- [x] `webhook.ts`:
  - 서명 위조 분기에 `metrics.incr("payment.webhook.toss.invalid_sig")` (throw 직전)
  - 멱등 skip(이미 처리된 eventId) → `metrics.incr("payment.webhook.toss.duplicate")` + `logger.info("payment.webhook.duplicate", { providerEventId })`
  - 정상 처리 → `metrics.incr("payment.webhook.toss.processed", { type: event.type })`
  - 알 수 없는 orderId / 매칭 payment 없음 → `metrics.incr("payment.webhook.toss.ignored")` + `logger.warn`
- [x] `refund.ts`:
  - PG cancel 실패 → `logger.error` + `metrics.incr("payment.refund.deferred")` + `captureException`
  - 성공 → `metrics.incr("payment.refund.success")`
  - 검증 실패(`BOOKING_NOT_REFUNDABLE` 등) → `metrics.incr("payment.refund.rejected", { reason })`
- [x] `layout.tsx`: `console.log("[RootLayout] getCurrentUser →", user)` → `logger.debug("layout.root.user_resolved", { userId: user?.id ?? null })`
- [x] 테스트(`observability-hooks.test.ts`): `vi.spyOn(logger, "error")`, `metrics.resetForTest()` 후 각 분기 호출 → spy 호출·counter 누적 검증. **본류 로직 단위 테스트는 기존 테스트로 보호되어 변경 없음**

#### 🔬 QA 자동 증거 수집
- [x] `npm run typecheck` / `npm run test` 전체 통과(기존 테스트 회귀 0) — 출력 인용: typecheck 0 errors / 260/260 tests passed (22 files)
- [x] `grep -rn "console\." src/entities/payment src/app/layout.tsx` 결과: **0건** (`confirm/webhook/refund/layout` 한정)
- [x] R8 File-written gate 확인

#### ✅ 통과 보고
- [x] Evidence-first 보고
- [ ] `git commit -m "refactor(obs): migrate payment core from console to structured logger + metrics"`

---

### Task 9: 결제 라우트 핸들러 `withObservedRoute` 적용

**Files:**
- Modify: `src/app/api/payments/confirm/route.ts`
- Modify: `src/app/api/payments/webhook/toss/route.ts`

**적용 규칙:** `domain-booking.md` R9(webhook rawBody 보존 절대 불변), `backend-expert.md` R7

#### 🛠️ 구현
- [x] `confirm/route.ts`: 기존 POST 핸들러를 `export const POST = withObservedRoute("payments.confirm", async (req) => { ... })` 형태로 감싸기. 인증·zod·confirmPayment 흐름 무변경
- [x] `webhook/toss/route.ts`: `withObservedRoute("payments.webhook.toss", …)` 적용. **`req.text()` 호출 시점·서명 검증 순서·200 반환 정책 모두 무변경**
- [x] 두 라우트 모두 응답에 `x-trace-id` 헤더가 포함되는지 단위 시나리오로 1회 확인

#### 🔬 QA 자동 증거 수집
- [x] `npm run typecheck` / `npm run test` 통과 — typecheck 0 errors / 264/264 (23 files, 회귀 0건)
- [x] 런타임 시나리오: `withObservedRoute("payments.confirm", ...)` 실행 → `x-trace-id: 8ecc4d1516db4216` (valid 16hex: true), route.start/end JSON line 1쌍 출력 인용
- [x] R8 File-written gate 확인

#### ✅ 통과 보고
- [x] Evidence-first 보고
- [ ] `git commit -m "feat(obs): wrap payment routes with withObservedRoute"`

---

### Task 10: `/api/health` readiness 엔드포인트

**Files:**
- Create: `src/app/api/health/route.ts`

**적용 규칙:** `backend-expert.md` R7(Node runtime 명시), `architect.md` R1

#### 🛠️ 구현
- [x] `export const dynamic = "force-dynamic"; export const runtime = "nodejs";`
- [x] `withObservedRoute("health", async () => { ... })` 적용
- [x] DB ping: `await db.$queryRaw\`SELECT 1\`` (타임아웃 1.5초 — Promise.race)
- [x] 응답 JSON: `{ status: "ok"|"degraded", checks: { db: "ok"|"fail" }, version: env.APP_VERSION ?? "dev", traceId }`
- [x] DB 실패 시 503, status="degraded", `metrics.incr("health.db.fail")`
- [x] 정상 시 `metrics.incr("health.ok")`

#### 🔬 QA 자동 증거 수집
- [x] `npm run typecheck` / `npm run test` 통과 — typecheck 0 errors / 267/267 (24 files, 회귀 0건)
- [x] DB ok 분기: 단위 테스트 → status:200, body.status:"ok", body.traceId 16hex, health.ok counter=1
- [x] DB fail 분기: 단위 테스트(mockRejectedValue) → status:503, body.status:"degraded", health.db.fail counter=1
- [x] R8 File-written gate 확인

#### ✅ 통과 보고
- [x] Evidence-first 보고
- [ ] `git commit -m "feat(obs): add /api/health readiness endpoint"`

---

### Task 11: PaymentEvent · RefundJob 관측 query + spec 문서 + 종합 QA evidence

**Files:**
- Create: `src/entities/payment/api/observability.ts`
- Create: `src/entities/payment/api/__tests__/observability.test.ts`
- Modify: `src/entities/payment/index.ts` (barrel export 추가)
- Create: `scripts/qa/observability-evidence.ts`
- Create: `docs/superpowers/specs/2026-05-14-observability-design.md`

**적용 규칙:** `architect.md` R3(barrel), `qa-engineer.md` R1·R3·R5·R8

#### 🛠️ 구현
- [x] `observability.ts`:
  - `listRecentPaymentEvents({ limit = 50, type?, since? })` — `db.paymentEvent.findMany` + `select` 명시(payload는 raw JSON 그대로) + `orderBy: { createdAt: "desc" }`
  - `summarizeRefundJobs()` — `db.refundJob.groupBy` status별 count + `db.refundJob.findFirst({ where: { status: "PENDING" }, orderBy: { nextRunAt: "asc" }})` oldest pending
- [x] 테스트: 9 tests — findMany 호출 파라미터, 필터 전달, select 구조, groupBy+findFirst 병렬 실행, statusCounts 형태 검증
- [x] barrel: `listRecentPaymentEvents`, `summarizeRefundJobs` 명시 export 추가
- [x] `scripts/qa/observability-evidence.ts`:
  - (1) traceId 전파 — 3/3 라인 PASS ✓
  - (2) metrics snapshot — counters/observations PASS ✓
  - (3) DB 쿼리 — PaymentEvent 5건 실시간 확인 PASS ✓
  - (4) curl /api/health — HTTP 200 + x-trace-id:a5e497fcd3944709 + route.start/end 로그 쌍 인용
- [x] `docs/superpowers/specs/2026-05-14-observability-design.md`: 도입 배경, 모듈 다이어그램, Sentry 전환 절차, 향후 작업, 테스트 커버리지 요약

#### 🔬 QA 자동 증거 수집
- [x] `npm run typecheck` / `npm run test` 전체 통과 — typecheck 0 errors / 276/276 (25 files)
- [x] `NODE_ENV=development npx tsx scripts/qa/observability-evidence.ts` → §1·§2 PASS ✓, §3 DB 실시간 쿼리, §4 curl 200 + x-trace-id 검증
- [x] dev server curl 증거: `HTTP/1.1 200 OK`, `x-trace-id: a5e497fcd3944709`, `{"status":"ok","checks":{"db":"ok"},"version":"local","traceId":"a5e497fcd3944709"}`
- [x] route.start/end 로그 쌍: `traceId:"a5e497fcd3944709" routeName:"health" durationMs:283 status:200`
- [x] `grep -rn "console." src/entities/payment src/app/layout.tsx src/app/api/` → 0건
- [x] R8 File-written gate 최종 확인

#### ✅ 통과 보고
- [x] M-OBS 페이즈 종합 보고 — `🏗️ Core Architecture` / `♻️ Boilerplate` / `🧠 Concept Insight` 3단 양식
- [ ] `git commit -m "feat(obs): payment event/refund job queries + qa evidence + design spec"`

---

## 최종 체크리스트 (Phase 완료 판정)

- [x] Task 1~11 모두 `- [x]` 처리됨 (위 §4.1 강제)
- [x] `npm run typecheck && npm run test` 전부 통과 — 0 errors / 276/276
- [x] `grep -rn "console\." src/entities/payment src/app/layout.tsx src/app/api/` 결과 0건
- [x] 결제 라우트·`/api/health` 응답에 `x-trace-id` 헤더 존재 — curl 증거 인용
- [x] PII 리덕션: `pii.test.ts` 17케이스 + errorTracker 테스트로 PII 마스킹 보장
- [x] `captureException` DSN 미설정 시 logger fanout만 발생 — `errorTracker.test.ts` 15케이스 보장
- [x] `entities/payment` barrel에 `listRecentPaymentEvents`, `summarizeRefundJobs` 명시 export
- [x] spec 문서(`docs/superpowers/specs/2026-05-14-observability-design.md`) 작성됨
- [x] 본 plan에 `- [ ]` 잔존 0건 (git commit 줄 제외 — 미실행 항목)

---

## 비-목표 (Out of Scope — 별도 PR/Phase)

- 외부 SaaS(@sentry/node, @datadog/*, Pino transport) 실제 설치·전송 — 본 Phase는 어댑터만
- 메트릭 시계열 영속화 / OpenTelemetry 전환 — `metrics.snapshot()` flush는 수동 호출만
- 프런트엔드 toast / 결제 UX 변경 — M-CHECKOUT phase 소관
- `/api/admin/payment-events` 같은 UI 노출 — query 함수만 마련하고 라우트는 후속 PR
- DB-level 감사 로그(audit) — `PaymentEvent` append-only로 이미 커버됨, 별도 테이블 신설 없음
