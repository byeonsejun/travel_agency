# ADR-0016: Toss Webhook 진위 검증 — 결제 조회 API cross-check 채택 + HMAC 헬퍼 제거

- **상태**: Accepted
- **결정일**: 2026-05-26
- **영향 범위**:
  - `src/shared/lib/toss/client.ts` (getPayment 추가)
  - `src/shared/lib/toss/signature.ts` (삭제)
  - `src/shared/lib/toss/index.ts` (verifyTossSignature export 제거)
  - `src/shared/lib/env.ts` (TOSS_WEBHOOK_SECRET 제거)
  - `src/entities/payment/api/webhook.ts` (검증 로직 교체)
- **관련 ADR**: [ADR-0013](./0013-toss-webhook-v2-envelope-first.md) (이 결정이 0013 의 "verification 분리" 부채를 해소)
- **관련 plan**: `docs/superpowers/plans/2026-05-26-webhook-verification.md`

## Context (배경)

ADR-0013 에서 토스 v2024-06-01 마이그레이션을 완료할 때, signature 검증 메커니즘의 정식 형태를 모른 채 `development` 한정 signature skip 분기를 임시 우회로 두고 후속 plan(가칭 B3) 으로 미뤘다. 운영(production)·테스트 환경은 여전히 401 throw 였으나, dev e2e 가 ngrok 으로 webhook 을 받기 위해 `development` 만 통과시키는 코드 부채가 남아 있었다.

후속 작업(B3) 착수 시점에 토스 공식 문서(`docs.tosspayments.com/reference/using-api/webhook-events`) 를 직접 조회한 결과, 다음 사실이 확정되었다:

**(1) `tosspayments-webhook-signature` 헤더는 `payout.changed`·`seller.changed` 두 이벤트에만 발송된다.**

```
tosspayments-webhook-transmission-time    — 발송 시간
tosspayments-webhook-transmission-id      — 고유 식별자 (멱등 키)
tosspayments-webhook-transmission-retried-count
tosspayments-webhook-signature            — payout.changed, seller.changed 한정
```

**(2) HMAC 입력 형식은 `{WEBHOOK_PAYLOAD}:{transmission-time}` 콜론 결합, SHA-256/base64, 헤더값은 여러 값(공백 split) 중 하나와 일치하면 통과.**

**(3) `PAYMENT_STATUS_CHANGED`(우리가 처리하는 유일한 이벤트) 에는 signature 헤더가 없다.** body 의 `secret` 필드는 `DEPOSIT_CALLBACK`(가상계좌) 에만 존재 — "결제 승인 API 응답의 `secret` 과 비교" 패턴으로 명시.

**(4) `PAYMENT_STATUS_CHANGED` 의 위변조 검증 방식은 공식 가이드가 명시하지 않음.** 토스 표준 패턴은 결제 조회 API(`GET /v1/payments/{paymentKey}`) 로 out-of-band cross-check.

즉 ADR-0013 시점 가설("HMAC `toss-signature` 헤더가 v2 에서도 발송된다") 은 부분적으로 틀렸다 — 가이드에 정의된 HMAC 검증은 존재하지만 **지급대행 채널 한정**이고, 결제 상태 webhook 은 별도 검증 절차를 가입자가 선택해야 한다. 현 코드의 `verifyTossSignature` 헬퍼는 이 정의로는 어떤 경로에서도 호출되지 않는 죽은 코드.

## Decision (결정)

`PAYMENT_STATUS_CHANGED` 의 진위 검증을 **결제 조회 API cross-check 단일 방식**으로 정착하고, 미사용 HMAC 인프라는 YAGNI 원칙에 따라 완전히 제거한다.

### (1) `tossClient.getPayment(paymentKey)` 추가

```ts
// src/shared/lib/toss/client.ts
async getPayment(paymentKey: string): Promise<TossPaymentResponse> {
  // GET /v1/payments/{paymentKey} — Basic auth 만으로 호출 가능한 표준 v1 API.
  // 멱등 key 불필요(read-only). 토스가 알고 있는 결제 record 반환.
}
```

