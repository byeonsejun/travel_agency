# ADR-0023 — Rate Limit Fail-Open 강등 정책 (Upstash 부재/장애 시)

- **Status**: Accepted
- **Date**: 2026-05-28
- **Phase**: 3 B2-C
- **Related**: [ADR-0022](./0022-rate-limit-hybrid-integration.md), [ADR-0004](./0004-cache-2-layer-strategy.md), [Feedback: Dev External IO]

## Context

Rate Limit은 *보안 게이트*다. 게이트가 우연한 미설정·일시 장애로 *정상 사용자를* 차단하면, 공격으로부터 보호하려던 가치보다 큰 손실(서비스 다운, 매출 손실, 평판)이 발생한다. 한편, fail-open 채택 시 게이트가 일시적으로 무력화되어 공격이 통과할 수 있다 — 이 trade-off를 어느 방향으로 정할지가 결정 사안.

세 가지 정책을 검토:
1. **Fail-closed** — Upstash 부재/장애 시 모든 요청 거부
2. **Fail-open (graceful)** — 요청 통과 + warn 로그 + Sentry breadcrumb
3. **Fail-closed in production / open in dev** — 환경 분기

또한 운영 환경에서 Upstash 부재 시 *부트 자체를 실패*시킬지 별도 검토.

## Decision

**Fail-open 강등** 채택. 운영 환경에서도 부트는 통과(부재는 `info` 로그만).

```ts
// enforce.ts (핵심)
if (!limiter) return passVerdict(tier, /* bypassed */ true);
try { ... } catch (e) {
  logger.warn("rate_limit.degraded", { tier, identifier: hash(id), error: e.message });
  return passVerdict(tier, /* bypassed */ true);
}
```

`verdict.bypassed=true`는 *quota 헤더가 의미 없음*을 호출부에 알리는 신호 — 응답 헤더는 그대로 박제(`Remaining = limit`).

## Consequences

(+) **캐시 graceful 강등([ADR-0004] / [Feedback: Dev External IO])과 일관** — "외부 의존 미설정 = 강등" 원칙 통일.
(+) **dev/test 마찰 0** — Upstash 없이 로컬 개발 가능. CI에서도 외부 호출 0.
(+) **downstream gate 보존** — auth 가드, 결제 Zod 검증, 웹훅 transmission-id 멱등([ADR-0013]) 모두 정상 작동. 한 게이트 일시 무력화 ≠ 시스템 무방비.
(+) **운영 가시화** — `rate_limit.degraded` warn 로그 + Sentry breadcrumb로 *언제 fail-open이 실제로 일어났는지* 추적. 분석 후 운영 환경 fail-closed 격상은 후속 ADR로.
(−) Upstash 다운 동안 공격이 통과할 수 있음. 단 Vercel 플랫폼 DDoS·다운스트림 invariant가 살아있으므로 *근본적인* 보호 손실은 아님.
(−) "보안 게이트가 미설정으로 무력화되는 게 맞나" 정서적 거부감. 정량적으로는 *정상 사용자 차단 비용 > 공격 통과 비용*임을 위 (+) 4가지로 정당화.

## Alternatives Considered

- **Fail-closed 전체**: 운영 환경 Upstash 일시 장애가 *완전한 서비스 다운*으로 증폭. NextAuth · DB · Sentry 다 살아있는데 rate-limit이 게이트를 닫는 시나리오는 정상 사용자 피해가 비합리적. 거부.
- **Fail-closed in production, open in dev**: 환경 분기는 [Feedback: Dev External IO] 위반("NODE_ENV로 동작 분기 금지"). 의도 누락 시 dev에서 작동하던 코드가 prod에서 다른 동작 — 회귀 위험.
- **운영 환경 부트 자체 실패 (Upstash required)**: B2-C가 Upstash 프로비저닝보다 먼저 머지될 수 있고, 운영자가 *명시적으로* fail-closed를 원할 때까지 강제 하지 않는 게 안전. `info` 로그로 운영자 인지 가능. 격상은 Phase 3 B2-D 또는 별 ADR(0024 후보)로 미룸.
- **`unknown` IP 단일 버킷 → 분리 버킷화**: 모든 unknown 요청이 같은 버킷에 들어가 한 사용자가 한도 소비 시 다른 unknown도 차단되는 *부수효과*. 분리(랜덤 fingerprint 등)는 사실상 무제한과 동의 — 차라리 운영 환경에서 `unknown` 발생을 Sentry breadcrumb로 *가시화*하고 인프라 단(헤더 정규화)에서 줄이는 게 정직. 거부.
