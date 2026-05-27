# Sentry SDK Wiring — Design Spec

- **작성일**: 2026-05-27
- **Phase**: 3 B2 (Operations Prep) — 1순위
- **상태**: Approved — implementation plan 작성 예정
- **관련 코드**: `src/shared/lib/observability/errorTracker.ts`, `src/shared/lib/env.ts`, `src/middleware.ts`, `src/app/**`
- **선행 ADR**: ADR-0014 (NO-REAL-MONEY env enforcement) — `superRefine` + `NEXT_PHASE` 분기 패턴의 선례
- **후속 ADR 예약**: "Sentry 채택 + sourcemap policy" (대안 비교 라운드 생략 사유 박제)

---

## 1. Overview

`errorTracker.ts` 어댑터는 *Sentry-ready* 상태(`// TODO(M-OBS-2)` 명시)로 박혀 있으나 실제 SDK(`@sentry/nextjs`)는 미설치다. 본 작업은 (a) Sentry SDK를 Next.js 15 + Vercel 환경에 **runtime-split**으로 도입하고, (b) `errorTracker`의 공개 API(`captureException`/`captureMessage`) 동기 시그니처를 깨지 않으면서 SDK fanout을 추가하며, (c) `SENTRY_AUTH_TOKEN`의 **런타임 노출을 부팅 단계에서 차단**하는 Zod 검증을 박는다.

PR이 끝나면 Phase 3 B2의 후속 작업(보안 헤더 B, Rate Limit C)이 모두 *관측되는 변경*으로 격상된다.

---

## 2. Goals / Non-Goals

### 2.1 Goals (In-Scope)

| # | Goal |
|---|---|
| G1 | `@sentry/nextjs` 도입 — Next 15 `instrumentation.ts` 표준 hook으로 Node/Edge 런타임 분리 init |
| G2 | `errorTracker.ts:48` `TODO(M-OBS-2)` 자리에 SDK fanout 주입 — 공개 동기 시그니처 유지 |
| G3 | `src/app/global-error.tsx` 신설 — root layout 사고 시 `<html><body>` 자체 렌더 + Sentry capture |
| G4 | sourcemap 자동 업로드 — `@sentry/nextjs` webpack plugin (build-time only) |
| G5 | env.ts 확장: `SENTRY_AUTH_TOKEN` / `SENTRY_ENVIRONMENT` / `SENTRY_RELEASE` 추가 + `superRefine`로 `AUTH_TOKEN` 런타임 노출 차단 |
| G6 | `errorTracker.test.ts`에 "SDK wired 시 `not_wired` warn 미발생" 회귀 케이스 추가 |
| G7 | `metrics` / `withObservedRoute` / ALS traceId 컨텍스트 자동 연동 — Sentry `setTag("traceId", ...)` 머지 |

### 2.2 Non-Goals (Out-of-Scope, 별 PR)

- Frontend performance traces (`tracesSampleRate > 0`, `BrowserTracing` integration)
- Session Replay / heatmap
- Slack / PagerDuty 알림 라우팅 (Sentry UI 설정 영역, 코드 외)
- 사용자 식별(`Sentry.setUser`) — 동의/PRD 정의 후 별 PR
- Sentry Cron monitoring (`/api/cron/*` ping) — `@sentry/nextjs` Cron API 도입은 후속

---

## 3. Baseline (현재 자산)

| 영역 | 자산 | 상태 |
|---|---|---|
| 어댑터 | `src/shared/lib/observability/errorTracker.ts` | ✅ 동기 함수, ALS 머지, PII 마스킹, DSN 감지 후 `not_wired` warn 1회 |
| Public API | `src/shared/lib/observability/index.ts` | ✅ `captureException` / `captureMessage` barrel export |
| Env schema | `src/shared/lib/env.ts` | ✅ `SENTRY_DSN`(url, preprocess 빈 문자열→undefined), `OBSERVABILITY_LOG_LEVEL`(enum), `APP_VERSION`(optional) |
| TraceID | `src/middleware.ts` | ✅ Edge에서 `x-trace-id` 발급/전파, `withObservedRoute`에서 ALS context로 머지 |
| PII | `src/shared/lib/observability/pii.ts` | ✅ 외부 전송 전 자동 마스킹 |
| 미구현 | `@sentry/*` 패키지 / `instrumentation.ts` / `global-error.tsx` / sourcemap pipeline | ❌ |

