# M-OBS 관측성 설계 문서

> **작성일**: 2026-05-15 | **작성자**: AI Squad (M-OBS Phase)
> **관련 Plan**: `docs/superpowers/plans/2026-05-14-observability.md`

---

## 1. 도입 배경

M-PAYMENT 완료 시점에서 결제 코어(`confirm`/`webhook`/`refund`)는 비즈니스 로직 측면에서 검증됐지만, 운영 중 발생하는 이상 징후를 탐지할 수단이 없었다. 구체적으로:

- **`console.log`/`console.error` 산재**: 구조화되지 않아 로그 집계 불가. PII(결제 키, 이메일) 노출 위험.
- **traceId 부재**: 단일 결제 흐름을 end-to-end로 추적할 수 없음.
- **metrics 없음**: 웹훅 처리율, 환불 지연 건수, 헬스 상태를 수치로 알 수 없음.
- **에러 집계 인프라 없음**: 운영 중 예외가 사라지는 블랙홀 상태.

M-OBS는 **외부 SaaS 신규 의존성 없이** 이 문제를 해결하는 횡단 관심사 인프라 레이어다.

---

## 2. 아키텍처 — 모듈 다이어그램

```
┌─────────────────────────────────────────────────────┐
│  middleware.ts  (Edge runtime)                       │
│  └─ crypto.randomUUID() → x-trace-id 헤더 발급      │
│     ⚠️  ALS/Prisma/observability import 금지        │
└──────────────────────┬──────────────────────────────┘
                       │ request headers: x-trace-id
                       ▼
┌─────────────────────────────────────────────────────┐
│  withObservedRoute  (Node runtime)                   │
│  shared/lib/observability/withObservedRoute.ts       │
│  └─ x-trace-id 읽기 → generateTraceId() fallback    │
│  └─ runWithContext({ traceId, routeName })           │
│  └─ route.start / route.end + durationMs 로그        │
│  └─ throw → captureException 후 재throw              │
│  └─ 응답 헤더에 x-trace-id 부착                      │
└──────────────────────┬──────────────────────────────┘
                       │ AsyncLocalStorage context
                       ▼
┌─────────────────────────────────────────────────────┐
│  shared/lib/observability/  (횡단 관심사 슬라이스)    │
│                                                      │
│  context.ts       AsyncLocalStorage 기반             │
│                   runWithContext / getContext         │
│  logger.ts        구조화 JSON 로거 v2                │
│                   level 필터 · PII 리덕션 · ALS 머지 │
│  metrics.ts       인메모리 Map 카운터                 │
│                   incr / observe / snapshot / flush  │
│  errorTracker.ts  captureException 어댑터            │
│                   logger fanout (Sentry-ready)       │
│  generateTraceId  crypto.randomUUID 기반 16자 hex    │
│  pii.ts           maskPii — 키·패턴 기반 리덕션       │
│  withObservedRoute route handler 래퍼                │
└──────────────────────┬──────────────────────────────┘
                       │ import
                       ▼
┌─────────────────────────────────────────────────────┐
│  entities/payment/api/  (도메인 슬라이스)             │
│  confirm.ts   logger·metrics·captureException 부착   │
│  webhook.ts   metrics.incr("payment.webhook.toss.*") │
│  refund.ts    metrics.incr("payment.refund.*")       │
└─────────────────────────────────────────────────────┘
```

**데이터 흐름 요약 (단일 결제 요청)**:

```
Client → middleware → x-trace-id 발급
       → /api/payments/confirm (withObservedRoute)
         → runWithContext({ traceId:"a1b2...", routeName:"payments.confirm" })
           → auth() · Zod 검증
           → confirmPayment()
             → logger.error("payment.compensate_cancel.pg_failed", ...) // traceId 자동 포함
             → metrics.incr("payment.compensate_cancel.pg_failed")
             → captureException(err, { bookingId })   // Sentry 전환 시 여기서 전송
       ← 응답 헤더: x-trace-id: a1b2...
```

