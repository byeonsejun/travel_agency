# ADR-0062: GA4 분석은 GTM 단일 설치 + "클라이언트 퍼널 / 서버 매출" 하이브리드 — purchase·refund 는 트랜잭셔널 아웃박스 → Measurement Protocol

- **상태**: Accepted
- **결정일**: 2026-10-14
- **영향 범위**: `src/app/(site)/layout.tsx`, `src/shared/lib/security/csp.ts`, `src/shared/lib/analytics/`(신규), `src/shared/lib/analytics-job/`(신규), `src/shared/ui/TrackEvent.tsx`(신규), `src/entities/booking/{api/mutations.ts,model/analyticsPolicy.ts}`, `src/entities/payment/api/{refund,refundRetry}.ts`, `src/features/{checkout,wishlist}/**`, `src/app/api/cron/dispatcher/route.ts`, `prisma/schema.prisma`(+ `20261014000000_analytics_job`), `src/app/layout.tsx`
- **관련 commit**: `c854111`(env) · `af2166a`(CSP) · `cbfe1bf`(GTM) · `26d64f6`(이벤트 SSOT) · `a4caee7`·`a8d1b7f`(퍼널 배선, TrackEvent shared 이관) · `7d3fb53`(스키마) · `494b3ec`(hydration) · `973bc20`(gaClientId) · `290a976`(MP 워커) · `fa17004`(아웃박스 배선) · `d58f6d3`(cron) · `35d6753`(E2E) — plan: `docs/superpowers/plans/2026-10-14-ga4-gtm-analytics.md`

## Context (배경)

서비스에 사용자 행동·전환 분석이 전무했다. 자체 RUM(`features/rum`, Web Vitals)은 성능만 보고 "어디서 이탈하고 무엇이 팔리는가"는 답하지 못한다. 업계 표준인 GA4 를 붙이되, 이 저장소 고유의 제약 네 가지가 "스니펫 한 줄 붙이기"를 막았다:

1. **CSP 이원화**([ADR-0025]/[ADR-0039]) — 정적/ISR 경로는 `script-src 'self' 'unsafe-inline'`, 결제·예약 등 동적 경로는 `nonce + 'strict-dynamic'`. 외부 태그는 양쪽 모두에서 기본 차단된다.
2. **렌더링 정책**([ADR-0053]) — 홈 `○`, PDP·목록·검색·체크아웃 `◐`(PPR). 이벤트 발화 때문에 페이지를 `'use client'`로 바꾸거나 layout 에서 `headers()`를 읽으면 정적 셸이 무너진다.
3. **매출 이벤트의 신뢰성** — 결제 성공 페이지(`ConfirmPayment`)는 confirm 직후 즉시 `router.replace` 하고, 광고차단기는 GA 요청을 통째로 막는다. 클라이언트 `purchase`는 구조적으로 유실된다. 부분환불([ADR-0036])은 booking 전이조차 없어 브라우저 이벤트로는 잡을 방법이 없다.
4. **외부 IO 는 Tx 밖**([ADR-0003]) — 결제 확정 경로에 GA 호출을 동기로 끼우면 GA 지연·장애가 결제에 전파된다.

## Decision (결정)

**GTM 하나만 코드에 설치하고 GA4 는 GTM 안에서 구성한다. 이벤트는 성격에 따라 두 경로로 나눈다.**

| 경로 | 이벤트 | 방식 |
|---|---|---|
| 클라이언트 | `view_item_list` `view_item` `search` `add_to_wishlist` `begin_checkout` `add_payment_info` | RSC 가 `shared/lib/analytics` 빌더로 payload 생성 → `shared/ui/TrackEvent`(null 렌더 island)가 `dataLayer.push` → GTM → GA4 |
| 서버 | `purchase` `refund` | 도메인 Tx 안에서 `AnalyticsJob` 적재(아웃박스) → cron 워커가 GA4 **Measurement Protocol** 로 발송 |

```ts
// entities/booking/api/mutations.ts — transitionStatusTx (EmailJob 아웃박스 바로 옆)
const analyticsDescriptor = analyticsJobForTransition(current.status, to, bookingId); // PAID → PURCHASE
if (analyticsDescriptor) {
  await enqueueAnalyticsJob(tx, { ...analyticsDescriptor, bookingId, occurredAt: new Date() });
}
// entities/payment/api/refund.ts · refundRetry.ts — settle Tx, 모든 kind, 0원 제외
if (core.refundAmount > 0) await enqueueAnalyticsJob(tx, { type: "REFUND", dedupeKey: `ga-refund:${id}`, ... });
```