**핵심 제약**: `errorTracker.captureException`은 *동기 함수*다 — 호출처 흐름을 절대 차단하지 않는 어댑터 설계 원칙(`errorTracker.ts:5`). 따라서 SDK 호출도 동기 경로여야 하고, *lazy dynamic import*는 `register()` 시점 1회로 제한해야 한다.

---

## 4. Architecture

### 4.1 instrumentation.ts — Edge/Node 런타임 분기 dynamic import

Next 15는 `src/instrumentation.ts`의 `register()` export를 서버 cold start 1회 자동 호출한다. **Edge 번들 비대화를 막는 핵심 트릭**은 두 가지다:

1. **Runtime별 config 파일 격리** — `sentry.server.config.ts`(Node) / `sentry.edge.config.ts`(Edge)로 분리. 각 파일은 자신의 runtime에 필요한 integration만 import.
2. **register() 안에서만 dynamic import** — top-level import가 아니므로 *불필요한 runtime의 config는 번들에 포함되지 않는다*. webpack/turbopack의 dead-code-elimination이 `NEXT_RUNTIME` 분기 미사용 branch를 잘라낸다.

```ts
// src/instrumentation.ts
export async function register(): Promise<void> {
  // Next 15 표준 — NEXT_RUNTIME은 "nodejs" | "edge" | "experimental-edge"
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Next 15 표준 hook — request lifecycle 에러를 instrumentation.ts로 forwarding
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string; headers: Record<string, string> },
  ctx: { routerKind: "Pages Router" | "App Router"; routePath: string; routeType: string },
): Promise<void> {
  // @sentry/nextjs는 onRequestError를 자동 hook하지만, ALS context를 머지하기 위해
  // 어댑터 captureException으로 위임 — Sentry SDK fanout은 captureException 내부에서 발생
  const { captureException } = await import("@/shared/lib/observability");
  captureException(err, { route: ctx.routePath, method: request.method });
}
```

```ts
// src/sentry.server.config.ts (Node runtime)
import * as Sentry from "@sentry/nextjs";
import { env } from "@/shared/lib/env";

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    release: env.SENTRY_RELEASE ?? env.APP_VERSION,
    // tracesSampleRate 0 — performance traces는 별 PR (G2 non-goal)
    tracesSampleRate: 0,
    // PII는 이미 errorTracker.maskPii 단계에서 제거되지만 SDK 단에서도 이중 방어
    sendDefaultPii: false,
    // beforeSend로 ALS context 추가 머지 — captureException 우회 직접 호출 대비
    beforeSend(event) {
      return event;
    },
  });
}
```

```ts
// src/sentry.edge.config.ts (Edge runtime)
import * as Sentry from "@sentry/nextjs";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    // Edge SDK는 integrations 디폴트 최소 — Prisma/Node 전용 integration 자동 제외
  });
}
```

> **왜 Edge config는 `env`(Zod) 대신 `process.env`?** — `env.ts`가 Prisma adapter import를 통해 Node API에 transitively 묶일 수 있다(NextAuth `@auth/prisma-adapter` 경유). Edge 부팅 안정성을 위해 Edge config는 *bare process.env*를 직접 읽고, schema 검증은 Node runtime에서만 수행(이미 ADR-0001 middleware 패턴과 동일).

### 4.2 errorTracker.ts — SDK fanout 주입 (동기 시그니처 유지)

`@sentry/nextjs`는 top-level import해도 Next bundler가 *runtime-aware tree-shake*를 자동 수행한다(공식 SDK가 그렇게 빌드됨). 따라서 어댑터 안에서는 일반 import로 충분 — dynamic import는 4.1의 `register()` 1회로 이미 비용을 격리했다.

