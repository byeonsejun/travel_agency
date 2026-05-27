# Sentry SDK Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@sentry/nextjs` SDK를 Next 15 + Vercel 환경에 runtime-split으로 도입하고, `errorTracker.ts` 어댑터의 동기 시그니처를 깨지 않으면서 SDK fanout을 주입하며, `SENTRY_AUTH_TOKEN`의 런타임 노출을 부팅 단계에서 차단한다.

**Architecture:** `instrumentation.ts`의 `register()`에서 `NEXT_RUNTIME` 분기로 `sentry.{server,edge}.config.ts`를 dynamic import (cold start 1회, 번들 split). 어댑터 본체(`errorTracker.ts`)는 top-level import로 SDK 싱글톤을 동기 참조하여 공개 API 시그니처 무변경. `SENTRY_AUTH_TOKEN`은 `superRefine`에서 `NEXT_PHASE=phase-production-build` 외 부팅 시 fail-fast (ADR-0014 패턴 재사용).

**Tech Stack:** `@sentry/nextjs` (Sentry SDK), Next.js 15 App Router, Zod 3 (env superRefine), Vitest 2 + happy-dom (테스트), TypeScript strict.

**선행 spec:** [`docs/superpowers/specs/2026-05-27-sentry-wiring-design.md`](../specs/2026-05-27-sentry-wiring-design.md)

---

## File Structure

**신규 파일:**
- `src/instrumentation.ts` — Next 15 표준 register() hook, NEXT_RUNTIME 분기 dynamic import
- `src/sentry.server.config.ts` — Node runtime용 Sentry.init
- `src/sentry.edge.config.ts` — Edge runtime용 Sentry.init (bare process.env)
- `src/app/global-error.tsx` — root layout 사고 시 fallback + Sentry.captureException
- `src/__tests__/instrumentation.test.ts` — NEXT_RUNTIME 분기 검증
- `docs/superpowers/adr/0021-sentry-sdk-adoption.md` — 채택 결정 박제 (대안 5종 거부 사유)

**수정 파일:**
- `package.json` — `@sentry/nextjs` dependency 추가
- `next.config.mjs` — `withSentryConfig` wrapper 래핑
- `src/shared/lib/env.ts` — 3 env keys + `SENTRY_AUTH_TOKEN` runtime exposure superRefine
- `src/shared/lib/__tests__/env.test.ts` — superRefine 3 케이스 추가
- `src/shared/lib/observability/errorTracker.ts` — SDK fanout 주입, `not_wired` 경로 제거
- `src/shared/lib/observability/__tests__/errorTracker.test.ts` — SDK 호출 검증 케이스, `not_wired` 케이스 삭제

---

## Task 1: `@sentry/nextjs` install + `next.config.mjs` 래핑

**Files:**
- Modify: `package.json`
- Modify: `next.config.mjs`

- [ ] **Step 1: `@sentry/nextjs` 패키지 설치**

Run:
```bash
npm install @sentry/nextjs@^8
```

Expected: `package.json`의 `dependencies`에 `"@sentry/nextjs": "^8.x.x"` 추가, `package-lock.json` 업데이트, 부수 의존성(`@sentry/core`, `@sentry/node`, `@sentry/browser` 등) 설치.

- [ ] **Step 2: 설치 검증 — typecheck 통과 확인**

Run:
```bash
npm run typecheck
```

Expected: exit 0. 새 패키지 도입으로 typecheck가 깨지지 않음.

- [ ] **Step 3: `next.config.mjs`를 `withSentryConfig`로 래핑**

`next.config.mjs` 전체 교체:

```js
/** @type {import('next').NextConfig} */
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
      {
        protocol: "https",
        hostname: "picsum.photos",
      },
    ],
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  hideSourceMaps: true,
});
```

> `SENTRY_ORG` / `SENTRY_PROJECT`는 비밀 아닌 식별자라 `env.ts` schema에 추가하지 않고 wrapper가 직접 읽음 (미설정 시 plugin이 silent skip).

- [ ] **Step 4: build 통과 확인**

Run:
```bash
SENTRY_AUTH_TOKEN= npm run build
```

Expected: build success. `SENTRY_AUTH_TOKEN`이 빈 값이라 sourcemap 업로드는 skip되지만 webpack plugin은 로드된다. `Sentry CLI` 관련 경고가 stderr에 나와도 exit 0.

- [ ] **Step 5: 커밋**

```bash
git add package.json package-lock.json next.config.mjs
git commit -m "feat(obs): install @sentry/nextjs + withSentryConfig wrapper (B2-A Task 1)"
```

---

## Task 2: `instrumentation.ts` + Node/Edge config 파일 분리

**Files:**
- Create: `src/instrumentation.ts`
- Create: `src/sentry.server.config.ts`
- Create: `src/sentry.edge.config.ts`
- Create: `src/__tests__/instrumentation.test.ts`

- [ ] **Step 1: instrumentation 분기 검증 테스트 작성**

`src/__tests__/instrumentation.test.ts` 신규 작성:

```ts
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

describe("instrumentation.register — NEXT_RUNTIME 분기", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("../sentry.server.config");
    vi.doUnmock("../sentry.edge.config");
  });

  it("NEXT_RUNTIME=nodejs 일 때 sentry.server.config만 import", async () => {
    const serverInit = vi.fn();
    const edgeInit = vi.fn();
    vi.doMock("../sentry.server.config", () => ({ default: serverInit() }));
    vi.doMock("../sentry.edge.config", () => ({ default: edgeInit() }));

    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const { register } = await import("../instrumentation");
    await register();

    expect(serverInit).toHaveBeenCalledTimes(1);
    expect(edgeInit).not.toHaveBeenCalled();
  });

  it("NEXT_RUNTIME=edge 일 때 sentry.edge.config만 import", async () => {
    const serverInit = vi.fn();
    const edgeInit = vi.fn();
    vi.doMock("../sentry.server.config", () => ({ default: serverInit() }));
    vi.doMock("../sentry.edge.config", () => ({ default: edgeInit() }));

    vi.stubEnv("NEXT_RUNTIME", "edge");
    const { register } = await import("../instrumentation");
    await register();

    expect(edgeInit).toHaveBeenCalledTimes(1);
    expect(serverInit).not.toHaveBeenCalled();
  });

  it("NEXT_RUNTIME 미정의 — 어느 config도 import하지 않음", async () => {
    const serverInit = vi.fn();
    const edgeInit = vi.fn();
    vi.doMock("../sentry.server.config", () => ({ default: serverInit() }));
    vi.doMock("../sentry.edge.config", () => ({ default: edgeInit() }));

    vi.stubEnv("NEXT_RUNTIME", "");
    const { register } = await import("../instrumentation");
    await register();

    expect(serverInit).not.toHaveBeenCalled();
    expect(edgeInit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 테스트 실행 — FAIL 확인**

Run:
```bash
npm run test -- src/__tests__/instrumentation.test.ts
```

Expected: FAIL — `Cannot find module '../instrumentation'`.

- [ ] **Step 3: `src/sentry.server.config.ts` 작성 (Node runtime)**

```ts
/**
 * sentry.server.config.ts — Node runtime용 Sentry.init.
 *
 * instrumentation.ts의 register()에서 NEXT_RUNTIME=nodejs 분기로 dynamic import된다.
 * top-level side-effect (Sentry.init)만 수행하고 default export는 두지 않는다.
 */

import * as Sentry from "@sentry/nextjs";
import { env } from "@/shared/lib/env";

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    release: env.SENTRY_RELEASE ?? env.APP_VERSION,
    // performance traces — 별 PR (Phase 3 B2 non-goal)
    tracesSampleRate: 0,
    // PII는 errorTracker.maskPii로 1차 제거, SDK 단에서 이중 방어
    sendDefaultPii: false,
  });
}
```

- [ ] **Step 4: `src/sentry.edge.config.ts` 작성 (Edge runtime)**

```ts
/**
 * sentry.edge.config.ts — Edge runtime용 Sentry.init.
 *
 * Edge 부팅 안정성을 위해 env.ts(Zod) 의존성을 우회하고 bare process.env만 사용
 * (env.ts는 Prisma adapter 등 Node API에 transitively 묶일 수 있어 Edge에서 부팅 실패 위험).
 */

import * as Sentry from "@sentry/nextjs";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
}
```

- [ ] **Step 5: `src/instrumentation.ts` 작성**

```ts
/**
 * instrumentation.ts — Next 15 표준 register() hook.
 *
 * 서버 cold start 1회 자동 호출. NEXT_RUNTIME 분기로 sentry.{server,edge}.config를
 * dynamic import하여 Edge 번들에 Node-only integration이 섞이지 않게 격리한다.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

/**
 * Next 15 표준 hook — request lifecycle 에러를 instrumentation으로 forwarding.
 * @sentry/nextjs가 자동 hook하지만, ALS context를 머지하기 위해 어댑터로 위임.
 */
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string; headers: Record<string, string> },
  ctx: { routerKind: "Pages Router" | "App Router"; routePath: string; routeType: string },
): Promise<void> {
  const { captureException } = await import("@/shared/lib/observability");
  captureException(err, { route: ctx.routePath, method: request.method });
}
```

- [ ] **Step 6: 테스트 실행 — PASS 확인**

Run:
```bash
npm run test -- src/__tests__/instrumentation.test.ts
```

Expected: PASS (3 케이스 모두).

- [ ] **Step 7: typecheck 통과 확인**

Run:
```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 8: 커밋**

```bash
git add src/instrumentation.ts src/sentry.server.config.ts src/sentry.edge.config.ts src/__tests__/instrumentation.test.ts
git commit -m "feat(obs): instrumentation.ts + Node/Edge sentry configs (B2-A Task 2)"
```

---

## Task 3: env.ts 확장 + `SENTRY_AUTH_TOKEN` runtime exposure superRefine

**Files:**
- Modify: `src/shared/lib/env.ts`
- Modify: `src/shared/lib/__tests__/env.test.ts`

- [ ] **Step 1: env.test.ts에 SENTRY_AUTH_TOKEN 검증 3 케이스 추가 (TDD)**

`src/shared/lib/__tests__/env.test.ts` 파일 *맨 끝*에 신규 describe 블록 추가:

```ts
describe("envSchema — SENTRY_AUTH_TOKEN runtime exposure 차단 (build-only invariant)", () => {
  const originalNextPhase = process.env.NEXT_PHASE;

  afterEach(() => {
    if (originalNextPhase === undefined) delete process.env.NEXT_PHASE;
    else process.env.NEXT_PHASE = originalNextPhase;
  });

  it("NEXT_PHASE=phase-production-build + SENTRY_AUTH_TOKEN 설정 → parse 통과", () => {
    process.env.NEXT_PHASE = "phase-production-build";
    const result = envSchema.safeParse({
      ...validBase,
      SENTRY_AUTH_TOKEN: "sntrys_xxxxxxxxxxxxxxxx",
    });
    expect(result.success).toBe(true);
  });

  it("NEXT_PHASE 미설정 + SENTRY_AUTH_TOKEN 설정 → parse 실패 (런타임 노출 차단)", () => {
    delete process.env.NEXT_PHASE;
    const result = envSchema.safeParse({
      ...validBase,
      SENTRY_AUTH_TOKEN: "sntrys_xxxxxxxxxxxxxxxx",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path[0] === "SENTRY_AUTH_TOKEN",
      );
      expect(issue).toBeDefined();
      expect(issue?.message).toContain("phase-production-build");
    }
  });

  it("SENTRY_AUTH_TOKEN 부재 → NEXT_PHASE 무관 통과", () => {
    delete process.env.NEXT_PHASE;
    const result = envSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });
});
```

> `afterEach`는 vitest의 `afterEach` import가 필요. 파일 상단 import 구문에 누락됐다면 `import { afterEach, describe, expect, it } from "vitest";`로 추가.

- [ ] **Step 2: 테스트 실행 — FAIL 확인**

Run:
```bash
npm run test -- src/shared/lib/__tests__/env.test.ts
```

Expected: FAIL — 3 케이스 모두 `SENTRY_AUTH_TOKEN` schema 키가 없거나 superRefine 미구현이라 동작 안 함.

- [ ] **Step 3: env.ts에 3 env keys + superRefine 블록 추가**

`src/shared/lib/env.ts`의 `z.object({...})` 본문, `CRON_SECRET` 줄 *바로 아래*에 추가:

```ts
    // M-OBS-2: Sentry SDK 운영 env (Phase 3 B2-A).
    // SENTRY_AUTH_TOKEN은 sourcemap upload용 build-only 비밀 — 런타임 노출 차단을 superRefine에서 강제.
    SENTRY_AUTH_TOKEN: z.string().optional(),
    SENTRY_ENVIRONMENT: z.string().optional(),
    SENTRY_RELEASE: z.string().optional(),
```

그리고 `.superRefine((env, ctx) => {...})` 본문의 *마지막 블록 아래*(NODE_ENV=test 분기 다음)에 추가:

```ts
    // 🔐 SENTRY_AUTH_TOKEN: build-time only invariant.
    // - NEXT_PHASE=phase-production-build (Vercel 빌드 단계)에서만 통과 허용
    // - 그 외 runtime(serverless function cold start / edge)에서는 부재해야 함
    // - 잘못 주입되어 있으면 부팅 자체를 차단 → sourcemap upload key leak 방어선
    const isBuildPhaseForAuth =
      process.env.NEXT_PHASE === "phase-production-build";

    if (env.SENTRY_AUTH_TOKEN && !isBuildPhaseForAuth) {
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
```

> 변수명을 `isBuildPhaseForAuth`로 둔 이유: 기존 블록 상단의 `isBuildPhase` 상수와 동일 의미지만 *블록 스코프 격리*를 명시 (cross-block 의존 차단). 동일 변수명 재사용 시 lint shadowing 경고 가능.

- [ ] **Step 4: 테스트 실행 — PASS 확인**

Run:
```bash
npm run test -- src/shared/lib/__tests__/env.test.ts
```

Expected: PASS (신규 3 케이스 + 기존 모든 케이스).

- [ ] **Step 5: typecheck 통과 확인**

