# Security Headers & CSP — Design Spec

- **작성일**: 2026-05-27
- **Phase**: 3 B2 (Operations Prep) — 2순위 (B2-B, Sentry wiring 후속)
- **상태**: §1 카탈로그 사용자 승인 완료 → §2~§5 본 PR로 확정. Implementation plan 후속 작성 예정.
- **관련 코드**: `next.config.mjs`, `src/middleware.ts`, `src/app/api/csp-report/route.ts`(신설), `src/shared/lib/security/*`(신설)
- **선행 ADR**: ADR-0021 (Sentry SDK 채택 — `connect-src` 에 Sentry ingest 도메인 허용 필요), ADR-0009/0014 (NO-REAL-MONEY — 운영 결제 도메인 미허용 정책과 정합)
- **후속 ADR 예약**: "Security Headers + HSTS preload 배제 + nonce-based CSP 채택" (대안 비교 박제)

---

## 1. Overview

본 작업은 Nextour의 모든 HTML 응답에 **프로덕션 수준의 보안 헤더 7종**과 **nonce 기반 strict-dynamic CSP**를 박제한다. 적용 경로는 다음과 같이 *얇게* 갈라진다:

- **정적 헤더 7종** (HSTS / X-Content-Type-Options / Referrer-Policy / Permissions-Policy / X-Frame-Options / Cross-Origin-Opener-Policy / Cross-Origin-Resource-Policy) → `next.config.mjs`의 `headers()` 빌드타임 박제. 라우트별 분기 없음 → cold start 비용 0.
- **동적 헤더 1종 (CSP)** → `src/middleware.ts`에서 *요청별 nonce* 생성 후 헤더 1줄과 `x-nonce` 헤더로 RSC tree에 전파. `headers()` 함수의 RSC API로 layout이 nonce를 읽어 inline script tag에 주입.

본 PR이 끝나면 다음 효과가 박제된다:

1. **MITM 통제** — HSTS 6개월 (실 도메인에서 HTTPS 강제, preload 배제로 롤백 통제권 유지)
2. **XSS 표면적 축소** — nonce + `strict-dynamic` 으로 *번들 외부 inline script 실행 불가*
3. **Clickjacking 차단** — `frame-ancestors 'none'` + `X-Frame-Options: DENY` 2중 방어
4. **데이터 외부 누수 통제** — `connect-src` 화이트리스트로 Sentry/Toss/Supabase 외 외부 호출 차단, 위반은 `/api/csp-report` 로 수렴 후 Sentry 대시보드로 가시화
5. **Cross-origin isolation 준비** — COOP/CORP 로 SharedArrayBuffer 도입 가능성 확보 (Workers/PerformanceTimeline 의 cross-origin window leak 차단)

> Phase 3 B1(캐시 튜닝, ADR-0020) + B2-A(Sentry, ADR-0021) 가 끝나면서 *관측 가능성*과 *캐시 정합성*은 이미 박혔다. 본 작업은 *공격 표면적* 축소가 목표 — 운영 신뢰성 마지막 1마일.

---

## 2. Goals / Non-Goals

### 2.1 Goals (In-Scope)

| #  | Goal |
|----|---|
| G1 | 정적 헤더 7종을 `next.config.mjs` `headers()` 에 빌드타임 박제 — 모든 경로(`source: "/:path*"`) 통일 적용 |
| G2 | nonce 기반 CSP — `src/middleware.ts` 에서 요청별 16바이트 base64 nonce 생성, RSC tree로 `x-nonce` 헤더 전파 |
| G3 | Report-Only 모드 1주 → Enforce 모드 전환의 **2단계 롤아웃 게이트** + 정량 임계값 정의 |
| G4 | `/api/csp-report` 엔드포인트 — Zod로 페이로드 검증, AdBlock/확장프로그램 노이즈 필터링, Sentry로 위반 fanout |
| G5 | Vitest 단위 테스트 — middleware nonce 주입 / `next.config.mjs` headers 정합성 / `/api/csp-report` Zod 검증 |
| G6 | HSTS preload 배제 + Rolling Expiration 활용에 대한 ADR 박제 (Alternatives Considered) |

### 2.2 Non-Goals (Out-of-Scope, 별 PR)

- **Subresource Integrity (SRI)** — Toss SDK는 npm 번들이라 SRI 불필요. CDN 도입 시 별 PR.
- **Trusted Types** — `require-trusted-types-for 'script'` 는 React 19 호환성 확인 후 별 PR.
- **CSP nonce를 style-src 에까지 확장** — Tailwind JIT runtime 의 inline style 추출 패턴과 충돌 가능성, 별 PR로 검증.
- **`/api/csp-report` 의 자체 DB 저장** — Sentry 로 fanout 되므로 별도 영속화 불필요. 트래픽 폭증 시 재검토.
- **Rate Limit (B2-C)** — 별 작업. 본 PR 의 `/api/csp-report` 도 일시적으로 무방어 — Sentry Quota 가 1차 댐.
- **CSP Reporting API Level 3** (`report-to` directive + Reporting-Endpoints header) — `report-uri` (Level 2) 를 baseline 으로 두고, Level 3 는 브라우저 호환성 70% 도달 후 별 PR.

---

## 3. §1 — 헤더 카탈로그 (사용자 승인 완료)

> ✅ 본 §의 카탈로그는 사용자 결정으로 확정. 변경 시 ADR-NNNN 으로 박제.

### 3.1 정적 헤더 7종 — `next.config.mjs` `headers()` 박제