세부 규칙:
- **귀속**: 체크아웃 시 `_ga` 쿠키를 `Booking.gaClientId` 로 스냅샷 → MP `client_id`. 없으면 `srv.<bookingId>` 폴백(매출은 보존, 유입 귀속만 상실).
- **금액**: 동결 스냅샷만 — purchase 는 `Booking.totalPrice` + `Traveler.paxType/unitPrice`(예약 시점 단가), refund 는 `RefundJob.amount`. 출발일 가격이 이후 바뀌어도 보고 금액 불변([ADR-0027] D2 동형).
- **멱등**: `dedupeKey` @unique(`ga-purchase:<bookingId>` / `ga-refund:<refundJobId>`) + find-then-create(P2002 Tx abort 회피) + GA4 의 `transaction_id` 중복제거.
- **72h 한도**: MP 는 `timestamp_micros` 를 72시간까지만 백데이트 허용 → 초과 job 은 발송 없이 `SKIPPED`.
- **환경 분기**: `NODE_ENV !== "production"` 이면 MP fetch 0(로그만). GTM 은 `(site)` 셸에만(admin 제외), ID 미설정 시 렌더 0.
- **CSP**: `script-src`/`connect-src`/`img-src` 에 GTM·GA4 출처 추가(양 모드). `CSP_MODE=enforce` 실측에서 strict-dynamic 경로 포함 위반 0 — `next/script` 가 신뢰된 Next 런타임에 의해 동적 삽입되어 nonce 없이도 신뢰 전파로 통과.

## Consequences (결과)

**얻은 것:**
- 결제·환불 매출이 광고차단기·페이지 이탈과 무관하게 **유실 0**으로 GA4 에 도달(도메인 Tx 와 원자적 적재). 부분환불까지 보고되어 GA4 순매출이 실제와 맞는다.
- 페이지 렌더 정책 무손상 — 홈 `○` / PDP·목록·검색·체크아웃 `◐` 유지, 비-API `ƒ` 증가 0(빌드 실측).
- 결제·환불 도메인 코드 변경은 enqueue 호출 3곳 + `gaClientId` 저장 1줄뿐(가격·상태·좌석 로직 0줄).
- 태그 추가·변경은 코드 배포 없이 GTM 콘솔에서. 이벤트 스키마는 `shared/lib/analytics` 한 곳이 SSOT(PII 화이트리스트 매핑, 정수 금액 가드).

**포기한 것 / 미해결:**
- **purchase 는 실시간이 아니다** — Vercel Hobby 의 일 1회 dispatcher cron 이라 최대 ~24h 지연. 이벤트 *일시*는 `timestamp_micros`(occurredAt)로 정확하지만 실시간 보고서에는 늦게 뜬다. cron 이 72h 넘게 멈추면 그 구간 매출은 `SKIPPED`(GA4 영구 누락, DB 에는 기록 잔존).
- `gaClientId` 가 없는 구매(쿠키 차단·GA 로드 전 결제)는 `srv.*` 로 들어가 유입 경로 분석에서 빠진다.
- 쿠키 동의 배너 미도입(아래 대안 E).
- `/debug/mp/collect` 는 payload 스키마만 검증하고 api_secret 유효성은 검증하지 않는다 — 실수신은 배포 후 GA4 실시간/DebugView 로만 확인 가능.

## Alternatives Considered (대안 — 가장 중요한 섹션)

### 옵션 A: gtag.js 직접 설치 (GTM 없이)
- `@next/third-parties` 의 `GoogleAnalytics` 로 GA4 만 직접 로드.
- **거부**: 태그 추가·수정마다 코드 배포가 필요하고, 마케팅 태그(광고 픽셀 등) 확장 지점이 없다. GTM 을 써도 런타임 비용 차이는 미미하고, CSP 허용 출처도 동일(`googletagmanager.com`).

### 옵션 B: 클라이언트 purchase (성공 페이지에서 dataLayer push)
- 가장 흔한 구현.
- **거부**: (1) 광고차단기가 GA 요청을 막으면 매출이 통째로 사라진다. (2) `ConfirmPayment` 가 confirm 직후 `router.replace` 하므로 발화 전 이탈 가능. (3) 부분환불·cron 재시도 환불은 브라우저가 관여하지 않아 원천적으로 불가능. 매출은 분석의 가장 중요한 숫자인데 가장 유실되기 쉬운 경로에 둘 수 없다.

