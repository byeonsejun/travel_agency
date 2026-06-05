# ADR-0039 — 정적 보안 헤더 7종(`next.config`) + CSP report-only→enforce 롤아웃 게이트

- **Status**: Accepted
- **Date**: 2026-06-06
- **Phase**: 11 (Security Hardening)
- **영향 범위**: `next.config.mjs`, `src/middleware.ts`, `src/shared/lib/security/csp.ts`, `src/shared/lib/env.ts`(`CSP_MODE`), `src/app/api/csp-report`
- **Related**: [ADR-0025](./0025-csp-route-scoped-nonce.md)(CSP 경로별 nonce), [ADR-0021](./0021-sentry-sdk-adoption.md)(Sentry — CSP violation fanout 대상)

## Context

브라우저 보안 헤더는 두 부류로 갈린다. (1) **상수** 헤더 — HSTS·X-Frame-Options·Referrer-Policy·Permissions-Policy·COOP·CORP·X-Content-Type-Options 는 요청·세션과 무관하게 항상 같은 값. (2) **요청별 동적** 헤더 — CSP 는 nonce 가 매 요청 달라야 `'strict-dynamic'` 인라인 XSS 방어가 성립([ADR-0025]).

문제는 (a) 상수 헤더를 어디서 발급할 것인가(middleware vs `next.config`), (b) HSTS 를 얼마나 공격적으로 박을 것인가(preload 여부), (c) CSP enforce 를 언제 켤 것인가 — enforce 를 첫날부터 켜면 미처 화이트리스트하지 못한 정상 스크립트(Toss SDK, Sentry, RSC flight chunk)가 차단되어 사이트가 깨진다. 우회로(임시로 CSP 끄기)는 보안 공백을 남기므로 *단계적 게이트*가 필요하다.

## Decision

**상수 7종은 `next.config.mjs` 의 `headers()` 로**, **CSP 는 `middleware` 로** 분리 발급. **CSP 는 `CSP_MODE` env 로 report-only(기본)→enforce 승격을 게이트**한다.

```js
// next.config.mjs — 모든 응답(정적 자산 포함)에 상수 헤더 박제
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=15552000; includeSubDomains" }, // 180d, NO preload
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=()" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];
```
```ts
// middleware.ts — CSP 만 요청별. enforce 가 아니면 Report-Only 헤더로 발급(게이트).
const reportOnly = process.env.CSP_MODE !== "enforce";
```

CSP 위반은 `report-uri /api/csp-report` 로 수집 → Zod 검증 + 노이즈 필터(브라우저 확장) 후 Sentry fanout([ADR-0021]).

## Consequences

**얻은 것:**
- 상수 헤더가 `next.config` 에 있어 **middleware 분기 0 비용** — 정적 자산 응답에도 매 요청 JS 실행 없이 헤더가 붙는다.
- HSTS `max-age=180d` + **preload 미포함** — HTTPS 강제는 얻되, 도메인을 브라우저 preload 리스트에 영구 등록(되돌리기 어려운 one-way door)하지는 않는다.
- CSP report-only→enforce **게이트가 코드가 아니라 env(`CSP_MODE`)** 라, 배포 단위로 enforce 를 켜고 끄며 위반 데이터를 모은 뒤 안전하게 승격 가능.
- `Permissions-Policy: payment=()` 로 Payment Request API 차단 — Toss 는 iframe/SDK 라 무관, 표면 축소만 얻음.

**포기한 것 / 미해결:**
- **enforce 의 production 승격(plan Task 6~8)은 배포·7일 모니터링 게이트라 본 ADR 시점엔 미완.** 본 ADR 은 *전략*을 박제하며, 실제 prod enforce 전환은 Vercel 배포 + Sentry CSP violation 카운트 게이트 통과 후 별도 수행(WAIT-MARKER). 기본값 report-only 이므로 미승격 상태에서도 위반은 *수집*된다.
- static/ISR 경로 CSP 는 `'unsafe-inline'`(RSC flight chunk 지원) 유지 — 인라인 XSS 방어는 dynamic 경로에만([ADR-0025] Addendum).

## Alternatives Considered

### 옵션 A: 상수 헤더도 middleware 에서 발급
- 모든 보안 헤더를 한 곳(middleware)에 모으면 응집도는 높다.
- 거부: 정적 자산(`_next/static`)은 middleware matcher 에서 제외되어 헤더 누락 위험 + 매 요청 분기 비용. 상수는 `next.config` 가 플랫폼 레벨에서 모든 응답에 박는 게 정확하고 싸다.

### 옵션 B: HSTS `max-age=1y` + `preload`
- 최고 등급 점수(securityheaders.com A+)와 강한 HTTPS 강제.
- 거부: `preload` 는 `hstspreload.org` 제출 시 모든 서브도메인을 영구 HTTPS 로 잠그는 **되돌리기 어려운 결정**. staging/서브도메인이 HTTP 를 쓸 여지가 사라진다. 180d·includeSubDomains 로 실질 보호를 얻고 one-way door 는 피한다. preload 는 운영 안정화 후 별도 결정.

### 옵션 C: CSP 를 첫 배포부터 enforce
- 공백 없는 즉시 차단.
- 거부: 화이트리스트 누락(Toss 결제 iframe, Sentry ingest, RSC 인라인) 1건이라도 있으면 결제/페이지가 깨진다. report-only 로 **실데이터 위반을 먼저 수집**한 뒤 enforce 하는 게 골든패스 회귀를 막는다.

### 옵션 D: `<meta http-equiv="CSP">` 태그
- 헤더 설정 권한이 없는 환경의 폴백.
- 거부: meta CSP 는 `frame-ancestors`·`report-uri` 를 지원하지 않는다(clickjacking 방어·위반 수집 불가). 헤더 방식이 상위호환.

## Notes

- **CLAUDE.md 참조 정정 동반**: 기존 `§8` 의 "Sentry SDK + CSP/HSTS([ADR-0021])" 표기는 부정확했다 — [ADR-0021] 은 Sentry SDK·sourcemap 전용이고 CSP 는 [ADR-0025], 정적 헤더는 본 ADR-0039 다. 함께 정정.
- 모니터링 지표: Sentry `csp.violation` 그룹의 일일 카운트. enforce 승격 게이트 = 노이즈 제외 위반 0 이 7일 연속.
- 새 force-dynamic 도메인 추가 시 `csp.ts` 의 `DYNAMIC_CSP_PREFIXES` 도 함께 갱신해야 nonce CSP 가 적용된다.
