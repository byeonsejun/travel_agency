# ADR-0013: Toss Webhook v2024-06-01 마이그레이션 — envelope-first + transmission-id 멱등 + verification 분리

- **상태**: Accepted
- **결정일**: 2026-05-26
- **영향 범위**:
  - `src/entities/payment/model/schemas.ts`
  - `src/entities/payment/api/webhook.ts`
  - `src/app/api/payments/webhook/toss/route.ts`
- **관련 commit**:
  - `a1b425d` (진단 가시화 + dev signature skip 임시 우회)
  - `3551a88` (마이그레이션 plan)
  - `ac4f41d` (본 ADR 의 실 변경 — v2 envelope/dispatch/idemKey 전환)
- **관련 plan**: `docs/superpowers/plans/done/2026-05-24-toss-webhook-v2.md`

## Context (배경)

토스페이먼츠가 결제 API v2024-06-01 + 신버전 webhook 을 default 로 배포.
콘솔에서 신규 등록한 webhook 은 자동으로 v2 페이로드로 발사:

```
v1 (코드 기존)          v2 (실 발송 — 2026-05-24 ngrok 캡처)
─────────────────       ─────────────────────────────────
top.eventId             (없음 — 헤더 transmission-id 가 대체)
top.orderId             data.orderId
top.type=PAYMENT_DONE   eventType=PAYMENT_STATUS_CHANGED + data.status=DONE
top.totalAmount         data.totalAmount
top.paymentKey          data.paymentKey
top.approvedAt          data.approvedAt
top.receipt.url         data.receipt.url
top.canceledAt          data.cancels[*].canceledAt (취소 목록)
```

dev e2e 에서 받자 `TossWebhookEventSchema.parse(json)` 가 ZodError 로 500.
4 단 게이트 디버깅으로 좁힘 — 404 (라우팅 단수형) → 401 (signature 부재) →
500 silent swallow → 500 ZodError → root cause 확정.

추가 제약:
- 토스 가이드의 webhook 페이지에 **verification(서명) 절차 미명시**.
  body 의 `data.secret` 기반 또는 결제 조회 API 검증으로 추정되나 확신 못함.
- 결제 메인 흐름(`/api/payments/confirm`)이 booking → PAID 를 이미 처리 중.
  webhook 은 backup 멱등 채널 — **블로커 아닌 안정성 강화** 작업.
- 가이드 §4: webhook 응답 SLA 10초, 재전송 7회(1·4·16·64·256·1024·4096분).

## Decision (결정)

4 개 핵심 결정으로 마이그레이션:

### 1. Schema: envelope-first + 내부 정밀 검증 분리

```ts
// envelope — 모든 eventType 공통, passthrough 로 미지원 type 도 통과
export const TossWebhookV2EventSchema = z.object({
  eventType: z.string().min(1),
  createdAt: z.string().optional(),
  data: z.record(z.unknown()),
}).passthrough();

// PAYMENT_STATUS_CHANGED 의 data 정밀 검증 (status 8종 enum)
export const PaymentStatusChangedDataSchema = z.object({
  paymentKey: z.string().min(1),
  orderId: z.string().min(1),
  status: z.enum(["READY","IN_PROGRESS","WAITING_FOR_DEPOSIT",
                  "DONE","CANCELED","PARTIAL_CANCELED","ABORTED","EXPIRED"]),
  totalAmount: z.number().int().nonnegative(),
  // approvedAt/receipt/failure 는 .nullable().optional()
}).passthrough();
```

미지원 eventType 도 envelope parse 통과 → dispatch 에서 `IGNORED` no-op.

### 2. Dispatch 1차 범위 최소화 — `PAYMENT_STATUS_CHANGED` + `DONE` 만 처리

| eventType | data.status | 동작 |
|---|---|---|
| `PAYMENT_STATUS_CHANGED` | `DONE` | Payment PAID + booking 전이 |
| `PAYMENT_STATUS_CHANGED` | 그 외 7종 | IGNORED no-op + PaymentEvent 기록 |
| 그 외 eventType | * | IGNORED no-op + PaymentEvent 기록 |

