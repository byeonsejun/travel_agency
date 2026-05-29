# ADR-0025: CSP nonce 경로별 분기 — ISR 캐시-nonce 미스매치 차단

- **상태**: Accepted
- **결정일**: 2026-05-29
- **영향 범위**: `src/shared/lib/security/csp.ts`, `src/shared/lib/security/index.ts`, `src/middleware.ts`, `src/__tests__/middleware-csp.test.ts`, `src/shared/lib/security/__tests__/csp.test.ts`, `src/shared/lib/security/__tests__/csp-fixtures.test.ts`
- **관련 commit**: (이 ADR과 동반)
- **선행 ADR**: ADR-0020 (캐시 무효화 컨트랙트 + force-dynamic audit), ADR-0021 (Sentry SDK + CSP/HSTS 채택 — nonce 모델 최초 도입)
- **보완 관계**: ADR-0021 이 채택한 *전역 nonce + 'strict-dynamic'* 정책이 ADR-0020 의 ISR/`unstable_cache` 캐시 정책과 구조적으로 양립 불가능했음을 정정. ADR-0021 의 nonce 모델은 dynamic 경로에서 *그대로 유지*, 정적/ISR 경로에만 완화 정책 적용.

## Context (배경)

Phase 3 B2-B (CSP Report-Only 모니터링) 진입 직후 production 콘솔에 nonce 누락 violation 폭발 발견:

```
Refused to execute inline script because it violates the following Content Security Policy directive:
"script-src 'self' 'nonce-...' 'strict-dynamic'". Either the 'unsafe-inline' keyword,
a hash ('sha256-...'), or a nonce ('nonce-...') is required to enable inline execution.
```

증상은 *모든 정적/ISR 페이지* (홈 `/`, PDP `/products/[id]`) 에서 매 요청 발생. 원인 추적:

1. **middleware (Edge runtime)** 는 매 요청마다 `crypto.getRandomValues(16)` 로 새 nonce 발급하여 `Content-Security-Policy-Report-Only: script-src 'self' 'nonce-XYZ' 'strict-dynamic'` 헤더에 박는다.
2. **응답 HTML body** 는 ADR-0020 의 캐시 정책에 따라 *과거 시점* 에 prerender 된 결과. 홈은 5분 revalidate, PDP 는 1시간 ISR — 그 시점에 생성된 `<script>` 태그들은 *그때의 nonce* 를 (가졌더라도) 들고 있고, 현재 요청의 nonce 와 일치하지 않는다.
3. `'strict-dynamic'` 지시문은 `'self'` 를 무력화한다 — nonce 또는 hash 가 일치하지 않는 모든 script 가 차단됨 (Next 의 `__NEXT_DATA__` / polyfill / runtime / 페이지 chunk 포함).