### (2) webhook handler 의 검증 절차

```ts
// transmissionId 헤더 부재 → InvalidSignatureError
// envelope/data parse 통과 후, $transaction 진입 전:
const fresh = await tossClient.getPayment(data.paymentKey);  // 외부 IO — tx 밖 (R3)
if (
  fresh.orderId !== data.orderId ||
  fresh.totalAmount !== data.totalAmount ||
  fresh.status !== data.status
) {
  metrics.incr("payment.webhook.toss.invalid_sig");
  throw new InvalidSignatureError("Webhook payload mismatched Toss record");
}
```

토스 결제 조회 API 가 404/네트워크 에러를 던지면 `InvalidSignatureError` 로 변환(401). 토스가 모르는 paymentKey 는 위조 webhook 으로 간주.

### (3) `verifyTossSignature` 헬퍼·관련 env·테스트 완전 제거

- `src/shared/lib/toss/signature.ts` — 삭제
- `src/shared/lib/toss/__tests__/signature.test.ts` — 삭제
- `src/shared/lib/toss/index.ts` — `verifyTossSignature` export 제거
- `src/shared/lib/env.ts` — `TOSS_WEBHOOK_SECRET` zod field·production required·NO-REAL-MONEY live\_ 차단 제거
- 관련 단위 테스트 mock·snapshot 모두 정리

### (4) `development` 한정 signature skip 분기 완전 제거

cross-check 가 환경 무관 작동(dev 도 샌드박스 토스 API 가 cross-check 대상) → development/test/production 모두 동일 검증 경로.

## Consequences (결과)

**얻은 것:**

- ADR-0013 의 verification 부채 청산 — `development` 한정 우회 분기 제거, dev/prod 동일 검증
- 위조 차단 강도 최고 — 위조자가 토스 server record 와 정확히 일치하는 paymentKey/amount/status 조합을 만들 수 없음
- 코드 면적 감소 — 미사용 HMAC 헬퍼·env 변수·관련 테스트 정리(YAGNI)
- 토스 표준 패턴 정합 — 가이드에 명시된 `secret` 비교 방식은 가상계좌(`DEPOSIT_CALLBACK`) 한정이고, 카드/계좌이체 webhook 은 결제 조회로 검증하는 게 사실상 표준

**포기한 것 / 미해결:**

- webhook 1건당 외부 API 호출 1회 추가 (~100–300ms) — 토스 SLA 10초 안에 처리 가능
- 토스 OUTAGE 시 합법 webhook 도 cross-check 실패 → 401 → 토스 재전송(7회) 으로 자동 복구. 메인 confirm-API 가 booking 전이를 이미 처리 중이라 backup 채널 단절은 허용 가능
- payout/seller webhook 도입 시 HMAC 헬퍼를 다시 작성해야 함 — git history 에서 복구 가능. YAGNI 가치가 더 크다고 판단

## Alternatives Considered (대안 — 가장 중요한 섹션)

### 옵션 B: IP allow-list (네트워크 layer)

토스 webhook 발사 IP 만 화이트리스트. 코드 변경 0, 외부 IO 오버헤드 0.

- 거부 이유:
  - dev ngrok 환경에서 webhook 이 사용자 단말 IP 로 들어와 IP 검증 불가 → dev 우회 분기가 다시 필요. ADR-0013 의 부채를 그대로 재생산
  - NO-REAL-MONEY 상 production 실거래가 없으므로 prod 단독 IP 검증의 효과 자체가 제한적
  - 위조 차단 강도가 cross-check 보다 약함 — 토스 IP 자체가 유출/스푸핑되면 무력. cross-check 는 paymentKey 까지 일치해야 통과

### 옵션 C: cross-check + IP allow-list (defense in depth)

둘 다 적용해 다층 방어. cross-check 가 단독으로 충분히 강하므로 IP 검증은 보완.