| # | Header | Value | 근거 / 트레이드오프 |
|---|---|---|---|
| H1 | `Strict-Transport-Security` | `max-age=15552000; includeSubDomains` | **180일(6개월) Rolling Expiration**. `preload` 배제 — §3.3 박제 |
| H2 | `X-Content-Type-Options` | `nosniff` | MIME sniffing 비활성화 — text/html 응답이 image/javascript 로 해석되는 사이드채널 차단 |
| H3 | `Referrer-Policy` | `strict-origin-when-cross-origin` | 동일 출처 full URL, cross-origin은 origin만 — 결제 redirect 시 query string 누수 방어 |
| H4 | `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=()` | 사용 안 하는 기능을 명시적으로 차단. `payment=()` 는 Payment Request API 차단(Toss 위젯은 iframe이라 별 정책) |
| H5 | `X-Frame-Options` | `DENY` | CSP `frame-ancestors 'none'` 의 *레거시 브라우저 백업* — IE11/구형 모바일 보완. 표준은 CSP가 SSOT |
| H6 | `Cross-Origin-Opener-Policy` | `same-origin` | window.opener 격리 — popup 기반 phishing 차단, future SharedArrayBuffer 도입 자격 확보 |
| H7 | `Cross-Origin-Resource-Policy` | `same-origin` | cross-origin이 우리 응답을 `<img>`/`<script>` 로 hot-link 하지 못하게 — Spectre/MDS side-channel 방어 |

> **왜 `X-XSS-Protection` 은 없는가?** — Chrome 78+/Firefox/Safari 가 *이미 제거*했고, IE/Legacy Edge 에서는 오히려 XSS 를 유발하는 버그가 보고됐다 ([Mozilla MDN 권고](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-XSS-Protection)). CSP 가 정답.

### 3.2 동적 헤더 — `Content-Security-Policy` (nonce 기반 strict-dynamic)

> 카탈로그 *값의 형태*만 §3.2 에서 박제. *주입 메커니즘*은 §4 (Architecture) 와 §5 (Rollout Gate) 가 책임.

```
default-src 'self';
script-src 'self' 'nonce-{NONCE}' 'strict-dynamic';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://*.supabase.co https://picsum.photos;
font-src 'self' data:;
connect-src 'self' https://*.ingest.sentry.io https://api.tosspayments.com https://*.supabase.co;
frame-src 'self' https://js.tosspayments.com;
frame-ancestors 'none';
form-action 'self' https://api.tosspayments.com;
base-uri 'self';
object-src 'none';
upgrade-insecure-requests;
report-uri /api/csp-report;
```

| Directive | 값 | 근거 |
|---|---|---|
| `default-src 'self'` | 동일 출처만 | 모든 fetch/connect/font 등의 *기본값* — 아래 directive 들이 명시적으로 override |
| `script-src 'self' 'nonce-{N}' 'strict-dynamic'` | nonce + strict-dynamic | inline script (Next 의 `__NEXT_DATA__` 등)는 nonce 로 허용, runtime 동적 inject 는 strict-dynamic 으로 propagation — *번들 외부 임의 inline 실행 불가* |
| `style-src 'self' 'unsafe-inline'` | inline style 허용 (한시) | Tailwind v3 JIT runtime 이 inline style 을 추출하지 *않지만* React 의 `style={{...}}` prop 이 inline style 로 렌더. nonce 화는 별 PR (G2 non-goal) |
| `img-src 'self' data: blob: ...` | data:/blob: + Supabase + Picsum | `next/image` 의 lazy load blob, base64 data URL, 기존 `remotePatterns` 화이트리스트와 정합 |
| `connect-src 'self' sentry toss supabase` | fetch/XHR/WS 허용처 | Sentry ingest (errorTracker fanout) + Toss API (confirm/cancel) + Supabase Storage (이미지 메타) |
| `frame-src 'self' js.tosspayments.com` | iframe 허용 | Toss 결제 위젯 iframe — 카드 입력 PCI-DSS 보안 격리 (PG 위젯이 카드번호 보유, 우리 서버는 비보유) |
| `frame-ancestors 'none'` | 우리 페이지를 iframe 으로 embed 금지 | Clickjacking 차단. H5 `X-Frame-Options: DENY` 와 2중 |
| `form-action 'self' tosspayments` | form submit 허용처 | 결제 redirect form (위젯이 POST → Toss) |
| `base-uri 'self'` | `<base>` 태그 변조 차단 | 상대 경로 URL 의 base 를 공격자가 조작해 다른 host 로 redirect 시키는 패턴 차단 |
| `object-src 'none'` | `<object>/<embed>` 차단 | Flash/PDF plugin 의 잔존 공격면 제거 |
| `upgrade-insecure-requests` | http://* → https://* 자동 승격 | 마이그레이션 잔재 (혹시 누락된 http:// 자원이 있어도 브라우저가 강제 https) |
| `report-uri /api/csp-report` | 위반 신고 | §4 endpoint 로 수렴 — Sentry fanout |

### 3.3 HSTS 전략적 결정 — Rolling Expiration 채택 / Preload list 배제

> 본 결정은 사용자 명시 지시로 박제. ADR-NNNN (§8 Alternatives Considered 후 발행) 의 핵심 자료.

#### 3.3.1 채택: `max-age=15552000; includeSubDomains` (preload 없음)

- **180일(6개월)** Rolling Expiration: 사용자가 접속할 때마다 브라우저의 HSTS 타이머가 갱신된다 → 활성 사용자는 사실상 *영구적으로* HTTPS 만 사용.
- `includeSubDomains` — 서브도메인까지 통제 (e.g. `admin.example.com` 도 HSTS 효력).
- **preload 미신청** — 브라우저에 *영구 하드코딩* 되는 chrome://net-internals/#hsts preload list 에는 등록하지 않는다.

#### 3.3.2 왜 Preload list 를 배제했는가 — 사용자 명시 박제 사유

본 프로젝트는 **포트폴리오 쇼케이스 + 프로덕션 수준 인프라 보안 지향**의 이중 정체성을 가진다. 이 정체성이 Preload list 를 부적합하게 만든다:

1. **롤백 불가성** — Preload list 등록은 *Chrome/Firefox/Safari 모두 영구 하드코딩*. 제거 신청은 6~12주 review + 다음 브라우저 release cycle 까지 대기 → 그 사이엔 사용자 단에서 `chrome://net-internals` 수동 삭제 외 방법 없음.
2. **포트폴리오 도메인의 라이프사이클 리스크** — 도메인 갱신 누락, 무료 인증서(Let's Encrypt) 만료, 호스팅 이전(Vercel → 다른 PaaS) 등 *비정상 종료* 시나리오에서 preload 가 박혀있으면 **브라우저가 모든 사용자의 HTTPS 자동 fallback 을 차단** → 페이지가 영구적으로 열리지 않는다.
3. **Rolling Expiration 이 충분한 통제권을 준다** — 6개월 max-age 는 활성 사용자에게는 영구 HSTS, 비활성/신규 사용자에게는 *수동 통제 가능 창*. 정책 변경이 필요하면 `max-age=0` 로 헤더 한 줄만 바꿔 next deploy 에서 모든 새 접속자가 HSTS 를 해제할 수 있다.
4. **"성숙한 설계" 의 정의** — 보안의 끝은 *제일 빡센 설정*이 아니라 *돌이킬 수 있는 설정*이다. Preload 의 영구성은 결제·인증·인프라가 4명 이상의 SRE 로 운영되는 조직에서나 감당 가능한 비용 — 1인 개발자/소규모 팀 의 "운영 안정성" 측면에서는 **Preload 배제 + Rolling Expiration** 이 정답.

#### 3.3.3 Preload 신청을 *나중에* 다시 고민할 트리거

본 결정은 영구가 아니라 *현 단계의 정답*이다. 다음 조건이 모두 충족되면 ADR 후속편으로 재검토:

- 도메인 소유권이 5년 이상 자동갱신 잠금 (registrar lock + auto-renew)
- 인증서 갱신 모니터링 + on-call 응답 체계 구축 (Sentry/Slack 알림)
- 서브도메인 전체 HTTPS 강제 운영 6개월 무사고 기록
- 비즈니스 요구로 *fresh visitor* 도 첫 HTTP 요청부터 HTTPS 가 강제되어야 하는 경우 (e.g. 공공·금융)

위 4가지 미충족 상태에서 preload 신청은 *조직 성숙도와 보안 정책의 미스매치*다.

---

## 4. Architecture — nonce 주입 / 헤더 박제

### 4.1 middleware.ts — 요청별 nonce 생성 + 헤더 주입

```ts
// src/middleware.ts (현행 보존 + CSP block 추가)
import { auth } from "@/features/auth/server/auth";
import { NextResponse } from "next/server";
import { buildCspHeader, CSP_NONCE_HEADER } from "@/shared/lib/security/csp";

export default auth((req) => {
  // ... 기존 traceId / 인증 redirect 로직 그대로 ...

  // ① 요청별 nonce — Edge 의 crypto.getRandomValues 사용 (ALS/Node API 금지)
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  const nonce = btoa(String.fromCharCode(...nonceBytes));

  // ② RSC tree 에서 읽도록 *request* headers 에 박제 → layout.tsx 가 headers() 로 회수
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-trace-id", traceId);
  requestHeaders.set(CSP_NONCE_HEADER, nonce);

  // ③ 응답 헤더에 CSP 박제 — Report-Only 또는 Enforce 는 환경변수로 분기 (§5)
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-trace-id", traceId);

  const csp = buildCspHeader({
    nonce,
    reportOnly: process.env.CSP_MODE !== "enforce", // 기본 report-only, 명시 시 enforce
  });
  response.headers.set(csp.headerName, csp.value);

  return response;
});

export const config = {
  matcher: [
    // 기존 matcher 들은 인증 가드 용. nonce 는 *모든 HTML 응답* 에 박혀야 하므로
    // 별도 wildcard matcher 가 필요 — 단, /_next/* 정적 자원과 /api/* 는 제외.
    {
      source: "/((?!_next/static|_next/image|favicon.ico|api/csp-report).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
```

> **현행 matcher 와의 정합성** — 기존 matcher 는 path-prefix 5종만 잡고 있어 *대부분의 HTML 페이지를 거치지 않는다*. CSP 는 모든 HTML 에 박혀야 하므로 matcher 를 negative pattern 으로 확장 — 인증 가드 로직은 `pathname.startsWith` 분기로 이미 *path-prefix safe* 하므로 matcher 확장이 그것을 깨지 않는다.

### 4.2 buildCspHeader — 순수 함수 (테스트 친화)

```ts
// src/shared/lib/security/csp.ts (신설)
export const CSP_NONCE_HEADER = "x-nonce";

export type CspBuildInput = {
  nonce: string;
  reportOnly: boolean;
};

export type CspBuildOutput = {
  headerName: "Content-Security-Policy" | "Content-Security-Policy-Report-Only";
  value: string;
};

/**
 * 빌드 CSP 헤더 — directive 카탈로그는 §3.2 SSOT.
 * 환경변수에 의존하지 않는 순수 함수: 테스트는 nonce/reportOnly 만 주입.
 */
export function buildCspHeader({ nonce, reportOnly }: CspBuildInput): CspBuildOutput {
  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https://*.supabase.co https://picsum.photos`,
    `font-src 'self' data:`,
    `connect-src 'self' https://*.ingest.sentry.io https://api.tosspayments.com https://*.supabase.co`,
    `frame-src 'self' https://js.tosspayments.com`,
    `frame-ancestors 'none'`,
    `form-action 'self' https://api.tosspayments.com`,
    `base-uri 'self'`,
    `object-src 'none'`,
    `upgrade-insecure-requests`,
    `report-uri /api/csp-report`,
  ];

  return {
    headerName: reportOnly
      ? "Content-Security-Policy-Report-Only"
      : "Content-Security-Policy",
    value: directives.join("; "),
  };
}
```

### 4.3 layout.tsx — nonce 회수 + inline script 주입

```tsx
// src/app/layout.tsx (변경 부분만)
import { headers } from "next/headers";
import { CSP_NONCE_HEADER } from "@/shared/lib/security/csp";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get(CSP_NONCE_HEADER) ?? undefined;

  return (
    <html lang="ko">
      <body>
        {/* Next 15 의 inline script (e.g. __NEXT_DATA__) 는 자동으로 nonce 를 받지 않는다.
            대신 외부 script 만 strict-dynamic 으로 동작하면 충분하다 — 
            Next 의 inline boot script 는 'nonce-{N}' 매칭으로 통과되어야 함. */}
        {children}
      </body>
    </html>
  );
}
```

> **왜 nonce 를 명시적으로 `<script nonce={nonce}>` 에 넣지 않는가?** — Next 15 의 RSC builder 가 *middleware 의 응답 헤더에서 nonce 를 자동 감지*하여 모든 internal inline script 에 주입한다 ([Next.js 공식 가이드](https://nextjs.org/docs/app/building-your-application/configuring/content-security-policy)). 사용자 코드가 *명시적으로* `<script>` 를 쓸 때만 `headers().get(CSP_NONCE_HEADER)` 로 회수해서 직접 prop 으로 박는다. 본 프로젝트는 RSC 우선이라 사용자 inline script 가 거의 없음 → 추가 작업 0.

---

## 5. §2 — 롤아웃 게이트 (Report-Only → Enforce)

> **단일 진리**: Enforce 모드는 *현장 데이터로 검증된 후*에만 켠다. Report-Only 모드에서 1주 모니터링 → 정량 임계값 통과 → Enforce.

### 5.1 단계 정의

| Stage | 환경변수 | 헤더 | 효력 |
|---|---|---|---|
| S0 — 배포 직전 | `CSP_MODE` 미설정 | `Content-Security-Policy-Report-Only` | 위반은 신고만, 차단 없음 |
| S1 — Report-Only (1주) | `CSP_MODE=report-only` | `Content-Security-Policy-Report-Only` | S0 과 동일 — 명시적 단계 박제 |
| S2 — Enforce 후보 | `CSP_MODE=enforce` (preview 환경부터) | `Content-Security-Policy` | 실제 차단. preview 에서 골든패스 회귀 검증 |
| S3 — Production Enforce | `CSP_MODE=enforce` (production) | `Content-Security-Policy` | 운영 전면 적용 |

### 5.2 S1 → S2 게이트 — 통과 기준 (정량 임계값)

다음 5개 지표를 **연속 7일** 충족해야 S2 진입 (Sentry 대시보드 / `/api/csp-report` 수신 카운터 기반):

| # | 지표 | 임계값 | 측정 방법 |
|---|---|---|---|
| M1 | **합법 origin 위반 0건** | `connect-src`/`frame-src`/`img-src` 등에 우리가 의도한 화이트리스트 *외부에서* 발생하는 위반이 7일 누적 0건 | `/api/csp-report` Zod 검증 통과 후 Sentry `csp.violation` issue 의 `blocked-uri` 그룹화 — '0 issues in last 7d' |
| M2 | **inline script 위반 0건** | `script-src 'nonce-...'` 외 inline script 차단 시도 0건 (단, AdBlock/확장프로그램 노이즈는 §6.3 필터 후 카운트) | 동일 — `violated-directive: script-src-elem`, `blocked-uri: inline` 이 7일 누적 0건 |
| M3 | **/api/csp-report p95 latency < 50ms** | 엔드포인트 자체가 성능 부담이 되지 않음 | `withObservedRoute` metric — Sentry transactions 또는 자체 메트릭 |
| M4 | **/api/csp-report Sentry quota 영향 < 10%/일** | 위반 fanout 이 Sentry 무료 plan 5K events/month 의 일일 비례치(166 events/day)의 10% 즉 17 events/day 이하 | Sentry usage dashboard daily metric |
| M5 | **골든패스 회귀 0건** | preview 환경에서 (a) 홈 진입 → (b) 상품 목록/상세 → (c) 위시리스트 토글 → (d) 체크아웃 진입 → (e) 결제 모의 → (f) 마이페이지 까지 모든 라우트에서 CSP 위반 0건 | preview deploy 1회 + 수동 시나리오 1회 (Plan 의 QA Task) |

> **임계값 미달 시 회귀 절차**: M1/M2 위반 → directive 보정 (`connect-src` 누락 등) → re-deploy → S1 카운터 리셋 → 다시 7일 측정. M3/M4 위반 → 노이즈 필터(§6.3) 또는 sampling 도입 검토. M5 위반 → 즉시 S0 복귀, root cause 분석.

### 5.3 S2 → S3 게이트 — 1주차 모니터링 정량 지표

S2 (preview enforce) 가 통과되어 S3 (production enforce) 로 가는 1주 모니터링은 다음 4개 지표를 **연속 7일** 충족:

| # | 지표 | 임계값 | 의미 |
|---|---|---|---|
| P1 | **Production p95 LCP** | Enforce 전 baseline 대비 +50ms 이하 | nonce 생성 + 헤더 박제의 성능 영향이 인지 가능한 수준이 아님 |
| P2 | **Production CSP 차단 카운터** | 일 100건 이하 (Sentry `csp.violation` 그룹) | Enforce 후에도 차단 비율이 폭증하지 않음 — 정상 |
| P3 | **5xx error rate** | Enforce 전 baseline 대비 +0.1% 이하 | CSP 차단으로 인한 functional regression 0 |
| P4 | **체크아웃 완료율** | Enforce 전 baseline 대비 ±2% 이내 | 결제 critical path 영향 없음 — Toss 위젯이 `frame-src` 화이트리스트로 정상 동작 |

> **롤백 절차**: P1/P2/P3/P4 중 하나라도 임계값 초과 시 *즉시* Vercel 환경변수 `CSP_MODE` 를 `report-only` 로 되돌리고 (헤더 1줄 변경, 다음 cold start 부터 즉시 반영), Sentry 대시보드에서 위반 패턴을 재분석.

### 5.4 환경변수 운영

| 변수 | 값 | 환경 |
|---|---|---|
| `CSP_MODE` | 미설정 또는 `report-only` | development / preview (S0~S1) |
| `CSP_MODE` | `enforce` | preview (S2) → production (S3) — 단계적 |

> **왜 enforce 가 default 가 아닌가?** — secure-by-default 원칙과 충돌하지만, *처음 배포 시 즉시 enforce* 하면 §5.2 의 임계값을 측정할 기회 없이 실 사용자 차단이 시작된다. Report-Only 가 *기본*인 것은 *임시*이고, 본 PR 의 plan 에서 명시적 마일스톤(S1 → S2 → S3)으로 enforce 전환을 박는다.

---

## 6. §3 — `/api/csp-report` 엔드포인트 설계

### 6.1 책임

1. CSP 위반 신고 페이로드를 Zod 로 검증 — 악의적 페이로드(긴 문자열·중첩 객체) DoS 방어
2. AdBlock/확장프로그램 노이즈 필터링 (§6.3) — Sentry quota 보호
3. 검증 + 필터 통과분만 `errorTracker.captureMessage` 로 fanout — Sentry 에서 issue 로 그룹화

### 6.2 페이로드 형식 (CSP Level 2 — `report-uri` 표준)

브라우저가 보내는 페이로드는 다음 구조의 JSON:

```json
{
  "csp-report": {
    "document-uri": "https://example.com/products/abc",
    "referrer": "",
    "violated-directive": "script-src-elem",
    "effective-directive": "script-src-elem",
    "original-policy": "default-src 'self'; script-src 'self' 'nonce-...'; ...",
    "disposition": "report",
    "blocked-uri": "inline",
    "line-number": 42,
    "column-number": 12,
    "source-file": "https://example.com/products/abc",
    "status-code": 200,
    "script-sample": ""
  }
}
```

### 6.3 Zod 스키마 + 노이즈 필터

```ts
// src/app/api/csp-report/route.ts (신설)
import { NextResponse } from "next/server";
import { z } from "zod";
import { captureMessage } from "@/shared/lib/observability";
import { logger } from "@/shared/lib/observability/logger";