### 3. 멱등 키 — transmission-id 헤더로 전환

```ts
const idemKey = `webhook:${transmissionId}`;  // 기존 형식 호환
```

`event.eventId` (v1, v2 부재) → 헤더 `Tosspayments-Webhook-Transmission-Id`.
토스가 같은 transmission 재시도 시 동일 id (사용자 확인: retry 1·6 동일 id).

### 4. Verification(서명) 분리 + `development` 한정 signature skip

dev/test/prod 동작:

```ts
if (!signature) {
  if (env.NODE_ENV !== "development") {
    throw new InvalidSignatureError();  // production·test 는 401
  }
  metrics.incr("payment.webhook.toss.dev_signature_skipped");
  // development 만 통과 — verification plan 까지의 임시 우회
}
```

production 은 여전히 throw → 실거래 안전성 보존 (NO-REAL-MONEY ADR-0009).

## Consequences (결과)

**얻은 것:**

- webhook backup 채널 운영 회복 — dev e2e 에서 `{"ok":true}` 200 OK 확인
- 토스가 미래 신규 eventType 추가해도 envelope schema 가 흡수 → 500 폭주 0
- 결제 confirm-API 와 webhook 의 멱등 backup 이 다시 정렬 — race 시 SKIPPED 안전
- 멱등 키가 토스 표준(transmission-id) 과 의미적으로 일치 — 재전송 정책과 자연스럽게 호환
- 481 테스트 그린(payment 142/142), pre-existing 경고 외 lint 0

**포기한 것 / 미해결:**

- **Production 환경 webhook 은 verification plan 완료까지 401** — dev 만 200,
  prod 는 throw. 단 실거래 자체가 없으므로(NO-REAL-MONEY) 영향 0
- dev signature skip 분기 = 코드 부채 — 별도 plan 에서 청산 예정
- `PAYMENT_STATUS_CHANGED` 의 `DONE` 외 status (`CANCELED`/`ABORTED` 등) 와
  `DEPOSIT_CALLBACK`/`CANCEL_STATUS_CHANGED` 같은 다른 eventType 은 IGNORED 로
  no-op — 실패/취소 분기 backup 은 메인 흐름(`cancelBookingAction`, refund saga)
  이 처리 중이라 우선순위 낮음, 별도 plan
- 외부 캡처 페이로드의 `data.secret` 같은 verification 메커니즘 단서를 추측
  구현 안 함 — 토스 공식 가이드 추가 페이지 확인 후 정착

## Alternatives Considered (대안 — 가장 중요한 섹션)

### 옵션 A (Schema): `z.discriminatedUnion("eventType", ...)` 엄격 검증

`PAYMENT_STATUS_CHANGED` literal 만 union 에 포함, 그 외 eventType 은 schema
parse 단계에서 ZodError throw → handler 가 catch 해서 IGNORED 처리.

- 거부 이유:
  - 우아하지만 **외부 발신자에 대해선 schema 가 엄격하면 안 된다.** 토스가
    deprecation 안내 없이 새 type 을 추가하면 그날 webhook 들이 일제히 500
    으로 떨어진다 (가이드 §4 의 7회 재전송 폭주 트리거).
  - 채택안 (B, envelope-first) 도 미지원 type 을 IGNORED 로 처리하는 점은
    동등하나, *parse 단계에서 통과* 시켜 500 / 200 분기를 ZodError 가 결정하지
    않게 함. 안정성 우위.

### 옵션 D (Direction): 토스 콘솔에서 webhook 을 v1 으로 revert

콘솔이 v1/v2 선택을 노출하는 경우, v1 으로 되돌려 코드 변경 회피.