### 옵션 C: 클라이언트 + 서버 이중 purchase (transaction_id 중복제거에 의존)
- 둘 다 보내고 GA4 가 `transaction_id` 로 하나만 남기길 기대.
- **거부**: 중복제거는 GA4 내부 동작이라 보장 범위가 문서상 명확하지 않고, 실패 시 매출이 2배로 부풀어 더 나쁜 데이터가 된다. 단일 경로(서버)가 추론하기 쉽다. 클라이언트에는 purchase 직전 단계(`add_payment_info`)까지만 둔다 — E2E 가 "클라이언트 purchase 0"을 단언.

### 옵션 D: 결제 confirm 핸들러에서 MP 동기 호출
- 아웃박스 없이 `/api/payments/confirm` 성공 직후 바로 MP fetch.
- **거부**: 외부 IO 가 결제 경로에 직결(GA 지연 = 결제 응답 지연), confirm 후 롤백·재시도 시 GA 와 DB 불일치, 실패 재시도 수단 없음. [ADR-0003]·[ADR-0030](메일 아웃박스)과 같은 이유로 거부 — 같은 문제엔 같은 패턴.

### 옵션 E: 쿠키 동의 배너 + Consent Mode v2
- GDPR 대응 표준.
- **보류**: 국내 대상 서비스라 EEA 동의 의무가 직접 적용되지 않는다. 국내(PIPA)는 처리방침 고지로 대응하는 것이 일반적이며, 현재 사이트에는 처리방침 *페이지*가 없어(푸터 텍스트만) 백로그로 기록. 해외(EEA) 트래픽을 받게 되면 재논의.

### 옵션 F: GTM Server-side 컨테이너(sGTM)
- 서버 태깅 표준 인프라.
- **거부**: 별도 호스팅(Cloud Run 등)과 비용이 필요하고, 이 규모의 서버 이벤트 2종(purchase/refund)에는 MP 직접 호출로 충분하다.

### 옵션 G: CSP 를 위해 middleware 가 요청 헤더에 CSP 를 실어 Next 자동 nonce 부여
- strict-dynamic 경로에서 GTM 이 막힐 경우의 대비책(plan Task 3 "대안 B").
- **불필요로 판명**: enforce 실측에서 `next/script` 동적 삽입이 신뢰 전파로 통과(위반 0). middleware 변경 없이 해결되어 채택하지 않음.

## Notes

- **운영 함정 2건**(plan Task 7 기록):
  1. GTM 맞춤 이벤트 트리거는 **"정규 표현식 일치 사용"** 체크가 필수. 미체크 시 조건이 `_event 같음 ^(...)$` 로 표시되며 전부 실패한다.
  2. Tag Assistant 미리보기가 "localhost 연결 시간 초과"면 원인은 정적 보안 헤더 `Cross-Origin-Opener-Policy: same-origin`([ADR-0039])이 window.opener 통신을 끊는 것. **헤더를 완화하지 말고** Chrome 확장 *Tag Assistant Companion* 으로 해결. 확장이 `<html>` 에 `data-tag-assistant-*` 를 주입해 dev hydration 경고가 나므로 root layout `<html suppressHydrationWarning>`(그 요소 속성에만 적용).
- **E2E 격리**: `.env` 의 실 GTM ID 로 테스트 트래픽이 운영 GA4 에 적재되지 않도록 Playwright webServer 에 `NEXT_PUBLIC_GTM_ID=GTM-E2ETEST` + spec 에서 Google 도메인 route 차단.
- **Vercel env**: 3종 모두 Production 에만 등록. Preview 도 `NODE_ENV=production` 이라 키가 있으면 프리뷰의 테스트 결제가 실 GA4 에 MP 로 적재된다.
- **NO-REAL-MONEY**: 본 결정은 결제 경로를 변경하지 않는다. 운영 purchase 도 토스 샌드박스(`test_`) 결제다 — GA4 매출 수치는 데모 데이터임을 전제로 읽을 것.
- 모니터링: `AnalyticsJob` 의 `FAILED`·`SKIPPED` 비율. `SKIPPED` 가 생기면 cron 이 72h 이상 멈췄다는 신호.
- 6개월 뒤 의심받을 부분: "왜 purchase 가 dataLayer 에 없지?" → 옵션 B/C. "왜 GA 실시간에 매출이 하루 늦게 뜨지?" → Consequences 첫 항목(일 1회 cron).