> **두 import 패턴의 역할 구분**:
> - **4.1 dynamic import** (`await import("./sentry.{node,edge}.config")`) — *서버 cold start 1회* SDK init을 runtime별로 격리해 **번들 split**(Edge 번들에 Node-only integration이 포함되지 않게).
> - **4.2 top-level import** (`import * as Sentry from "@sentry/nextjs"`) — *런타임 매 호출*에서 SDK를 동기로 호출하기 위함. SDK 본체는 이미 4.1에서 init 완료된 싱글톤이라 비용 0. 어댑터의 *동기 시그니처 제약*은 이 패턴으로만 충족 가능.

```ts
// src/shared/lib/observability/errorTracker.ts (변경 부분만)
import * as Sentry from "@sentry/nextjs";

export function captureException(err: unknown, ctx?: ErrorTrackerCtx): void {
  try {
    const merged = mergeAndMaskCtx(ctx);

    // SDK fanout — DSN 없으면 Sentry.init이 no-op이므로 captureException도 silent
    if (process.env.SENTRY_DSN) {
      Sentry.withScope((scope) => {
        // ALS traceId/userId/routeName을 Sentry tags로 머지 — 검색 가능
        for (const [k, v] of Object.entries(merged)) {
          if (typeof v === "string" || typeof v === "number") scope.setTag(k, v);
          else scope.setExtra(k, v);
        }
        if (err instanceof Error) Sentry.captureException(err);
        else Sentry.captureException(new Error(String(err)));
      });
    }

    // logger fanout은 항상 유지 — SDK 장애와 무관한 최후 방어선
    logger.error("error.captured", err, merged);
  } catch (internalErr) {
    // 기존 최후 방어선 그대로 보존
    try {
      logger.warn("errorTracker.internal_failure", { /* ... */ });
    } catch { /* noop */ }
  }
}
```

**제거 대상**: `notifySentryNotWired()` + `sentryWarnEmitted` 모듈 상태 + `_resetForTest()` export. 이들은 *Sentry 미연결 Phase*용 임시 코드였고, 본 PR에서 wiring이 끝나면 의미가 없다. `errorTracker.test.ts`의 관련 케이스도 함께 삭제 + "wired 시 SDK captureException이 호출된다" 신규 케이스로 대체(G6).

> **공개 시그니처 무변경 보장**: `captureException(err, ctx?)` / `captureMessage(msg, level, ctx?)` 동기 반환 유지. 호출처(`features/auth`, `app/api/payments`, `app/api/cron`, `withObservedRoute`)는 무수정.

### 4.3 global-error.tsx — root level catch + Sentry capture

Next 15 App Router는 root layout이 throw하면 `(site)/error.tsx`로 잡히지 않는다. `src/app/global-error.tsx`가 *유일한 마지막 그물*이고, *반드시 `<html><body>`까지 직접 렌더*해야 한다(root layout 자체가 실패했으므로 outer chrome이 없다).

```tsx
"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // root layout 사고 — Sentry로 직접 캡처 (errorTracker는 server-only barrel)
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="ko">
      <body>
        <main>
          <h1>예기치 못한 오류가 발생했습니다</h1>
          <p>잠시 후 다시 시도해주세요. 문제가 지속되면 고객센터로 문의해주세요.</p>
          <button onClick={() => reset()}>다시 시도</button>
        </main>
      </body>
    </html>
  );
}
```

> **왜 client component인데 `errorTracker`를 안 쓰는가?** — `errorTracker.ts`는 ALS(`async_hooks`)에 의존 → Node runtime 전용 / client 번들에서 깨진다. global-error는 `'use client'`라 *브라우저에서 실행*되는 마지막 fallback이므로 `@sentry/nextjs`의 isomorphic API(`Sentry.captureException`)를 직접 호출.

### 4.4 env.ts 확장 — SENTRY_AUTH_TOKEN 런타임 노출 차단