/**
 * CSP Level 2 report-uri payload schema.
 * - 모든 필드 optional — 브라우저 구현 편차 흡수
 * - 상한 길이 도입 — DoS 방어 (악의적 100MB JSON 차단)
 */
const cspReportSchema = z.object({
  "csp-report": z.object({
    "document-uri": z.string().max(2048).optional(),
    "referrer": z.string().max(2048).optional(),
    "violated-directive": z.string().max(256).optional(),
    "effective-directive": z.string().max(256).optional(),
    "original-policy": z.string().max(4096).optional(),
    "disposition": z.enum(["report", "enforce"]).optional(),
    "blocked-uri": z.string().max(2048).optional(),
    "line-number": z.number().int().nonnegative().optional(),
    "column-number": z.number().int().nonnegative().optional(),
    "source-file": z.string().max(2048).optional(),
    "status-code": z.number().int().optional(),
    "script-sample": z.string().max(512).optional(),
  }),
});

/**
 * 브라우저 확장프로그램 · AdBlock 이 생성하는 노이즈 패턴.
 * 이들은 *사용자 시스템*에서 발생하는 잡음이므로 Sentry 로 보내봤자 actionable 하지 않다.
 * → quota 보호 + 운영자 신호 대 잡음비 향상.
 */
const NOISE_BLOCKED_URI_PATTERNS = [
  /^chrome-extension:/i,
  /^moz-extension:/i,
  /^safari-extension:/i,
  /^safari-web-extension:/i,
  /^webkit-masked-url:/i, // Safari masked URL — 익명화된 inject script
  /^about:/i,
  /^data:/i, // data URI 위반은 의도된 directive (data: 화이트리스트 외)에서 발생하나 대부분 노이즈
];

