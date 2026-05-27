# ADR-0021: Sentry SDK 채택 + sourcemap upload policy

- **상태**: Accepted
- **결정일**: 2026-05-27
- **영향 범위**: `src/instrumentation.ts`, `src/sentry.{server,edge}.config.ts`, `src/shared/lib/observability/errorTracker.ts`, `src/shared/lib/env.ts`, `src/app/global-error.tsx`, `next.config.mjs`
- **관련 commit**: b849dee (Task 1), 2f3c039 (Task 2), 7b0184b (Task 3), 40508f9 (Task 4), 99c8a7e (Task 5)
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