`SENTRY_AUTH_TOKEN`은 **sourcemap 업로드용 빌드 도구**(@sentry/nextjs webpack plugin)가 사용한다. *런타임 코드는 절대 참조해서는 안 된다* — 노출되면 모든 release/project의 sourcemap·dSYM upload 권한이 탈취된다.

방어 전략은 ADR-0014의 `NEXT_PHASE` 분기 패턴과 동일하게 **build phase 외 통과 차단**.

```ts
// src/shared/lib/env.ts (추가 부분만)
export const envSchema = z
  .object({
    // ... 기존 필드 ...
    SENTRY_AUTH_TOKEN: z.string().optional(),
    SENTRY_ENVIRONMENT: z.string().optional(),
    SENTRY_RELEASE: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    // ... 기존 검증 (NO-REAL-MONEY, OAuth pair, 등) ...

    // 🔐 SENTRY_AUTH_TOKEN: build-time only invariant.
    // - NEXT_PHASE=phase-production-build (Vercel 빌드 단계)에서만 통과 허용
    // - 그 외 runtime(serverless function cold start / edge)에서는 부재해야 함
    // - 잘못 주입되어 있으면 부팅 자체를 차단 → sourcemap upload key leak 방어선
    const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

    if (env.SENTRY_AUTH_TOKEN && !isBuildPhase) {
      ctx.addIssue({
        code: "custom",
        path: ["SENTRY_AUTH_TOKEN"],
        message:
          "SENTRY_AUTH_TOKEN은 빌드 단계(NEXT_PHASE=phase-production-build)에서만 " +
          "노출되어야 합니다. 런타임(serverless function / edge)에 주입되면 즉시 " +
          "부팅을 차단합니다 — Vercel 환경 변수의 'Build' scope만 체크하고 " +
          "'Production'·'Preview' runtime scope에서는 해제하세요. " +
          "(sourcemap upload token leak 방어 — ADR-0014 NEXT_PHASE 분기 패턴 참조)",
      });
    }
  });
```

**Vercel 운영 절차** (Notes에 박제 예정):
1. Project Settings → Environment Variables → `SENTRY_AUTH_TOKEN` 추가
2. **Scope 체크박스**: ✅ Build only (✗ Production runtime / ✗ Preview runtime)
3. 잘못 체크해 runtime에 노출 시 → 다음 deploy의 cold start에서 위 superRefine이 부팅 차단 → 503으로 즉시 노출 확인 가능

> **왜 schema에 *optional*로 두고 superRefine만 검증하는가?** — `SENTRY_AUTH_TOKEN`을 *required로 두면* 런타임 부팅이 무조건 차단된다(원했던 동작과 정반대). build phase 외에는 *부재가 정상*이고 *존재가 비정상*이므로 `optional + superRefine`가 맞는 표현.

### 4.5 sourcemap 업로드 파이프라인

`@sentry/nextjs`의 `withSentryConfig` wrapper를 `next.config.mjs`에 적용. wrapper는 build 단계에서만 webpack plugin을 활성화 → `SENTRY_AUTH_TOKEN`이 *빌드 호스트 process.env*로만 들어오면 동작.

```js
// next.config.mjs (변경 후)
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig = {
  images: { /* 기존 그대로 */ },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // sourcemap upload는 production build에서만 (preview 빌드도 가능 — 비용 trade-off)
  silent: !process.env.CI,
  // sourcemap을 클라이언트 번들에서 제거 (운영자만 Sentry에서 디코딩 가능)
  hideSourceMaps: true,
  // tunnel route로 ad-block 회피 — 옵션, 별 PR로 검토
  // tunnelRoute: "/monitoring",
});
```

> `SENTRY_ORG`/`SENTRY_PROJECT`는 비밀 아닌 식별자라 env schema에는 추가하지 않고 webpack plugin이 직접 읽음 (없으면 plugin이 silent skip).

---

## 5. PII / 보안 정책