- 거부 이유:
  - 결제 위젯이 이미 v2024-06-01 — webhook 만 구버전 받으면 *호환성 위험*
    (cancels 필드 구조 등 신버전 종속 데이터가 v1 webhook 에서 표현 안 됨)
  - 토스가 v2 를 "새로 나온" 으로 강조 → 곧 v1 deprecation 수순 추정.
    역방향 작업은 미래 부채

### 옵션 V (Verification): body `data.secret` 기반 verification 즉시 구현

webhook body 의 `data.secret` 을 토스 결제 조회 API 로 비교해 verification.

- 거부 이유:
  - 가이드 webhook 페이지에 명시 안 됨 — *추측 구현은 위험* (서명 검증 실수는
    위조 webhook 수용으로 직결, 보안 사고 가능성)
  - dev signature skip 의 한시적 부채를 받아들이고, 가이드 추가 페이지(개발자
    센터 > 결제 검증/보안) 확인 후 정확히 정착하는 게 안전
  - production 은 여전히 throw 라 보안 invariant 손상 0

### 옵션 멱등 키 — `data.paymentKey` 또는 `data.orderId` 사용

`payment.tossPaymentKey` 가 이미 UNIQUE 인 점을 이용해 `webhook:${paymentKey}`
로 멱등 키 구성 가능.

- 거부 이유:
  - paymentKey 는 *결제 1건 단위*, 같은 결제에 대해 토스가 여러 webhook
    (예: `PAYMENT_STATUS_CHANGED` 다음 `CANCEL_STATUS_CHANGED`) 보낼 때
    *모두 같은 paymentKey* — 멱등 키로 사용하면 두 번째 event 가 SKIPPED 됨
  - transmission-id 가 **webhook 발사 1회 단위** 의 유니크 식별자라 토스
    문서 의도와 정합

### 옵션 IGNORED 외 → 500 throw 로 가시화

미지원 eventType / status 를 500 으로 떨어뜨려 "확인 안 한 케이스" 를 가시화.

- 거부 이유:
  - 토스의 재전송 정책(7회) 이 500 응답 시 자동 발사 — 운영 시점에 webhook
    재전송 폭주 + 토스 콘솔에 "실패" 상태 누적
  - IGNORED + PaymentEvent 기록 + metrics counter 만으로도 모니터링 충분.
    필요 시 `payment.webhook.toss.ignored` 카운터 알람 설정

## Notes

- **후속 plan (가칭 B3)**: webhook verification 정착 — 가이드 추가 페이지
  확인 후 body `data.secret` 기반 또는 결제 조회 API 비교. dev signature
  skip 분기를 제거할 수 있는 시점.
- **후속 plan (가칭 B4)**: DONE 외 status + 다른 eventType
  (`DEPOSIT_CALLBACK`, `CANCEL_STATUS_CHANGED`) dispatch 확장. 가상계좌
  결제 도입 시점에 의미가 커짐.
- **모니터링 지표**:
  - `payment.webhook.toss.processed` — eventType/status tag 별 카운터
  - `payment.webhook.toss.ignored` — 알 수 없는 eventType/status 추적
  - `payment.webhook.toss.dev_signature_skipped` — verification 부재 추적
- **6개월 뒤 의심받을 가능성**: "왜 envelope-first 였지?" — 답: 본 결정일
  (2026-05-26) 에 토스가 v2 default 로 전환 중이었고 가이드의 eventType
  목록이 8종에서 확장될 가능성이 명시되어 있어, 외부 발신자에 대한 schema
  가 too-strict 하면 운영 안정성을 잃을 위험을 회피
- **부수 발견**: PENDING_OPS.md 의 webhook URL 가이드가 단수형(`/api/payment/`)
  으로 잘못 적혀 있었던 점 → 404 디버깅 1차 root cause. URL 정정 + 함정 경고
  를 PENDING_OPS 에 추가. 비슷한 운영 가이드 작성 시 *코드 컨벤션과 URL
  하드코딩 동기화* 점검 필요.
