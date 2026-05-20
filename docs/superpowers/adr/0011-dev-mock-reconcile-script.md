# ADR-0011: dev_mock 키 reconcile 스크립트 — backoff 무한 실패 잔재 처리

- **상태**: Accepted
- **결정일**: 2026-05-20
- **영향 범위**: `scripts/qa/refund_reconcile.ts`, `src/entities/payment/api/refundRetry.ts`
- **관련 commit**: `feat(scripts): dev_mock refund reconcile script`

## Context (배경)

환경변수 `TOSS_SECRET_KEY`가 없거나 유효하지 않을 때, 결제 확인 서버 액션은 `dev_mock_` 접두어를 가진 합성 `tossPaymentKey`를 생성해 결제를 기록한다(NODE_ENV=development 폴백). 이 키는 실제 Toss Sandbox 서버가 인식하지 못한다.

결과: 해당 booking에 취소(환불)를 요청하면 RefundJob이 enqueue되지만, PG cancel 호출(`tossClient.cancel`)이 항상 404/400으로 실패한다. Cron worker의 exponential backoff가 재시도를 계속 늘려가며 **영구적으로 PENDING 상태**에 갇힌다. DB에 stale RefundJob이 쌓이고, 개발 환경에서 기능 검증 시 노이즈가 된다.

## Decision (결정)

`scripts/qa/refund_reconcile.ts` 수동 스크립트를 도입한다. 다음 단계를 단일 트랜잭션+전이로 처리한다:

1. `Payment.status → CANCELED, canceledAt = now` (Tx 내)
2. `RefundJob.status → SUCCEEDED, lastError = 'manual reconciliation'` (Tx 내)
3. `PaymentEvent(RECONCILED)` append — `providerEventId = reconcile:{paymentId}:{timestamp}` 멱등성 키 (Tx 내)
4. `booking.transitionStatus(CANCELED_BY_USER, actor=admin:dev-reconcile)` — 좌석 환원 + BookingEvent 자동 처리 (Tx 외, ADR-0003 원칙)

3중 안전장치:
- `NODE_ENV === 'production'` 이면 즉시 `process.exit(2)`.
- `tossPaymentKey`가 `dev_mock_*`가 아니면 `--force` 플래그 없이 진행 거부.
- `booking.status`가 `PAID/READY`가 아니면 reconcile 거부.

```bash
npx tsx scripts/qa/refund_reconcile.ts <bookingId> [--force]
```

## Consequences (결과)

**얻은 것:**
- stale dev RefundJob을 명시적으로 제거해 개발 환경 DB를 clean 상태로 복원 가능.
- reconcile 절차 표준화 — 어떤 팀원도 동일 명령으로 재현 가능.
- providerEventId 멱등성 키로 이중 실행 방어.

**포기한 것 / 미해결:**
- 완전 자동화가 아닌 수동 실행 — 의도적 선택 (운영 영향력 있는 작업을 자동화할 이유 없음).
- `--force`가 있으면 실 Toss 키에도 적용 가능 → 팀원 교육 필요.

## Alternatives Considered (대안)

### 옵션 A: dev 환경에서 PG cancel 항상 성공하는 mock tossClient
- dev에서 PG 에러 경로(backoff, retry, stuck job 회복) 검증 불가.
- RetryWorker 로직의 실질적 테스트 불가 → 거부.

### 옵션 B: RefundJob에 `is_dev_synthetic` 플래그 추가, Cron Worker가 자동 스킵
- 스키마 복잡도 증가. backoff 재시도 수를 유한으로 cap하는 별도 로직도 필요.
- 수동 reconcile보다 구현 비용이 더 크고, 자동 스킵이 오히려 실패 케이스를 숨길 수 있음 → 거부.

### 옵션 C: 자동 reconcile Cron Job (dev 환경 한정)
- dev 환경에서만 자동 실행되는 Cron은 환경 분기 로직이 섞여 코드를 오염시킴.
- 의도하지 않은 production 적용 위험 → 거부.

## Notes

- 이 스크립트는 `scripts/qa/` 하위에 위치 — CI에서 실행되지 않으며, 팀 내부 운영 도구로만 사용.
- 향후 admin UI에서 "dev reconcile" 버튼으로 대체될 수 있으나, 현재 단계에서 UI 비용은 불필요.