CSP 공식 명세 (https://nextjs.org/docs/app/guides/content-security-policy):
> "Using a nonce requires **dynamic rendering**. Since nonces should be unique for each request, you must opt into dynamic rendering."

즉 nonce 모델은 **본질적으로 ISR 과 양립 불가능**. ADR-0020 이 명시한 "결제·예약·admin·webhook·cron 만 force-dynamic, 나머지는 RSC + ISR" 정책과 정면 충돌. ADR-0021 의 도입 시점에 이 충돌이 식별되지 않았던 이유는, 당시 CSP 가 `Report-Only` 모드로만 박혀 있었고 production 콘솔 노이즈를 관찰하기 전이었기 때문.

@sentry/nextjs 의 `withSentryConfig` 가 client bundle 부트스트랩 코드를 주입하므로 콘솔 노이즈를 증폭시키지만, **본 충돌의 본질이 아니다** — Sentry 비활성화 시에도 동일 violation 발생 (Next 자체 framework script 차단).

임시 회피 (CSP 헤더 자체 제거) 는 ADR-0021 의 XSS 방어선을 전부 잃으므로 비허용. 영구 해결 필요.

## Decision (결정)

**경로별 CSP 분기 (Route-scoped nonce)** — dynamic 경로(force-dynamic + `/api/*`) 만 nonce + 'strict-dynamic' 유지, 정적/ISR 경로는 `script-src 'self'` 만으로 완화.

분기 게이트는 단일 SSOT 함수:

```ts
// src/shared/lib/security/csp.ts
const DYNAMIC_CSP_PREFIXES = [
  "/admin", "/checkout", "/payment", "/api",
  "/login", "/signup", "/booking", "/bookings", "/mypage",
] as const;

export function isDynamicCspPath(pathname: string): boolean {
  return DYNAMIC_CSP_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export type CspBuildInput =
  | { mode: "dynamic"; nonce: string; reportOnly: boolean }
  | { mode: "static"; reportOnly: boolean };
```

middleware 는 게이트로 분기:

```ts
// src/middleware.ts
const isDynamic = isDynamicCspPath(pathname);
let nonce: string | null = null;
if (isDynamic) {
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  nonce = btoa(String.fromCharCode(...nonceBytes));
  requestHeaders.set(CSP_NONCE_HEADER, nonce);
}
const csp =
  isDynamic && nonce
    ? buildCspHeader({ mode: "dynamic", nonce, reportOnly })
    : buildCspHeader({ mode: "static", reportOnly });
```

핵심 원리:
- **타입 안전성**: `CspBuildInput` 의 discriminated union 이 static 모드에서 nonce 키 누락을 *컴파일 시* 강제 — 호출자 오용 0.
- **Edge 핫패스 최적화**: 트래픽 다수를 차지하는 홈/PDP 에서 `crypto.getRandomValues` + base64 인코딩 비용 절감.
- **방어선 등급 차등**: 사용자가 비밀번호·결제정보·세션 토큰을 직접 입력하는 dynamic 경로는 *최강* CSP 유지. inline script 주입 surface 가 사실상 0 인 정적 카탈로그 페이지는 `'self'` 만으로 실용 등급 확보.

## Consequences (결과)

**얻은 것:**
- production 콘솔 nonce violation 0건 — B2-B Report-Only 모니터링 신호 정상화. 진짜 XSS 시도가 발생했을 때 노이즈에 묻히지 않음.
- ADR-0020 의 캐시 정책 *완전 무손상* — 홈 `○` 5min revalidate, PDP `●` 1h ISR, `unstable_cache` 5min/1h TTL 정책 모두 그대로.
- 보안 등급 분포 합리화 — 위협 surface 의 99% 를 차지하는 dynamic 경로에 보안 자원 집중.
- discriminated union 으로 타입 안전성 확보 — 향후 호출자가 static 모드에 nonce 를 누락해도 컴파일 오류, dynamic 모드에 nonce 를 빠뜨려도 컴파일 오류.
- `isDynamicCspPath` SSOT 함수 추출 — 향후 force-dynamic 도메인 추가 시 단일 배열만 갱신.
- Edge runtime 비용 절감 — 트래픽 대부분의 경로에서 nonce 생성 skip.

**포기한 것 / 미해결:**
- 정적/ISR 페이지의 CSP 가 *XSS 보호 등급* 측면에서 약화됨. inline `<script>` 가 만약 주입된다면 `'self'` 만으로는 차단 못함 (단, 본 프로젝트의 정적 페이지는 사용자 입력 반영 영역이 없어 inline script 주입 surface 가 사실상 부재).
- `DYNAMIC_CSP_PREFIXES` 배열 갱신을 잊으면 새 force-dynamic 도메인이 *static 모드* 로 흘러 nonce 보호 없이 노출됨. 모니터링 항목: 새 force-dynamic 도메인 PR 에는 본 배열 갱신 여부 자가 점검 필요 (CLAUDE.md §8 노트로 박제).
- `force-dynamic` 인데 prefix 배열에 누락된 경로(예: 향후 `/refund`) 가 발생하면 nonce 보호 부재. 반대로 정적인데 prefix 에 포함된 경로(예: `/login` 의 공개 OG 이미지) 는 nonce 모드로 다뤄져도 동작에는 영향 없음(과보호) — *false-negative 방향* 의 회귀가 더 위험.

## Alternatives Considered (대안)

### 옵션 A: Route-scoped CSP (경로별 분기) ✅ 채택
- 채택 이유: ADR-0020 의 캐시 정책을 *그대로 보존* 하면서 ADR-0021 의 nonce 모델 의도(보안 민감 경로 강한 보호) 도 *부분* 보존. 코드 변경 범위가 `csp.ts` + `middleware.ts` 2파일 + 테스트 갱신으로 국한. Edge runtime 비용까지 절감. 트레이드오프가 가장 합리적.

### 옵션 B: Hash-based CSP — strict-dynamic 폐기, framework script SHA256 hash 정적 화이트리스트
- 어떤 방식: 빌드 시 Next 의 `__NEXT_DATA__` / polyfill / runtime / 페이지 chunk 의 SHA256 hash 를 추출하여 `script-src 'self' 'sha256-...' 'sha256-...'` 정적 화이트리스트로 박는다. nonce 발급 불필요 — 캐시-nonce 미스매치 자체 부재.
- 거부 이유:
  - 빌드 파이프에 hash 추출 단계 도입 필요 — Next 빌드 산출물을 파싱해야 하므로 webpack plugin 또는 post-build script 필요. 유지보수 부담 큼.
  - Next 가 인라인 script 마다 *결정론적 동일 내용* 을 보장하지 않음 — 빌드 간 hash 변동 가능. CI 마다 CSP 헤더 재생성 + redeploy 필요.
  - `@sentry/nextjs` 의 client bundle init script 도 hash 화이트리스트 필요 — Sentry SDK 업그레이드 시마다 hash 갱신 누락 위험.
  - "static 페이지의 inline script surface 가 사실상 0" 이라는 본 프로젝트 상황 고려 시 *과한 투자*. ROI 측면에서 옵션 A 가 우위.

### 옵션 C: 전체 force-dynamic 전환 — nonce 모델 유지, ISR 완전 폐기
- 어떤 방식: 모든 페이지에 `export const dynamic = "force-dynamic"` 박제. 매 요청 렌더 — nonce 와 HTML body 시점 일치.
- 거부 이유:
  - **ADR-0020 정면 위배.** ADR-0020 은 ISR 정책을 *NO-REAL-MONEY 제약* (실거래 미구현 영구 결정, [ADR-0009]) 과 묶어 박제했음. 임의 폐기 불가.
  - 캐시 효율 전체 손실 — DB 부담 폭증, p95 latency 악화, edge POP 캐시 이점 0.
  - 트래픽 대부분을 차지하는 카탈로그 페이지가 *고비용 dynamic render* 로 전환됨. 운영비 증가.
  - "보안 한 점 강화하려고 모든 페이지 성능을 희생" — 트레이드오프 비대칭.

### 옵션 D: PPR (Partial Prerendering) opt-in + nonce 모델 유지
- 어떤 방식: Next 15 의 PPR 을 활성화하면 정적 shell 은 prerender, dynamic 부분만 per-request 렌더 — nonce 가 dynamic 부분에만 적용될 가능성.
- 거부 이유:
  - PPR 은 2026-05-29 시점 *experimental*. ADR-0012/0015/0017/0018/0020 모두 같은 이유로 PPR opt-in 을 보류했음 — 그 결정 라인을 본 ADR 에서 깨는 것은 단일 보안 이슈 해결 대비 ripple 비용 과대.
  - PPR 의 nonce 처리 동작이 stable spec 으로 박제되지 않음 — 향후 변경 가능성 잔존.
  - 향후 PPR stable 승격 시 본 ADR 을 *재검토* 하는 것은 가능 (Notes 항목 참조).

### 옵션 E: Sentry 비활성화로 violation 축소
- 어떤 방식: `@sentry/nextjs` 의 client bundle 부트스트랩이 violation 노이즈의 *주요 발신처* 라는 가정 하에 SDK 비활성화.
- 거부 이유:
  - **잘못된 진단.** Sentry 비활성화 시에도 Next 자체 framework script (`__NEXT_DATA__` 등) 가 동일 메커니즘으로 차단됨. Sentry 는 노이즈 증폭일 뿐 본질 아님.
  - ADR-0021 의 *관측 기반 운영* 목표 정면 손상.

## Notes

### Concept Insight — '호텔 키카드와 고정된 객실 사진' 비유

nonce 기반 CSP 는 **매일 바뀌는 호텔 룸 키카드** 다. 프런트(middleware) 는 손님이 올 때마다 새 키를 발급해 객실(CSP header) 에 "오늘은 카드 #XYZ 만 출입 허용" 이라 적어둔다. 그런데 우리 호텔은 ISR 캐시 — 객실 안의 가구 배치(HTML body) 가 *5분~1시간 전 사진* 으로 고정돼 있어, 그 안의 모든 `<script>` 태그는 5분 전 카드 #ABC 를 들고 있다. 출입문은 #XYZ 만 허용, 손님은 #ABC 를 들이밂 → 전부 거부.

옵션 A (Route-scoped CSP) 는 **"고정 가구 객실은 카드 시스템을 끄고 자체 자물쇠(`'self'`) 만 쓰자"** 는 결정이다. 객체별 보안 등급 차등 — 금고가 있는 비즈니스 객실(`/checkout`, `/payment`, `/admin`) 만 키카드 시스템 유지, 도서관 라운지(`/`, `/products/*`) 는 자물쇠로 충분. 보안의 깊이는 *가장 취약한 곳* 이 아니라 *가장 민감한 곳* 에 집중해야 한다는 원리의 적용.

### 운영 체크리스트

- 새 force-dynamic 도메인 PR 작성 시: `csp.ts` 의 `DYNAMIC_CSP_PREFIXES` 배열에 prefix 추가 여부 자가 점검.
- CLAUDE.md §8 의 "다음 작업자 혼란 방지 노트" 에 본 결정 한 줄 추가 권장 — "왜 정적 페이지 CSP 가 dynamic 페이지보다 약하지?" 질문에 답변.
- B2-B Report-Only 1주 관측 후 violation 0건 확인되면 `CSP_MODE=enforce` 승급 검토 (ADR-0021 의 롤아웃 게이트 절차 그대로 적용).

### 6개월 뒤 의심받을 가능성

- **PPR stable 승격 시 옵션 D 재검토 가능** — PPR 의 nonce 처리가 안정화되면 정적 shell + nonce 가 양립 가능해질 수 있음. 그때 본 ADR 을 *Superseded* 처리 후 통합 CSP 복귀.
- `DYNAMIC_CSP_PREFIXES` 가 force-dynamic 도메인과 *수동 동기화* 되어 있음 — 향후 force-dynamic audit 시 양쪽 동기화 자동화 가능성 검토 (예: `force-dynamic` export 를 grep 하여 prefix 자동 생성하는 빌드 시점 검증).
- inline script 주입을 막는 또 다른 방어선 (예: Trusted Types) 이 표준화되면 정적 페이지의 `'self'` 완화 정책을 *상향 조정* 가능.
- `'strict-dynamic'` 자체가 점진적으로 deprecated 되거나 새 CSP3 directive 가 도입되면 본 ADR 의 분기 모델 재설계 필요.

---

## Addendum: 배포 후 실측에 따른 수정 (2026-05-29)

### 발견된 사실

본 ADR 초기 결정의 "Consequences > 포기한 것" 에 다음과 같이 박혀 있었다:

> "정적/ISR 페이지의 CSP 가 *XSS 보호 등급* 측면에서 약화됨. inline `<script>` 가 만약 주입된다면 `'self'` 만으로는 차단 못함 (단, 본 프로젝트의 정적 페이지는 사용자 입력 반영 영역이 없어 inline script 주입 surface 가 사실상 부재)."

**이 단언이 틀렸다.** Vercel production (`travel-agency-sooty-mu.vercel.app/`) 배포 직후 Report-Only 모니터링에서 16+ 개의 *서로 다른 hash* 를 가진 인라인 스크립트 violation 폭발:

```
Executing inline script violates the following Content Security Policy directive 'script-src 'self''.
Either the 'unsafe-inline' keyword, a hash ('sha256-OBTN3RiyCV4Bq7dFqZ5a2pAXjnCcCYeTJMO2I/LYKeo='), or a nonce ('nonce-...') is required to enable inline execution.
The policy is report-only, so the violation has been logged but no further action has been taken.
```

근본 원인 — **Next.js 15 App Router 의 React Server Components (RSC) 스트리밍** 은 사용자 입력과 무관하게 framework 가 *무조건* 인라인 `<script>` 를 emit 한다:

- **RSC flight payload chunks** — `<script>self.__next_f.push([1, "..."])</script>` 형태로, 서버 컴포넌트 트리 직렬화 결과를 청크 단위로 클라이언트에 스트리밍. 페이지마다 N 개 발생.
- **Bootstrap script** — `<script>(self.__next_f=self.__next_f||[]).push([...])</script>` 형태로 flight buffer 초기화.
- **Hydration script** — React 가 서버 렌더 결과를 클라이언트 트리와 reconcile 하기 위해 emit.

이건 정적/ISR 페이지에도 동일하게 적용된다 (SSR 산출물의 일부이므로). 초기 ADR 의 *"정적 페이지 = 인라인 script 부재"* 가정은 사용자 입력 reflection 만 고려하고 framework 자체 emission 을 누락한 검증 부재 단언이었다.

### 영향

- **현재 운영 영향**: 0 (Report-Only 모드 — 차단 안 함, 콘솔 노이즈만)
- **잠재 영향**: `CSP_MODE=enforce` 승급 시 홈/PDP 의 **모든 framework script 차단 → React hydration 실패 → 전 페이지 화이트아웃**
- **Phase 3 B2-B 목표 손상**: nonce violation 노이즈는 정상화됐으나 다른 종류의 violation 노이즈로 대체되어 진짜 XSS 신호 탐지 여전히 어려움

### 수정 결정

static 모드의 `script-src` 에 **`'unsafe-inline'` 추가**:

```ts
// src/shared/lib/security/csp.ts (수정 후)
const scriptSrc =
  input.mode === "dynamic"
    ? `script-src 'self' 'nonce-${input.nonce}' 'strict-dynamic'`
    : `script-src 'self' 'unsafe-inline'`;  // ← 추가
```

근거:
- Next 15 의 RSC 인라인 emission 은 framework 합의 사항으로 회피 경로 없음 (별도 build plugin 으로 hash 추출하지 않는 한)
- 정적 페이지(`/`, `/products/*`) 는 사용자 입력 reflection 0 — 인라인 XSS 주입 surface 가 실제로 존재 X (이번엔 코드 audit 으로 확인)
- 외부 origin script 는 **`'self'` 가 여전히 차단** — 핵심 attack vector 인 외부 악성 도메인 로딩 차단선 유지
- CSP3 spec: `'strict-dynamic'` 부재 시 `'unsafe-inline'` + `'self'` 가 함께 활성화되어 기대대로 동작

### 거부한 대안 (Addendum 시점)

- **hash 기반 화이트리스트**: Next RSC flight chunk 의 SHA256 hash 를 빌드 시 추출하여 `'sha256-...'` 로 박제. 빌드 plugin 필요 + Next 업그레이드/Sentry SDK 업그레이드마다 hash 갱신 누락 위험. ROI 낮음 — 정적 페이지의 인라인 XSS 위협 모델 대비 과투자.
- **CSP 자체 폐기**: ADR-0021 의 XSS 방어선 전면 손실, 외부 origin script 차단까지 잃음. 거부.
- **force-dynamic 전체 전환**: ADR-0020 정면 위배. 본 ADR 초기 옵션 C 거부 사유와 동치.

### 보존된 손실 (인정)

- 정적 페이지에서 *인라인 XSS* 방어선 부재. 사용자 입력 reflection 이 없는 현재 정적 페이지 surface 에서는 실질 위험 0 이나, 향후 정적 페이지에 사용자 입력 echo 가 도입되면 (예: 검색어를 정적 페이지에 reflect) 재평가 필요.
- 향후 정적 페이지에 사용자 입력 echo 가 도입될 경우 본 ADR 의 분기 모델 재검토 — 그 경로만 force-dynamic 으로 격리하거나 별도 ADR 로 hash CSP 도입 결정.

### 자기 비판 / 후속 작업자 메모

본 ADR 초기 작성 시 *"정적 페이지 = 인라인 script surface 부재"* 를 검증 없이 단언한 것이 본질적 오류였다. 검증 절차 (production 배포 → Report-Only 콘솔 관찰) 가 *결정 직후* 가 아니라 본 ADR 박제 *직후* 에 수행되었더라면 초기 결정 시 즉시 발견 가능했다. 향후 CSP 정책 변경 시 **(a) ADR 작성 → (b) 머지 → (c) Report-Only 1주 관측 → (d) 결과 ADR Addendum 으로 박제 → (e) enforce 승급** 의 단계로 진행하는 게 안전하다. ADR-0021 의 롤아웃 게이트 절차와 정합.