| 방어선 | 위치 | 동작 |
|---|---|---|
| L1 — 어댑터 입구 | `errorTracker.mergeAndMaskCtx` | 기존 `maskPii` 호출 — 외부 전송 전 cardholder/email/token 등 리덕션 |
| L2 — SDK 단 | `Sentry.init({ sendDefaultPii: false })` | SDK가 자동 수집하는 IP/cookie/header에서 PII 차단 |
| L3 — 빌드 단 | `withSentryConfig({ hideSourceMaps: true })` | sourcemap을 클라이언트 번들에서 제거 — 운영자만 Sentry에서 stack frame 매핑 |
| L4 — 토큰 격리 | `superRefine` `SENTRY_AUTH_TOKEN` 런타임 부재 강제 | sourcemap upload key의 런타임 노출 자체를 차단 |

---

## 6. 테스트 전략

### 6.1 단위 테스트 (Vitest)

| 파일 | 케이스 |
|---|---|
| `errorTracker.test.ts` (수정) | (a) DSN 없을 때 SDK 호출 0회·logger fanout 1회 / (b) DSN 있을 때 `Sentry.captureException` 1회 + logger fanout 1회 / (c) Error 외 값을 `new Error(String(...))`로 wrap 검증 / (d) ALS context가 `scope.setTag`로 머지 검증 / (e) `not_wired` warn 케이스 *삭제* |
| `env.test.ts` (수정) | (a) `NEXT_PHASE=phase-production-build` + `SENTRY_AUTH_TOKEN=set` → parse 통과 / (b) `NEXT_PHASE=undefined` + `SENTRY_AUTH_TOKEN=set` → parse 실패 + 메시지 인용 검증 / (c) `SENTRY_AUTH_TOKEN`이 없을 땐 phase 무관 통과 |
| `instrumentation.test.ts` (신규) | `NEXT_RUNTIME` 분기로 server/edge config import 호출 검증 (mocked import) |

### 6.2 통합 검증 (QA Engineer R8 — 증거 기반)

| 검증 | 명령 | 기대 출력 |
|---|---|---|
| typecheck | `npm run typecheck` | exit 0 |
| 단위 | `npm run test` | 모든 케이스 PASS |
| 빌드 | `SENTRY_AUTH_TOKEN=xxx npm run build` | `Sentry CLI: uploaded N sourcemaps` 줄 인용 |
| 런타임 노출 차단 | `SENTRY_AUTH_TOKEN=xxx NODE_ENV=production node -e "require('./src/shared/lib/env')"` | 부팅 실패 + ZodError 메시지 인용 |
| global-error 동작 | dev에서 root layout throw 강제 → `Sentry.captureException` 호출 흔적 (mock 또는 Sentry dashboard) | 캡처 1건 확인 |

자동화 불가 항목: Sentry dashboard에서 실제 이벤트 도착 확인 — **운영자 수동 절차**로 plan에 명시.

---

## 7. 배포 / 운영 영향

### 7.1 번들 사이즈

- `@sentry/nextjs` 도입으로 server 번들 +~150KB (압축 전), Edge 번들 +~30KB (Edge SDK 경량). Vercel cold start latency 영향 < 50ms 예상.
- sourcemap 업로드는 build phase 1회 — 런타임 비용 0.

### 7.2 비용

- Sentry Developer 무료 plan: 5K events/month, 10K performance units. 초기 베타엔 충분.
- `tracesSampleRate: 0`으로 시작 — performance events 발생 0건.

### 7.3 NO-REAL-MONEY 호환성 (ADR-0014)

- Sentry는 *결제 경로에 외부 IO를 추가하지 않는다* — 비동기 큐잉 후 별 채널 전송. 결제 트랜잭션 안전성에 영향 0.
- `sendDefaultPii: false` + `maskPii`로 카드 번호·계좌 정보 등 결제 PII 외부 전송 차단.

---

## 8. Alternatives Considered (ADR-0021 후보 자료)