const NOISE_SOURCE_FILE_PATTERNS = [
  /^chrome-extension:/i,
  /^moz-extension:/i,
  /^safari-extension:/i,
];

function isNoiseReport(report: z.infer<typeof cspReportSchema>["csp-report"]): boolean {
  const blocked = report["blocked-uri"] ?? "";
  const source = report["source-file"] ?? "";
  return (
    NOISE_BLOCKED_URI_PATTERNS.some((re) => re.test(blocked)) ||
    NOISE_SOURCE_FILE_PATTERNS.some((re) => re.test(source))
  );
}

export const runtime = "nodejs"; // observability stack (ALS, errorTracker) 의존 → Edge 금지

export async function POST(req: Request): Promise<NextResponse> {
  // ① Content-Type 가드 — 브라우저는 application/csp-report 또는 application/json
  const contentType = req.headers.get("content-type") ?? "";
  const validContentType =
    contentType.includes("application/csp-report") ||
    contentType.includes("application/json");
  if (!validContentType) {
    return NextResponse.json({ ok: false }, { status: 415 });
  }

  // ② Body size guard — 큰 payload 는 즉시 거부 (Next.js route handler 의 default 1MB 제한 외 명시)
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    // 잘못된 JSON — silent 200 으로 응답 (브라우저가 재시도 안 하도록)
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // ③ Zod 검증 — 실패 시 logger 만 남기고 silent 200
  const parsed = cspReportSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn("csp.report.invalid_payload", { error: parsed.error.flatten() });
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const report = parsed.data["csp-report"];

  // ④ 노이즈 필터 — AdBlock/확장프로그램 잡음 제거
  if (isNoiseReport(report)) {
    logger.debug("csp.report.noise_filtered", {
      blockedUri: report["blocked-uri"],
      sourceFile: report["source-file"],
    });
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // ⑤ Sentry fanout — captureMessage 로 issue 그룹화
  //    fingerprint 는 violated-directive + blocked-uri 의 origin 부분만 사용 → 동일 위반 1 issue
  let blockedOrigin = "";
  try {
    blockedOrigin = new URL(report["blocked-uri"] ?? "").origin;
  } catch {
    blockedOrigin = report["blocked-uri"] ?? "unknown";
  }

  captureMessage(
    `CSP violation: ${report["violated-directive"]} blocked ${blockedOrigin}`,
    "warning",
    {
      cspViolatedDirective: report["violated-directive"],
      cspBlockedUri: report["blocked-uri"],
      cspDocumentUri: report["document-uri"],
      cspSourceFile: report["source-file"],
      cspDisposition: report["disposition"],
    },
  );

  return NextResponse.json({ ok: true }, { status: 200 });
}
```

### 6.4 운영 동작 정합성

| 시나리오 | 응답 | Sentry 발신 | 비고 |
|---|---|---|---|
| 정상 CSP 위반 (Toss 위젯 미허용 origin 등) | 200 | ✅ `captureMessage("CSP violation: ...")` | 운영자 조치 |
| AdBlock inject 위반 | 200 | ❌ silent | 노이즈 필터 통과 |
| 잘못된 JSON / Zod 실패 | 200 | ❌ logger.warn 만 | 브라우저 재시도 방지 |
| 잘못된 Content-Type | 415 | ❌ | 비정상 클라이언트 차단 |

> **왜 모든 에러 케이스가 200 으로 응답하는가?** — `report-uri` 의 표준 동작은 *fire-and-forget* 이다. 4xx/5xx 응답을 받으면 일부 브라우저가 retry 큐에 적재 → trip 증가. 본 엔드포인트는 *수신 그 자체가 책임* 이고 처리 결과는 silent 200 으로 통일 (Content-Type 만 예외 — 명시적 mismatch).

---

## 7. §4 — 테스트 전략 (Vitest)

### 7.1 단위 테스트 매트릭스

| 파일 | 테스트 | 케이스 |
|---|---|---|
| `src/shared/lib/security/__tests__/csp.test.ts` (신설) | `buildCspHeader` 순수 함수 | (1) reportOnly=true → headerName 이 `-Report-Only` / (2) reportOnly=false → headerName 이 `Content-Security-Policy` / (3) nonce 가 `script-src 'nonce-{N}'` 자리에 정확히 들어감 / (4) directive 순서가 §3.2 SSOT 와 일치 / (5) `report-uri /api/csp-report` 가 끝에 존재 |
| `src/__tests__/middleware.test.ts` (신설 또는 기존 확장) | middleware nonce 주입 | (1) 응답 헤더에 `Content-Security-Policy-Report-Only` (기본) 또는 `Content-Security-Policy` (CSP_MODE=enforce) 가 존재 / (2) 요청 헤더에 `x-nonce` 가 박혀 RSC tree 로 전파 / (3) 매 요청마다 *서로 다른* nonce 생성 (랜덤성 검증 — 100회 호출 후 unique count == 100) / (4) `/api/csp-report` 경로는 matcher 가 제외 (header 미주입) |
| `src/app/api/csp-report/__tests__/route.test.ts` (신설) | 엔드포인트 동작 | (1) 정상 페이로드 → 200 + `captureMessage` 1회 호출 (mock) / (2) Zod 실패 → 200 + `captureMessage` 0회 / (3) `blocked-uri: chrome-extension://...` → 200 + `captureMessage` 0회 (노이즈 필터) / (4) Content-Type 누락 → 415 / (5) 잘못된 JSON → 200 + silent (예외 미throw) |
| `src/shared/lib/security/__tests__/csp-fixtures.test.ts` (신설, 회귀 방어) | 카탈로그 회귀 | (1) `connect-src` 에 `https://*.ingest.sentry.io` 포함 / (2) `frame-src` 에 `https://js.tosspayments.com` 포함 / (3) `frame-ancestors 'none'` 포함 / (4) `report-uri /api/csp-report` 포함 — 누군가 directive 를 임의로 빼면 즉시 빨간불 |

### 7.2 Edge runtime 제약 반영

- `middleware.test.ts` 는 `crypto.getRandomValues` 의 Edge polyfill 환경을 가정. Vitest 의 jsdom 환경에서는 native `crypto` 사용 가능 — 별도 polyfill 불필요. 다만 `auth()` 의존성은 `vi.mock("@/features/auth/server/auth", () => ({ auth: (fn) => fn }))` 로 패스스루.
- `route.test.ts` 의 `captureMessage` 는 `vi.mock("@/shared/lib/observability")` 로 spy 주입.

### 7.3 통합 검증 (QA Engineer R8 — 증거 기반)

| 검증 | 명령 | 기대 출력 |
|---|---|---|
| typecheck | `npm run typecheck` | exit 0 |
| 단위 | `npm run test src/shared/lib/security src/app/api/csp-report src/__tests__/middleware` | 모든 케이스 PASS |
| 헤더 박제 (dev) | `curl -sI http://localhost:3000/` | `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, `Content-Security-Policy-Report-Only` 7+1 헤더 출력 인용 |
| nonce 동적 (dev) | `curl -sI http://localhost:3000/ \| grep -i nonce; curl -sI http://localhost:3000/ \| grep -i nonce` | 두 호출의 nonce 값이 다름 |
| 엔드포인트 (dev) | `curl -sX POST -H 'Content-Type: application/csp-report' -d '{"csp-report":{"violated-directive":"script-src","blocked-uri":"https://evil.com"}}' http://localhost:3000/api/csp-report` | 200 + body `{"ok":true}` |
| 노이즈 필터 (dev) | `curl -sX POST -H 'Content-Type: application/csp-report' -d '{"csp-report":{"violated-directive":"script-src","blocked-uri":"chrome-extension://abc/x.js"}}' http://localhost:3000/api/csp-report` | 200 + Sentry mock 호출 0회 (logger.debug 만) |
| 골든패스 회귀 (Report-Only) | preview deploy 후 5분간 (홈/PDP/위시리스트/체크아웃/마이페이지) 클릭 → `/api/csp-report` 수신 카운터 | 의도하지 않은 위반 0건 (또는 즉시 directive 보정) |

자동화 불가 항목: Sentry dashboard 에서 `csp.violation` issue 그룹 확인 → **운영자 수동 절차** (plan Task 명시).

---

## 8. §5 — 파일별 변경 목록 (뼈대 코드)

### 8.1 신설 / 수정 파일

| # | 파일 | 변경 | 행수 추정 |
|---|---|---|---|
| F1 | `next.config.mjs` | 정적 헤더 7종 `headers()` 박제 | +40 |
| F2 | `src/shared/lib/security/csp.ts` | **신설** — `buildCspHeader` 순수 함수 + `CSP_NONCE_HEADER` 상수 | +50 |
| F3 | `src/shared/lib/security/index.ts` | **신설** — barrel export | +3 |
| F4 | `src/middleware.ts` | nonce 생성 + 응답 헤더 박제 + matcher 확장 | +20 |
| F5 | `src/app/layout.tsx` | `headers().get(CSP_NONCE_HEADER)` 회수 (선택적 — Next 자동 주입 시 무수정) | 0~+5 |
| F6 | `src/app/api/csp-report/route.ts` | **신설** — Zod 검증 + 노이즈 필터 + Sentry fanout | +120 |
| F7 | `src/shared/lib/security/__tests__/csp.test.ts` | **신설** | +80 |
| F8 | `src/shared/lib/security/__tests__/csp-fixtures.test.ts` | **신설** — 카탈로그 회귀 방어 | +40 |
| F9 | `src/app/api/csp-report/__tests__/route.test.ts` | **신설** | +120 |
| F10 | `src/__tests__/middleware.test.ts` | **신설 또는 확장** — nonce/CSP 헤더 검증 | +80 |
| F11 | `.env.example` | `CSP_MODE=report-only` 주석 추가 | +3 |
| F12 | `src/shared/lib/env.ts` | `CSP_MODE` schema 추가 (`z.enum(["report-only","enforce"]).optional()`) | +2 |

총 변경 약 +560 lines / +5 new files.

### 8.2 F1 — `next.config.mjs` 뼈대

```js
/** @type {import('next').NextConfig} */
import { withSentryConfig } from "@sentry/nextjs";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=15552000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=()",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/**" },
      { protocol: "https", hostname: "picsum.photos" },
    ],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  hideSourceMaps: true,
});
```

### 8.3 F2 — `src/shared/lib/security/csp.ts` 뼈대

→ §4.2 코드 블록 (그대로 채택)

### 8.4 F4 — `src/middleware.ts` 변경 부위 (diff 형식)

```diff
 import { auth } from "@/features/auth/server/auth";
 import { NextResponse } from "next/server";
+import { buildCspHeader, CSP_NONCE_HEADER } from "@/shared/lib/security/csp";

 export default auth((req) => {
   const traceId =
     req.headers.get("x-trace-id") ??
     crypto.randomUUID().replace(/-/g, "").slice(0, 16);

   // ... 기존 인증 가드 분기들 그대로 ...

+  // CSP nonce — 요청별 16바이트 base64 (Edge runtime 호환: crypto.getRandomValues)
+  const nonceBytes = new Uint8Array(16);
+  crypto.getRandomValues(nonceBytes);
+  const nonce = btoa(String.fromCharCode(...nonceBytes));

   const requestHeaders = new Headers(req.headers);
   requestHeaders.set("x-trace-id", traceId);
+  requestHeaders.set(CSP_NONCE_HEADER, nonce);

   const response = NextResponse.next({ request: { headers: requestHeaders } });
   response.headers.set("x-trace-id", traceId);
+
+  const csp = buildCspHeader({
+    nonce,
+    reportOnly: process.env.CSP_MODE !== "enforce",
+  });
+  response.headers.set(csp.headerName, csp.value);

   return response;
 });

 export const config = {
   matcher: [
-    "/login/:path*",
-    "/admin/:path*",
-    "/mypage/:path*",
-    "/booking/:path*",
-    "/bookings/:path*",
-    "/products/:id/checkout",
+    // CSP nonce 는 모든 HTML 응답에 박혀야 함 — 정적 자원/csp-report 만 제외
+    {
+      source: "/((?!_next/static|_next/image|favicon.ico|api/csp-report).*)",
+      missing: [
+        { type: "header", key: "next-router-prefetch" },
+        { type: "header", key: "purpose", value: "prefetch" },
+      ],
+    },
   ],
 };
```

> **인증 가드 path 분기 보존 확인**: matcher 확장은 *어떤 path 가 middleware 를 거치는가*만 결정. 기존 `pathname.startsWith("/admin")` / `startsWith("/login")` 분기는 *path-prefix 매칭* 이라 wildcard matcher 와 정합. 회귀 0 — Vitest matrix 의 인증 케이스로 검증.

### 8.5 F6 — `src/app/api/csp-report/route.ts` 뼈대

→ §6.3 코드 블록 (그대로 채택)

---

## 9. Alternatives Considered (ADR-NNNN 후보 자료)

### 옵션 A: **nonce-based CSP + HSTS Rolling Expiration (preload 배제) + 정적 헤더 7종** ✅ 채택

- 채택 이유: §1 카탈로그에 사용자 명시 승인. nonce 기반은 Next.js 15 의 RSC inline script 패턴과 정합 + `strict-dynamic` 으로 propagation 자동화. HSTS Rolling Expiration 은 §3.3.2 의 4가지 사유로 포트폴리오/소규모 운영에 최적.

### 옵션 B: **hash-based CSP (`script-src 'sha256-...'`)** — 거부

- 거부 이유: Next 의 inline script (`__NEXT_DATA__`, dev mode HMR loader) 가 매 빌드마다 해시가 바뀐다. CI 단계에서 추출·주입하는 build script 가 별도로 필요 → 복잡도 증가. Next 15 공식 가이드도 nonce 권장.

### 옵션 C: **CSP 없이 정적 헤더 7종만** — 거부

- 거부 이유: 정적 헤더는 *broad* 한 방어 (transport·MIME·referrer·permissions), CSP 는 *deep* 한 방어 (script/connect/frame 출처 통제). 둘은 보완재이고, CSP 없이는 XSS 표면적이 그대로 노출. 본 PR 의 핵심 목표는 *deep* 측 추가.

### 옵션 D: **HSTS Preload list 신청** — 거부

- 거부 이유: §3.3.2 4가지 사유 박제 — (1) 영구 하드코딩 / (2) 포트폴리오 도메인 라이프사이클 리스크 / (3) Rolling Expiration 이 충분 / (4) 성숙도-비용 미스매치. *옵션 자체가 더 안전한 게 아니라 더 비가역할 뿐*. 안전과 비가역성은 다른 차원.

### 옵션 E: **HSTS max-age 짧게 (예: 1일~1주)** — 거부

- 거부 이유: max-age 가 짧으면 활성 사용자도 만료 후 다음 접속에서 HTTP fallback 창이 생긴다 → MITM 표면적 복원. 6개월(15552000초)이 [Mozilla observatory](https://observatory.mozilla.org) 등 보안 스코어 도구의 *Grade A* 기준 최소치이고, "Rolling Expiration" 효과를 활용하려면 6개월 이상이어야 의미가 있다.

### 옵션 F: **`/api/csp-report` 자체 DB 저장 + 대시보드** — 거부

- 거부 이유: ADR-0021 (Sentry 채택) 후속이라 Sentry 가 이미 *issue grouping + alert routing + dashboard* 를 SaaS 로 제공. 자체 DB + UI 는 운영 부담만 늘리고 차별화 없음. 트래픽 증가로 Sentry quota 부담이 실질화될 때 재검토 (Sentry quota 대시보드 가 트리거).

### 옵션 G: **CSP Reporting API Level 3 (`Reporting-Endpoints` + `report-to`)** — 차기 PR

- 거부 이유: 브라우저 호환성 (Firefox 미지원, Safari 부분 지원) 이 70% 미만. Level 2 (`report-uri`) 는 Chrome/Firefox/Safari/Edge 전체에서 안정 — baseline 으로 우선 채택, Level 3 는 호환성 충족 후 별 PR.

### 옵션 H: **middleware 대신 `next.config.mjs` 의 `headers()` 함수에서 CSP 도 박제** — 거부

- 거부 이유: `headers()` 는 *빌드타임 정적 함수* → 요청별 nonce 생성 불가. nonce 없는 CSP 는 `'unsafe-inline'` 을 강제로 켜야 해서 보호 효과가 사실상 소실. middleware 가 CSP 의 유일한 자리.

> **ADR-NNNN 발행 약속**: 본 PR 완료 후 위 비교 매트릭스를 ADR 로 박제 (사용자 결정사항 — HSTS preload 배제 + nonce CSP 채택 + Rolling Expiration 사유).

---

## 10. Implementation Outline (writing-plans skill 로 확장 예정)

체크박스 plan 은 다음 턴에서 `writing-plans` 스킬로 작성. 본 spec 은 *무엇을 만들지·왜 만들지*, plan 은 *어떤 순서·어떤 증거로 만들지* 까지 책임.

대략적 Task 분해 (참고용):

1. **Task 1** — `next.config.mjs` 정적 헤더 7종 박제 (TDD: `__tests__/next-config-headers.test.ts` 회귀 가드)
2. **Task 2** — `src/shared/lib/security/csp.ts` 신설 + `buildCspHeader` 순수 함수 TDD
3. **Task 3** — `src/shared/lib/env.ts` `CSP_MODE` schema 확장 + test
4. **Task 4** — `src/middleware.ts` nonce 주입 + matcher 확장 + middleware test
5. **Task 5** — `src/app/api/csp-report/route.ts` 신설 + Zod + 노이즈 필터 + route test
6. **Task 6** — preview 환경 Report-Only 배포 + §5.2 (S1→S2) 모니터링 1주
7. **Task 7** — preview 환경 Enforce 전환 (S2) + §5.3 (S2→S3) 모니터링 1주
8. **Task 8** — production Enforce 전환 (S3) + 운영 1주 무사고 후 ADR-NNNN 발행

> Task 6~8 은 **시간 게이트** 가 박힌 단계. 각 게이트의 정량 임계값(§5.2 / §5.3)을 만족하지 못하면 *전 단계로 자동 회귀*.

---

## 11. Notes / Out-of-Scope

- **별 PR 후보**:
  - SRI (Subresource Integrity) — CDN 도입 시
  - Trusted Types (`require-trusted-types-for 'script'`) — React 19 호환성 검증 후
  - CSP Reporting API Level 3 (`Reporting-Endpoints` + `report-to`)
  - style-src nonce 화 (`'unsafe-inline'` 제거) — Tailwind/inline style 영향도 분석 후
  - Rate Limit B2-C — `/api/csp-report` 외 결제·인증 critical path 모두 포함
- **Vercel 운영 체크리스트** (Task 6~8 에 포함):
  - `CSP_MODE` 환경변수의 scope (`development` 미설정 / `preview` 단계적 / `production` S3 후)
  - Sentry `csp.violation` issue 알림 채널 연결 (옵션 — Slack webhook)
- **모니터링 후보 지표**:
  - `/api/csp-report` 일일 수신 카운터
  - Sentry `csp.violation` issue daily new count
  - production p95 LCP (Enforce 전후 비교)
  - 체크아웃 완료율 (Enforce 전후 비교)
- **6개월 뒤 의심받을 가능성**:
  - "왜 `style-src 'unsafe-inline'` 이 남아있지?" — Tailwind/inline style 분석 PR 미진. style-src nonce 화 도입 시점에 정리.
  - "왜 Permissions-Policy 가 보수적이지 않지?" — 추가 기능(`autoplay`, `usb`, `xr-spatial-tracking` 등)을 명시적으로 차단할지 결정 필요. 현재는 minimum baseline.
  - "왜 HSTS preload 가 없지?" — §3.3.2 + ADR-NNNN 참조. 의도된 결정.