Run:
```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 6: 커밋**

```bash
git add src/shared/lib/env.ts src/shared/lib/__tests__/env.test.ts
git commit -m "feat(env): SENTRY_AUTH_TOKEN runtime exposure 차단 + SENTRY_ENVIRONMENT/RELEASE 추가 (B2-A Task 3)"
```

---

## Task 4: errorTracker.ts SDK fanout 주입 + `not_wired` 경로 제거

**Files:**
- Modify: `src/shared/lib/observability/errorTracker.ts`
- Modify: `src/shared/lib/observability/__tests__/errorTracker.test.ts`

- [ ] **Step 1: errorTracker.test.ts에 SDK fanout 검증 케이스 추가 (TDD)**

`src/shared/lib/observability/__tests__/errorTracker.test.ts` 파일 *맨 끝*에 신규 describe 블록 추가:

```ts
describe("captureException — DSN 설정 시 Sentry SDK fanout (B2-A)", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let sentryCaptureSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("SENTRY_DSN", "https://test-key@sentry.io/12345");
    errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});

    const Sentry = await import("@sentry/nextjs");
    sentryCaptureSpy = vi
      .spyOn(Sentry, "captureException")
      .mockImplementation(() => "test-event-id");
    // withScope는 콜백을 동기로 즉시 실행하도록 stub
    vi.spyOn(Sentry, "withScope").mockImplementation((cb) => {
      cb({
        setTag: vi.fn(),
        setExtra: vi.fn(),
      } as never);
      return "test-event-id" as never;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("Sentry.captureException이 1회 호출되고 logger.error도 fanout 유지", () => {
    const err = new Error("boom");
    captureException(err, { route: "/api/test" });

    expect(sentryCaptureSpy).toHaveBeenCalledTimes(1);
    expect(sentryCaptureSpy).toHaveBeenCalledWith(err);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toBe("error.captured");
  });

  it("Error 아닌 값은 new Error(String(...))로 wrap되어 캡처", () => {
    captureException("string-error", { route: "/api/test" });

    expect(sentryCaptureSpy).toHaveBeenCalledTimes(1);
    const captured = sentryCaptureSpy.mock.calls[0][0];
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toBe("string-error");
  });

  it("not_wired warn은 더 이상 발생하지 않음 (SDK가 wired된 Phase)", () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    captureException(new Error("boom"));

    const notWiredCalls = warnSpy.mock.calls.filter(
      (c) => c[0] === "errorTracker.sentry.not_wired",
    );
    expect(notWiredCalls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 기존 "not_wired" 검증 케이스 삭제**

`src/shared/lib/observability/__tests__/errorTracker.test.ts`에서 다음 describe 블록을 *완전히 삭제*:

```ts
// 삭제 대상: "captureException — DSN 설정 시 not_wired warn" 또는 유사 이름의 블록
// 검증 축 6, 7 (DSN 설정 시 logger.warn("errorTracker.sentry.not_wired") + 1회만)
```

파일 상단 주석의 검증 축 목록(`* 6. DSN 설정 시 logger.warn(...)`, `* 7. DSN 설정 시 warn은 여러 번 호출해도 1회만 발생`) 두 줄도 함께 제거하고, `_resetForTest` import도 다른 곳에서 더 이상 쓰이지 않으면 제거.

- [ ] **Step 3: 테스트 실행 — FAIL 확인**

Run:
```bash
npm run test -- src/shared/lib/observability/__tests__/errorTracker.test.ts
```

Expected: FAIL — Sentry SDK가 실제로 호출되지 않으므로 새 케이스 3건 모두 실패. 또한 `_resetForTest` 제거로 다른 케이스에서도 컴파일/실행 에러 가능.

- [ ] **Step 4: errorTracker.ts SDK fanout 주입**

`src/shared/lib/observability/errorTracker.ts` 전체를 다음으로 교체:

```ts
/**
 * errorTracker.ts — Error Tracking 어댑터 (Sentry-wired, Phase 3 B2-A).
 *
 * 설계 원칙:
 *  - **동기 함수** — 내부 실패를 swallow하여 호출처 흐름을 절대 차단하지 않는다.
 *  - **ALS 자동 머지** — `getContext()`로 traceId/userId/routeName을 자동 결합한다.
 *  - **PII 방어** — 외부 전송(Sentry) 전 `maskPii`로 민감 정보를 리덕션한다.
 *  - **SDK fanout** — SENTRY_DSN 설정 시 `@sentry/nextjs`로 forwarding (instrumentation.ts에서 init 완료된 싱글톤 동기 참조).
 *  - **Server-only** — 이 모듈은 ALS(async_hooks) 의존이라 client 번들에서 import 금지. 클라이언트는 @sentry/nextjs를 직접 호출 (예: app/global-error.tsx).
 */

import * as Sentry from "@sentry/nextjs";
import type { ErrorTrackerCtx } from "./types";
import { logger } from "./logger";
import { getContext } from "./context";
import { maskPii } from "./pii";

/**
 * ALS 컨텍스트와 추가 ctx를 병합한 뒤 PII를 마스킹하여 반환한다.
 *
 * 병합 우선순위: ctx > ALS getContext()
 * extras는 별도 키로 보존되어 Sentry breadcrumb용으로 사용된다.
 */
function mergeAndMaskCtx(ctx?: ErrorTrackerCtx): Record<string, unknown> {
  const alsCtx = getContext() ?? {};
  const { extras, ...ctxBase } = ctx ?? {};

  const merged: Record<string, unknown> = {
    ...alsCtx,
    ...ctxBase,
    ...(extras !== undefined ? { extras } : {}),
  };

  return maskPii(merged) as Record<string, unknown>;
}

/**
 * 머지된 context를 Sentry scope에 머지한다.
 * string/number는 setTag(검색 가능), 그 외는 setExtra(payload 저장).
 */
function applyScope(
  scope: Sentry.Scope,
  merged: Record<string, unknown>,
): void {
  for (const [k, v] of Object.entries(merged)) {
    if (typeof v === "string" || typeof v === "number") {
      scope.setTag(k, v);
    } else {
      scope.setExtra(k, v);
    }
  }
}

/**
 * 예외를 캡처한다.
 *
 * - SENTRY_DSN 설정 시: Sentry.withScope로 ALS context를 머지한 뒤 captureException + logger.error fanout
 * - SENTRY_DSN 미설정: logger.error만 fanout (Sentry.init이 no-op이므로 안전하게도 SDK 호출 가능하지만 분기로 명시)
 */
export function captureException(err: unknown, ctx?: ErrorTrackerCtx): void {
  try {
    const merged = mergeAndMaskCtx(ctx);

    if (process.env.SENTRY_DSN) {
      Sentry.withScope((scope) => {
        applyScope(scope, merged);
        const errAsError = err instanceof Error ? err : new Error(String(err));
        Sentry.captureException(errAsError);
      });
    }

    // logger fanout은 항상 유지 — SDK 장애와 무관한 최후 방어선
    logger.error("error.captured", err, merged);
  } catch (internalErr) {
    try {
      logger.warn("errorTracker.internal_failure", {
        internalErrorMessage:
          internalErr instanceof Error ? internalErr.message : String(internalErr),
      });
    } catch {
      // 최후 방어선 — 로거 자체가 실패한 경우. 더 이상 할 수 있는 게 없다.
    }
  }
}

/**
 * 메시지를 캡처한다.
 *
 * - level "error": Sentry.captureMessage + logger.error fanout
 * - level "warn": Sentry.captureMessage(level: "warning") + logger.warn fanout
 */
export function captureMessage(
  msg: string,
  level: "warn" | "error",
  ctx?: ErrorTrackerCtx,
): void {
  try {
    const merged = mergeAndMaskCtx(ctx);

    if (process.env.SENTRY_DSN) {
      Sentry.withScope((scope) => {
        applyScope(scope, merged);
        Sentry.captureMessage(msg, level === "error" ? "error" : "warning");
      });
    }

    if (level === "error") {
      logger.error("message.captured", msg, merged);
    } else {
      logger.warn("message.captured", { message: msg, ...merged });
    }
  } catch (internalErr) {
    try {
      logger.warn("errorTracker.internal_failure", {
        internalErrorMessage:
          internalErr instanceof Error ? internalErr.message : String(internalErr),
      });
    } catch {
      // 최후 방어선
    }
  }
}
```

> `_resetForTest` export 제거: `sentryWarnEmitted` 모듈 상태가 사라졌으므로 reset 대상도 없다. 테스트 파일에서 import 라인도 함께 제거 필요.

- [ ] **Step 5: 테스트 실행 — PASS 확인**

Run:
```bash
npm run test -- src/shared/lib/observability/__tests__/errorTracker.test.ts
```

Expected: PASS — 기존 케이스(DSN 미설정 fanout, ctx 머지, ALS, PII 마스킹, captureMessage 라우팅, internal 실패 swallow) + 신규 SDK fanout 3 케이스 모두.

- [ ] **Step 6: typecheck 통과 확인**

Run:
```bash
npm run typecheck
```

Expected: exit 0. `_resetForTest` 제거로 인한 import 에러는 Step 2에서 처리됐어야 함 — 남아 있으면 호출처 모두 제거.

- [ ] **Step 7: 커밋**

```bash
git add src/shared/lib/observability/errorTracker.ts src/shared/lib/observability/__tests__/errorTracker.test.ts
git commit -m "feat(obs): errorTracker SDK fanout 주입 + not_wired 경로 제거 (B2-A Task 4)"
```

---

## Task 5: `src/app/global-error.tsx` 신설 (root layout 사고 fallback)

**Files:**
- Create: `src/app/global-error.tsx`

- [ ] **Step 1: `src/app/global-error.tsx` 작성**

```tsx
"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

/**
 * global-error.tsx — root layout 사고 시 유일한 fallback.
 *
 * Next 15 App Router 사양: root layout이 throw하면 (site)/error.tsx로 잡히지 않는다.
 * 이 컴포넌트는 outer chrome(<html><body>)이 부재한 상황을 가정하므로 반드시 직접 렌더.
 *
 * errorTracker(server-only, ALS 의존) 대신 @sentry/nextjs의 isomorphic API를 직접 호출.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="ko">
      <body>
        <main
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "2rem",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>
            예기치 못한 오류가 발생했습니다
          </h1>
          <p style={{ color: "#666", marginBottom: "1.5rem" }}>
            잠시 후 다시 시도해주세요. 문제가 지속되면 고객센터로 문의해주세요.
          </p>
          <button
            onClick={() => reset()}
            style={{
              padding: "0.5rem 1rem",
              border: "1px solid #333",
              borderRadius: "4px",
              background: "#fff",
              cursor: "pointer",
            }}
          >
            다시 시도
          </button>
        </main>
      </body>
    </html>
  );
}
```

> **인라인 스타일 채택 이유**: global-error는 root layout이 터진 상태라 *Tailwind 처리 자체가 실패했을 수 있음*. inline style은 외부 의존 0인 최후 fallback. `(site)/error.tsx`(정상 처리 경로)에서는 Tailwind 사용 가능.

- [ ] **Step 2: typecheck 통과 확인**

Run:
```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 3: build 통과 확인 — global-error가 client 번들에 포함됨을 확인**

Run:
```bash
SENTRY_AUTH_TOKEN= npm run build
```

Expected: build success. 빌드 로그에 `/global-error` 또는 `_error` 라우트가 client component로 처리됨이 확인되어야 한다 (stderr 경고 없음).

- [ ] **Step 4: 커밋**

```bash
git add src/app/global-error.tsx
git commit -m "feat(app): global-error.tsx root layout fallback + Sentry capture (B2-A Task 5)"
```

---

## Task 6: 통합 검증 + plan 체크박스 일괄 갱신 (QA Engineer R1·R8)

**Files:**
- Modify: `docs/superpowers/plans/2026-05-27-sentry-wiring.md` (체크박스 갱신)

- [ ] **Step 1: 전체 typecheck**

Run:
```bash
npm run typecheck
```

Expected: exit 0. 출력 전체 인용 가능해야 함 — 실패하면 호출처(예: features/auth/server/auth.ts에서 errorTracker import) 점검.

- [ ] **Step 2: 전체 단위 테스트**

Run:
```bash
npm run test
```

Expected: 모든 테스트 PASS. 특히 신규/수정 케이스:
- `src/__tests__/instrumentation.test.ts` (3 케이스)
- `src/shared/lib/__tests__/env.test.ts`의 SENTRY_AUTH_TOKEN describe (3 케이스)
- `src/shared/lib/observability/__tests__/errorTracker.test.ts`의 SDK fanout describe (3 케이스)

- [ ] **Step 3: lint 통과**

Run:
```bash
npm run lint
```

Expected: exit 0. 신규 파일에 ESLint 위반 없음.

- [ ] **Step 4: production build (sourcemap 업로드 skip 모드)**

Run:
```bash
SENTRY_AUTH_TOKEN= NEXT_PHASE=phase-production-build npm run build
```

Expected: build success. stderr에 `[@sentry/nextjs] No SENTRY_AUTH_TOKEN — skipping sourcemap upload` 류의 경고만 (silent flag로 가려질 수도 있음).

- [ ] **Step 5: runtime exposure 차단 증거 수집 — SENTRY_AUTH_TOKEN을 runtime에 노출시키면 부팅 실패**

Run:
```bash
SENTRY_AUTH_TOKEN=sntrys_test123 NODE_ENV=test \
  DATABASE_URL=postgresql://localhost:5432/test \
  DIRECT_URL=postgresql://localhost:5432/test \
  AUTH_SECRET=$(printf 'x%.0s' {1..32}) \
  USE_REAL_EMBEDDING=0 PAYMENT_FORCE_REAL=0 \
  TOSS_API_BASE_URL=http://localhost:4242 \
  npx tsx -e "import('./src/shared/lib/env').then(() => console.log('UNEXPECTED PASS')).catch((e) => { console.error('EXPECTED FAIL:', e.message); process.exit(1); })"
```

Expected: `EXPECTED FAIL: ... SENTRY_AUTH_TOKEN ... phase-production-build ...` 로 시작하는 ZodError 메시지 출력. exit code 1. (NEXT_PHASE를 일부러 미설정해 runtime 경로 시뮬레이션.)

- [ ] **Step 6: build phase 통과 증거 수집 — NEXT_PHASE 설정 시 같은 토큰이 통과**

Run:
```bash
SENTRY_AUTH_TOKEN=sntrys_test123 NODE_ENV=test \
  NEXT_PHASE=phase-production-build \
  DATABASE_URL=postgresql://localhost:5432/test \
  DIRECT_URL=postgresql://localhost:5432/test \
  AUTH_SECRET=$(printf 'x%.0s' {1..32}) \
  USE_REAL_EMBEDDING=0 PAYMENT_FORCE_REAL=0 \
  TOSS_API_BASE_URL=http://localhost:4242 \
  npx tsx -e "import('./src/shared/lib/env').then(() => console.log('EXPECTED PASS')).catch((e) => { console.error('UNEXPECTED FAIL:', e.message); process.exit(1); })"
```

Expected: `EXPECTED PASS` 출력. exit code 0.

- [ ] **Step 7: 사용자 수동 확인 요청 항목 정리 (자동화 불가)**

다음 항목은 자동 증거 수집이 불가능하므로 PR/보고에 명시:

1. **Vercel 환경 변수 scope 설정**: Project Settings → Environment Variables → `SENTRY_AUTH_TOKEN`이 *Build only* 체크박스만 활성화되어 있는지 UI 캡처 1회 (Production/Preview runtime scope는 *반드시 해제*).
2. **Sentry dashboard 이벤트 도착 확인**: 운영 배포 후 1건이라도 의도적 에러(예: `/api/health`에 `throw`)를 발생시키고 Sentry projects → issues에 표시되는지 확인.
3. **sourcemap 디코딩 검증**: 위 의도적 에러의 stack trace가 minified가 아닌 원본 source 위치로 표시되는지 (sourcemap upload 성공의 최종 증거).

- [ ] **Step 8: plan 체크박스 일괄 갱신 (CLAUDE.md §4.1)**

이 plan 파일(`docs/superpowers/plans/2026-05-27-sentry-wiring.md`)의 Task 1~6 모든 `- [ ]` 항목을 `- [x]`로 변경.

Run (검증):
```bash
grep -n "\- \[ \]" docs/superpowers/plans/2026-05-27-sentry-wiring.md
```

Expected: Task 7(ADR 작성)을 제외하고는 출력 없음. Task 7은 별 commit이므로 이 step 시점엔 미체크 상태가 정상.

- [ ] **Step 9: 커밋 — QA 증거 + 체크박스 갱신**

```bash
git add docs/superpowers/plans/2026-05-27-sentry-wiring.md
git commit -m "chore(plan): Sentry wiring Task 1-6 완료 + QA 증거 + 체크박스 갱신 (B2-A)"
```

---

## Task 7: ADR-0021 작성 (Sentry 채택 + 대안 5종 거부 박제)

**Files:**
- Create: `docs/superpowers/adr/0021-sentry-sdk-adoption.md`
- Modify: `docs/superpowers/adr/README.md`
- Modify: `docs/superpowers/plans/2026-05-27-sentry-wiring.md` (Task 7 체크박스 갱신)

- [ ] **Step 1: Task 1~6 커밋 SHA 수집**

Run:
```bash
git log --oneline -7 | head -7
```

Expected: Task 1~6의 commit SHA 6~7건이 short-form으로 나열됨. 다음 Step의 ADR 본문 "관련 commit" 줄에 채워 넣을 값.

- [ ] **Step 2: ADR-0021 본문 작성**

`docs/superpowers/adr/0021-sentry-sdk-adoption.md` 신규 작성 — 본문의 `(Task 1~6 커밋 SHA)` placeholder를 Step 1에서 수집한 SHA로 치환:

```markdown
# ADR-0021: Sentry SDK 채택 + sourcemap upload policy

- **상태**: Accepted
- **결정일**: 2026-05-27
- **영향 범위**: `src/instrumentation.ts`, `src/sentry.{server,edge}.config.ts`, `src/shared/lib/observability/errorTracker.ts`, `src/shared/lib/env.ts`, `src/app/global-error.tsx`, `next.config.mjs`
- **관련 commit**: (Task 1~6 커밋 SHA)
- **관련 spec**: [`docs/superpowers/specs/2026-05-27-sentry-wiring-design.md`](../specs/2026-05-27-sentry-wiring-design.md)
- **선행 ADR**: ADR-0014 (NO-REAL-MONEY env enforcement — NEXT_PHASE 분기 패턴 재사용)

## Context

Phase 3 B2 운영 준비의 *관측 기반*을 닫기 위해 error tracking SDK가 필요했다. `errorTracker.ts` 어댑터는 *Sentry-ready*로 박혀 있었지만 (`TODO(M-OBS-2)` 명시) 실제 SDK 미설치 상태로 production 배포가 임박했다. 후속 hardening 작업(보안 헤더 B, Rate Limit C)이 *관측되지 않는 변경*으로 머무는 위험을 차단해야 했다.

또한 `SENTRY_AUTH_TOKEN`(sourcemap upload용)이 *런타임에 노출되면* 모든 release/project의 sourcemap upload 권한이 탈취되는 보안 risk가 존재 — 부팅 단계 가드가 필수였다.

## Decision

**Sentry SDK(`@sentry/nextjs`)를 채택**하고 다음 구조로 wiring:

1. **Runtime split** — `instrumentation.ts`의 `register()`에서 `NEXT_RUNTIME` 분기로 `sentry.{server,edge}.config.ts`를 *dynamic import* → Edge 번들에 Node-only integration이 섞이지 않게 격리.
2. **동기 어댑터 시그니처 유지** — `errorTracker.ts`에서 `@sentry/nextjs`를 *top-level import* + `Sentry.withScope` 동기 호출. 호출처 무수정.
3. **AUTH_TOKEN 런타임 차단** — `env.ts` `superRefine`에서 `NEXT_PHASE !== "phase-production-build"`인데 토큰이 *존재하면* fail-fast (ADR-0014 패턴 재사용).
4. **global-error.tsx** — root layout 사고 시 `<html><body>` 자체 렌더 + isomorphic `Sentry.captureException` 직접 호출 (client component / ALS 부재).

```ts
// 핵심 동작 인용 — errorTracker.captureException
if (process.env.SENTRY_DSN) {
  Sentry.withScope((scope) => {
    applyScope(scope, merged);  // ALS context → setTag/setExtra
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
  });
}
logger.error("error.captured", err, merged);  // fanout 항상 유지
```

## Consequences

**얻은 것:**
- Phase 3 B2 후속 작업(보안 헤더 B, Rate Limit C)이 *관측되는 변경*으로 격상
- 어댑터의 동기 시그니처/공개 API 무변경 — 호출처 회귀 위험 0
- sourcemap upload token 런타임 노출이 *부팅 단계*에서 차단되어 leak 가능 경로 폐쇄
- 기존 `errorTracker.ts`의 임시 코드(`notifySentryNotWired`/`sentryWarnEmitted`/`_resetForTest`) 제거 → 모듈 상태 단순화

**포기한 것 / 미해결:**
- `tracesSampleRate: 0` 채택 — performance traces / Session Replay는 별 PR (비용·정책 미결정)
- Sentry Cron monitoring(`@sentry/nextjs` Cron API) 미적용 — `/api/cron/*` 모니터링은 후속
- 사용자 식별(`Sentry.setUser`) 미적용 — 동의/PRD 정의 후
- Slack/PagerDuty 알림 라우팅은 Sentry UI 설정 (코드 외)
- `hideSourceMaps: true` 채택 → 디버깅이 *반드시 Sentry UI 경유*가 됨 (소스코드 노출 차단 우선)

## Alternatives Considered

### 옵션 A: Sentry SDK 전면 도입 ✅ 채택
- 채택 이유: 어댑터(`errorTracker.ts`)가 *Sentry-ready*로 박혀 있어 전환 cost ~0. Next.js / Vercel 생태계에서 가장 검증된 솔루션. `withSentryConfig` wrapper로 sourcemap pipeline까지 한 PR에서 종결.

### 옵션 B: Better Stack (Logtail + Uptime)
- 어떤 방식: log aggregation + uptime monitoring SaaS, JS SDK로 console 후킹
- 거부 이유: log 중심이라 *예외 컨텍스트(stack frame, breadcrumb, scope tags)* 1급 기능 부족. 어댑터 재설계 필요 (현재 `withScope` 기반 머지 구조와 부정합).

### 옵션 C: Highlight.io (open-source self-host 가능)
- 어떤 방식: full-stack monitoring SaaS, self-host 옵션 있음
- 거부 이유: 셀프호스트는 운영 부담(인스턴스/스토리지/업데이트). SaaS plan은 Sentry 대비 가격 우위 없음. Next 15 sourcemap 통합 성숙도 부족.

### 옵션 D: Vercel OTEL + Grafana Cloud
- 어떤 방식: OpenTelemetry collector를 Vercel runtime에서 export → Grafana Cloud로 traces/logs/metrics 통합
- 거부 이유: traces/metrics 강점이지만 *예외 추적 UX*가 Sentry 대비 약함. OTEL → Grafana → 알림 라우팅까지 셋업 부담 큼. Phase 3 B2의 "마지막 1마일" 정신과 부정합.

### 옵션 E: Datadog APM
- 어떤 방식: 엔터프라이즈 APM SaaS, full-stack tracing + log + RUM 통합
- 거부 이유: 비용 + 학습 곡선. 무료 plan이 사실상 사용 불가.

### 옵션 F: 자체 구현 (logger fanout만 유지, SDK 미도입)
- 어떤 방식: `errorTracker.ts`의 logger fanout 경로만 유지, 외부 SDK 없이 자체 collector 구축
- 거부 이유: 어댑터 인터페이스(`captureException`)가 *Sentry breadcrumb·scope·release/environment* 기능을 전제로 설계됐다. 자체 구현은 결국 Sentry의 90%를 다시 짜는 일.

## Notes

- **후속 작업**: BrowserTracing / Session Replay / `Sentry.setUser` / Cron monitoring / Slack-PagerDuty 라우팅은 별 PR
- **Vercel 운영 체크리스트**: `SENTRY_AUTH_TOKEN` scope = Build only / `SENTRY_ENVIRONMENT` 환경별 분기 (production/preview/development)
- **모니터링 후보 지표**: Sentry events/day, p95 capture latency, sourcemap upload success rate (CI step exit code)
- **6개월 뒤 의심받을 가능성**:
  - `tracesSampleRate: 0`이라 performance 가시성 없음 — 트래픽 증가 시 재검토
  - `hideSourceMaps: true`가 디버깅 어렵게 만들 가능성 — Sentry UI에서만 풀려야 함
  - dynamic import 분기가 Turbopack의 tree-shake 규칙 변경 시 영향받을 수 있음 — Edge 번들 사이즈 회귀 모니터링 필요
```

- [ ] **Step 3: ADR README 인덱스 갱신**

`docs/superpowers/adr/README.md`에 한 줄 추가 (기존 ADR-0020 줄 *바로 아래*):

```markdown
- [ADR-0021](0021-sentry-sdk-adoption.md) — Sentry SDK 채택 + sourcemap upload policy (Phase 3 B2-A)
```

> 기존 README의 정확한 라인 패턴은 작성 직전 `cat docs/superpowers/adr/README.md`로 확인 후 동일 포맷 유지.

- [ ] **Step 4: plan 파일 Task 7 체크박스 갱신**

`docs/superpowers/plans/2026-05-27-sentry-wiring.md`의 Task 7 모든 `- [ ]` → `- [x]` 처리.

Run (검증):
```bash
grep -n "\- \[ \]" docs/superpowers/plans/2026-05-27-sentry-wiring.md
```

Expected: 출력 없음 (모든 Task 완료).

- [ ] **Step 5: 커밋**

```bash
git add docs/superpowers/adr/0021-sentry-sdk-adoption.md docs/superpowers/adr/README.md docs/superpowers/plans/2026-05-27-sentry-wiring.md
git commit -m "docs(adr): 0021 Sentry SDK adoption + sourcemap policy (B2-A 완료)"
```

---

## 최종 검증 체크리스트 (PR 직전)

- [ ] `npm run typecheck` exit 0
- [ ] `npm run test` 모든 케이스 PASS (신규 9 케이스 포함: instrumentation 3 + env 3 + errorTracker 3)
- [ ] `npm run lint` exit 0
- [ ] `SENTRY_AUTH_TOKEN= npm run build` exit 0
- [ ] runtime exposure 차단 증거 (Task 6 Step 5) — ZodError 인용
- [ ] build phase 통과 증거 (Task 6 Step 6) — EXPECTED PASS 인용
- [ ] plan 파일 전체 체크박스가 `- [x]` (Task 7 Step 3 grep 결과 빈 출력)
- [ ] ADR-0021 발행 + README 인덱스 추가
- [ ] **사용자 수동 확인 요청** (자동화 불가):
  - Vercel `SENTRY_AUTH_TOKEN` scope = Build only UI 캡처
  - Sentry dashboard 의도적 에러 이벤트 도착
  - sourcemap 디코딩 (stack trace가 원본 source 위치로 표시)

---

## 보고 양식 (CLAUDE.md §7.1)

Task 6 완료 후 사용자에게 보고 시 다음 3 섹션 유지:

- 🏗️ **Core Architecture (3줄):** instrumentation runtime split / errorTracker 동기 시그니처 유지 SDK fanout / SENTRY_AUTH_TOKEN 런타임 차단
- ♻️ **Boilerplate:** 신규 파일 5종 + env 3-key + next.config wrap + 테스트 9건
- 🧠 **Concept Insight:** Edge 보조 트렁크 비유 (spec과 동일)