### 옵션 A: **Sentry SDK 전면 도입** ✅ 채택
- 채택 이유: 어댑터(`errorTracker.ts`)가 *Sentry-ready*로 박혀 있어 전환 cost ~0. Next.js / Vercel 생태계에서 가장 검증된 솔루션. `withSentryConfig` wrapper로 sourcemap pipeline까지 한 PR에서 종결.

### 옵션 B: Better Stack (Logtail + Uptime) — 거부
- 거부 이유: log aggregation 중심이라 *예외 컨텍스트(stack frame, breadcrumb, scope tags)* 1급 기능 부족. 어댑터 재설계 필요.

### 옵션 C: Highlight.io (open-source self-host 가능) — 거부
- 거부 이유: 셀프호스트는 운영 부담(인스턴스/스토리지/업데이트). SaaS plan은 Sentry 대비 가격 우위 없음. Next 15 sourcemap 통합 성숙도 부족.

### 옵션 D: Vercel OTEL + Grafana Cloud — 거부
- 거부 이유: traces/metrics 강점이지만 *예외 추적 UX*가 Sentry 대비 약함. OTEL → Grafana → 알림 라우팅까지 셋업 부담 큼. Phase 3 B2의 "마지막 1마일" 정신과 부정합.

### 옵션 E: Datadog APM — 거부
- 거부 이유: 비용 + 학습 곡선. 무료 plan이 사실상 사용 불가.

### 옵션 F: 자체 구현 (logger fanout만 유지) — 거부
- 거부 이유: 어댑터 인터페이스(`captureException`)가 *Sentry breadcrumb·scope·release/environment* 기능을 전제로 설계됐다. 자체 구현은 결국 Sentry의 90%를 다시 짜는 일.

> **ADR-0021 발행 약속**: 본 PR 완료 후 위 비교 매트릭스를 ADR로 박제 (사용자 결정사항).

---

## 9. Implementation Outline (writing-plans skill로 확장 예정)

체크박스 plan은 다음 턴에서 `writing-plans` 스킬로 작성. 본 spec은 *무엇을 만들지*까지, plan은 *어떤 순서·증거로 만들지*까지 책임.

대략적 Task 분해 (참고용):

1. **Task 1** — `@sentry/nextjs` install + `next.config.mjs` `withSentryConfig` 래핑
2. **Task 2** — `instrumentation.ts` + `sentry.server.config.ts` + `sentry.edge.config.ts` 추가
3. **Task 3** — `env.ts` 확장 + `SENTRY_AUTH_TOKEN` superRefine 검증 + `env.test.ts` 케이스 3건 (TDD)
4. **Task 4** — `errorTracker.ts` SDK fanout 주입 + `not_wired` 경로 제거 + `errorTracker.test.ts` 갱신 (TDD)
5. **Task 5** — `src/app/global-error.tsx` 신설
6. **Task 6** — QA 통합 검증 (typecheck/test/build/런타임 차단 증거 수집) + plan 체크박스 갱신
7. **Task 7** — ADR-0021 작성 (옵션 A~F 비교 박제)

---

## 10. Notes / Out-of-Scope

- **별 PR 후보**: BrowserTracing / Session Replay / `Sentry.setUser` / Cron monitoring / Slack-PagerDuty 라우팅
- **Vercel 운영 체크리스트** (배포 직전 plan Task 6에 포함): `SENTRY_AUTH_TOKEN` scope가 'Build only'로 한정됐는지 UI 캡처 1회, `SENTRY_ENVIRONMENT`는 환경별로 분기(`production`/`preview`/`development`)
- **모니터링 후보 지표**: Sentry events/day, p95 capture latency, sourcemap upload success rate (CI step exit code)
- **6개월 뒤 의심받을 가능성**: (a) `tracesSampleRate: 0`이라 performance 가시성 없음 — 트래픽 증가 시 재검토 / (b) `withSentryConfig`의 `hideSourceMaps: true` 가 디버깅 어렵게 만들 가능성 — Sentry에서 풀려야 함
