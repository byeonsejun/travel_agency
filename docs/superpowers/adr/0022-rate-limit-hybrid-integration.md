# ADR-0022 — Rate Limit 4-tier sliding window + Hybrid 통합 (Edge middleware + route/action wrapper)

- **Status**: Accepted
- **Date**: 2026-05-28
- **Phase**: 3 B2-C (운영 준비)
- **Related**: [Spec](../specs/2026-05-28-rate-limit-design.md), [Plan](../plans/2026-05-28-rate-limit.md), [ADR-0021](./0021-sentry-sdk-adoption.md), [ADR-0004](./0004-cache-2-layer-strategy.md)

## Context

Phase 3 B2-A(Sentry SDK)·B2-B(CSP/HSTS)로 관측성과 브라우저 보안 경계는 갖췄으나, *서버 자원·외부 비용·도메인 무결성*을 노리는 트래픽 폭주에 대한 응용 계층 방어선이 비어 있었다. Vercel 플랫폼 DDoS는 볼륨 임계 발동 — credential stuffing, card testing, AI cost burn 같은 *유효 형식 + 비대칭 비용* 패턴은 응용에서 막아야 했다.

설계 시점에 세 가지 통합 위치를 검토:
1. **A — 미들웨어 단일** — 모든 tier를 pathname 분기로
2. **B — route/action 단일** — wrapper 함수 호출 site에서 선언
3. **C — Hybrid** — middleware는 global baseline, route/action은 tier-specific

## Decision

**Hybrid (Option C) 채택**. 4 tier × sliding window:

| Tier | Limit / Window | 적용 위치 | 식별자 |
|------|----------------|-----------|--------|
| `global` | 100 / 10s | middleware (Edge) `/api/*` | userFirst |
| `auth` | 5 / 1min | `signInWithProvider` action | ipOnly |
| `payment` | 10 / 1min | `/api/payments/confirm` route | userOnly |
| `ai-search` | 20 / 1min | `searchProducts` action | userFirst |

알고리즘: Upstash `Ratelimit.slidingWindow(limit, window)` — 윈도우 경계 2× burst 차단. Bypass list: webhook(transmission-id 멱등 [ADR-0013]), cron(`CRON_SECRET`), csp-report, health.

```ts
// middleware.ts — global baseline
if (pathname.startsWith("/api/") && !isBypassPath(pathname)) {
  const id = identify(req, "userFirst", req.auth?.user?.id ?? null);
  const verdict = await enforce("global", id);
  if (!verdict.ok) return NextResponse.json({ error: "RATE_LIMITED", ... }, { status: 429 });
}

// route — tier-specific
export const POST = withRateLimit({ tier: "payment", resolveUserId: ... }, handler);
```

## Consequences

(+) **콜드스타트 비용 방어선** — middleware Edge 컷이 함수 호출 전에 작동.
(+) **tier 판정이 call site에 명시** — 새 라우트 추가 시 wrapper 호출 누락이 *코드 리뷰에서* 잡힘 (pathname 매칭 회귀와 달리 가시적).
(+) **middleware 폭발 반경 최소화** — global tier만 영향. 도메인 tier 버그는 그 route에 격리.
(+) Server Action도 wrapper 패턴으로 동일 처리 — middleware에서 식별 불가한 케이스 정합.
(−) **두 곳 통합** — 새 개발자에게 한 줄 학습 비용. `CLAUDE.md §8 혼란 방지 노트`로 박제 완화.
(−) middleware 컷은 `/api/*`만 — 페이지 RSC 호출은 비보호. RSC가 도메인 호출하면 그 도메인의 wrapper가 책임 (정상 분리).

## Alternatives Considered

- **Option A — 미들웨어 단일 통합**: tier 판정을 pathname 분기에 묶으면 `/api/payments/webhook/toss`(bypass) vs `/api/payments/confirm`(tier=payment) 같은 미세 분기가 middleware에 누적 → 회귀 위험. Server Action은 페이지 path에 POST되어 식별 불가. middleware 한 줄 버그가 *전 서비스 차단*으로 폭발할 수 있어 거부.
- **Option B — route/action 단일 통합**: 볼륨 DoS 시 모든 Function이 호출되어 콜드스타트 비용 100% 발생. middleware Edge 컷이 *비용 방어선*으로서 가치 있어 거부.
- **Token Bucket 알고리즘**: 단발 burst 허용 — credential stuffing에 부적합(매분 max burst 소비 가능). Sliding Window 채택.
- **Fixed Window 알고리즘**: 윈도우 경계에서 2× burst 가능. Sliding Window가 더 강함.
- **Tier별 분리 Upstash 인스턴스**: 운영 단순성 손해. 한 인스턴스에 prefix(`ratelimit:v1:<tier>`)로 격리 — Upstash analytics 가시화로 충분.