- 거부 이유:
  - 위 옵션 B 의 dev 환경 우회 분기 문제가 동일하게 부활 → "B3 의 핵심 목표(dev skip 제거)" 가 무너짐
  - cross-check 단독으로 위조 차단 강도가 이미 충분 (paymentKey + amount + status 일치를 위조자가 만들기 어려움)
  - 운영 layer 의 IP allow-list 는 향후 토스 콘솔/CDN 정책으로 별도 추가 가능 — 코드 invariant 와 분리하는 게 옳다

### 옵션 X1: HMAC 헬퍼 보존 + 가이드 형식으로 수정 (`{rawBody}:{transmissionTime}`)

`verifyTossSignature` 를 토스 가이드의 정확한 입력 형식으로 고치고, payout/seller webhook 도입 시점에 즉시 활성화 가능하도록 보존.

- 거부 이유:
  - 현재 payout/seller webhook 을 받는 라우트·핸들러·DB 모델·도메인 로직이 **하나도 없다** — 헬퍼 단독으로는 의미가 없고, 호출되지 않는 코드 + production required env 가 유지보수 부채로만 남는다
  - 미래 도입 시점에 토스 가이드가 또 바뀔 가능성 (v2024-06-01 가 v1 가설을 뒤집은 전례) — 그때 다시 가이드를 보고 작성하는 게 안전
  - git history 에 보존되어 있으므로 복구 비용은 충분히 낮다. YAGNI 적용 적격

### 옵션 V (재검토): body 의 `data.secret` 비교

가이드 §DEPOSIT_CALLBACK 의 "결제 승인 API 응답의 `secret` 과 비교" 패턴을 `PAYMENT_STATUS_CHANGED` 에도 적용 시도.

- 거부 이유:
  - `PAYMENT_STATUS_CHANGED` payload 에 `secret` 필드가 정의되어 있지 않음 (가이드 명시 표 §1) — 그 필드를 가정하는 것은 추측 구현 (ADR-0013 옵션 V 와 동일한 사유)
  - 결제 승인 API 응답을 우리 쪽에 보관해야 하는데, 우리는 webhook 시점에 `secret` 을 저장하지 않음 (현 모델에 컬럼 없음) — 추가 마이그레이션 필요 → cross-check 옵션이 변경 면적 더 작음

## Notes

- **후속 plan**: 가상계좌(`DEPOSIT_CALLBACK`) 도입 시점에 body `secret` 비교 + 결제 승인 API 응답 저장 컬럼 추가. 별도 plan.
- **후속 plan**: payout/seller webhook 도입 시 HMAC 검증 헬퍼 재작성 (git history `signature.ts` 참고).
- **모니터링 지표**:
  - `payment.webhook.toss.invalid_sig` — cross-check 실패 카운터 (위조 시도 + 토스 OUTAGE 혼재 — 알람 임계 보수적으로)
  - `payment.webhook.toss.crosscheck_pg_error` — 토스 API 자체 에러 (네트워크/5xx) — 토스 OUTAGE 추적용
  - `payment.webhook.toss.dev_signature_skipped` — 본 ADR 로 제거. 메트릭 키도 함께 정리
- **6개월 뒤 의심받을 가능성**: "왜 결제 조회 API cross-check 였지? signature 헤더 검증이 더 우아하지 않나?" — 답: 본 결정일(2026-05-26) 토스 공식 가이드(`webhook-events`) 의 헤더 목록에 `PAYMENT_STATUS_CHANGED` 용 signature 헤더가 존재하지 않음을 직접 확인. 가이드의 HMAC 검증 정의는 payout/seller 한정. cross-check 가 카드/계좌이체 결제 webhook 에 적용 가능한 유일한 표준 검증 경로.
- **부수 영향**: `TOSS_WEBHOOK_SECRET` env 변수가 사라지면서 `.env`/배포 시크릿에서 정리 필요. PENDING_OPS.md 의 "토스 샌드박스 웹훅 등록" 항목에서 해당 env 라인 제거.