---

## 3. 핵심 설계 결정

### 3.1 Edge / Node 런타임 경계

| 영역 | Runtime | 제약 |
|------|---------|------|
| `middleware.ts` | Edge | `crypto.randomUUID()` 만 사용. ALS·Prisma·observability import **금지** |
| `withObservedRoute` | Node | ALS(`AsyncLocalStorage`) 사용 가능 |
| `logger` / `captureException` | Node | ALS context 자동 머지 |

### 3.2 PII 방어 계층

`maskPii(data)` — 두 단계 필터:
1. **키 기반**: `tossPaymentKey`, `secret`, `password`, `token`, `cardNumber` 등 → `[REDACTED]`
2. **패턴 기반**: 이메일 → `a***@b***`, 전화 → `010-****-****`, 16-19자리 카드번호 → `[REDACTED:CARD]`

모든 `logger.emit()` 직전, 모든 `captureException` 직전에 자동 적용.

### 3.3 메모리 상한

`metrics.ts`의 observation 배열은 1,000개로 상한. 초과 시 oldest drop. `counters`는 무한 누적 가능하지만 서버 재기동 시 초기화됨(인메모리 한계). 영속화는 Out of Scope(§5 참고).

---

## 4. Sentry 전환 절차

현재 `captureException`은 `logger.error` fanout만 수행한다. Sentry 활성화는 **2단계**:

**Step 1 — 환경 변수 설정** (`.env.production`):
```bash
SENTRY_DSN=https://<key>@o<org>.ingest.sentry.io/<project>
```

**Step 2 — `errorTracker.ts` 수정** (`TODO(M-OBS-2)` 주석 위치):
```typescript
// 기존
function notifySentryNotWired(): void { ... }

// 전환 후 — dynamic import로 SSR 번들 분리
import * as Sentry from "@sentry/node";
// Sentry.init({ dsn: env.SENTRY_DSN }) → 앱 초기화 시 1회
// captureException 내부:
Sentry.captureException(err, { extra: merged });
```

**영향 범위**: `errorTracker.ts` 단일 파일. 호출처(`confirm.ts`, `refund.ts` 등)는 무수정.

---

## 5. 향후 작업 (Out of Scope — 별도 PR)

| 항목 | 설명 |
|------|------|
| **metrics cron flush** | 1분 간격으로 `metrics.flush()` 호출 → 로그 수집기(Loki 등)로 전달 |
| **OpenTelemetry 전환** | `withObservedRoute`의 `runWithContext` → `@opentelemetry/api` Context 교체. logger → OTLP exporter |
| **`/api/admin/payment-events`** | `listRecentPaymentEvents` 쿼리를 Admin UI로 노출 |
| **Sentry SDK 연결** | `errorTracker.ts` `TODO(M-OBS-2)` 완성 |
| **프런트엔드 traceId 노출** | Checkout 페이지에서 응답 헤더 `x-trace-id`를 toast 또는 support-ticket에 포함 |

---

## 6. 테스트 커버리지 요약

| 모듈 | 테스트 파일 | 케이스 수 |
|------|-----------|---------|
| `pii.ts` | `pii.test.ts` | 17 |
| `context.ts` | `context.test.ts` | 12 |
| `generateTraceId.ts` | `generateTraceId.test.ts` | 10 |
| `logger.ts` | `logger.test.ts` | 14 |
| `errorTracker.ts` | `errorTracker.test.ts` | 15 |
| `metrics.ts` | `metrics.test.ts` | 13 |
| `withObservedRoute.ts` | `withObservedRoute.test.ts` | 4 |
| `payment/api/observability.ts` | `observability.test.ts` | 9 |
| 결제 코어 훅 | `observability-hooks.test.ts` | 11 |
| `/api/health` | `health/route.test.ts` | 3 |
| **합계** | — | **108** |
