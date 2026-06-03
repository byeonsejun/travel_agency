# ADR-0031: 위약금 동결 스냅샷 + 부분취소 상태 모델 (Phase 5-B)

- **상태**: Accepted
- **결정일**: 2026-06-04
- **영향 범위**: `src/entities/payment/model/penaltyPolicy.ts`, `src/entities/payment/api/refund.ts`, `src/entities/payment/api/refundRetry.ts`, `src/entities/payment/api/getRefundCompletedEmailData.ts`, `prisma/schema.prisma` (`PaymentStatus`, `RefundJob`)
- **관련 commit**: `f06443a` (정책 엔진), `404c368` (스키마), `d17e21e` (refund), `3ef4217` (retry), `90fc93a` (action 배선), `d18d4a1` (메일), `baec82e` (런타임 증거)

## Context (배경)

기존 환불은 **전액 환불만** 지원했다 — `refundBooking`/`retryRefundJob`이 `cancelAmount = paidPayment.amount`(전액) 고정, 결과는 `Payment.status = CANCELED`(이진). 시간경과 위약금(국외여행 표준약관: 출발 임박일수록 공제율↑) 개념이 코드에 없어 여행사가 출발 임박 취소 손실(항공·호텔 선결제분)을 회수할 수 없었다.

PG 레이어는 이미 부분취소 준비가 끝나 있었다(`tossClient.cancel`의 `cancelAmount` 파라미터, `TossCancelStatus.PARTIAL_CANCELED` 타입). 빠진 것은 (a) 얼마를 환불할지 정하는 **도메인 정책** (b) 부분취소를 표현할 **상태 모델** (c) 시간에 민감한 위약금의 **동결 전략**이었다.

핵심 난점: 위약금은 D-day 함수다. PG 호출이 장애로 며칠 지연됐다가 cron이 재시도하는 순간 위약금을 *재계산*하면, 사용자가 "취소 버튼을 누른 시점"과 "실제 환불 집행 시점"의 금액이 달라져 분쟁이 된다.

## Decision (결정)

1. **순수 정책 엔진** `computePenalty({ baseAmount, departureDate, now }) → { daysBefore, rate, penaltyAmount, refundAmount }`. 표준약관 구간을 `OVERSEAS_PENALTY_TIERS` 상수 SSOT로. D-day는 `ceil` — 약관의 "출발 N일 전"은 *달력일* 기준이라 KST 한 달력일 전체가 동일 D에 매핑돼야 한다(`floor`는 정오 이후 within-day drift 발생).

2. **명시적 `applyPenalty` 플래그**로 호출자가 의도를 전달(actor 문자열 추론 대신).
   - 자가취소 → `true`, admin 단건 → `!waivePenalty`(면제 토글), 출발취소 cascade → 해당 없음(전액).

3. **취소 요청 시점 1회 계산 후 동결**. `RefundJob.amount`를 "결제 전액"에서 **"실제 환불액(=base−penalty)"** 으로 의미 재정의 + `penaltyAmount Int @default(0)` 컬럼 추가. cron 재시도는 이 스냅샷만 읽고 **절대 재계산하지 않는다**.

4. **`PaymentStatus.PARTIAL_CANCELED`** 추가. Phase 3에서 `penaltyAmount > 0 ? "PARTIAL_CANCELED" : "CANCELED"` 분기.

```ts
// refund.ts — enqueue 직전 동결
const { penaltyAmount, refundAmount } = applyPenalty
  ? computePenalty({ baseAmount: paidPayment.amount, departureDate, now: new Date() })
  : { penaltyAmount: 0, refundAmount: paidPayment.amount };
// → RefundJob.amount = refundAmount, RefundJob.penaltyAmount = penaltyAmount (불변 스냅샷)
// → tossClient.cancel({ cancelAmount: refundAmount })  (Tx 밖, ADR-0003)
```

## Consequences (결과)

**얻은 것:**
- 위약금이 D-day 변동에 면역(`Booking.totalPrice` 스냅샷 [ADR-0027] D2와 동형 패턴).
- 기존 전액 환불 경로 100% 호환 — 위약금 0이면 `amount`=전액, status=`CANCELED`로 기존과 동일. cascade(`enqueueRefundJob`)는 `penaltyAmount` default 0이라 **호출자 무변경**.
- `PaymentEvent.payload`에 `{ baseAmount, penaltyAmount, refundAmount }` 3-tuple 박제 → 감사·분쟁 대응.
- 런타임 증거(`payment-evidence.ts refund-partial`): 1,290,000원 D-2 취소 → 위약금 387,000 / 환불 903,000 / `PARTIAL_CANCELED` 영속 확인.

**포기한 것 / 미해결:**
- 금액분할(한 결제를 여러 번 나눠 부분취소)·부분취소 후 잔액취소 미지원(terminal). 향후 에픽.
- 상품/출발일별 커스텀 위약금 정책 CMS 미도입 — 표준약관 단일 테이블.
- `getRefundCompletedEmailData`는 이제 금액 출처를 SUCCEEDED `RefundJob`으로 둔다(Payment.amount는 원결제액이라 부분환불에서 오보고됨) — 선행 버그 동시 수정.

## Alternatives Considered (대안)

### 옵션 A: 별도 `Refund` 원장 테이블
- `Refund(amount, penaltyAmount, policySnapshot, status)` 신규 모델로 환불 1건=1행 관리.
- 거부: 다회·금액분할 환불이 비목표인 현 시점에 신규 모델 + 쿼리 경로 + 배치(`DepartureCancellation`) 연동 재설계가 과投資. `RefundJob`이 이미 1건=1행 + status/backoff/배치연결을 보유 → 컬럼 1개 추가가 최소 변경. 원장 분리는 다회 환불 에픽에서 재논의.

### 옵션 B: 위약금을 `Booking`에 저장 (`penaltyAmount`/`refundedAmount`)
- UI 읽기는 가장 단순.
- 거부: 결제 관심사를 booking에 결합 → 레이어 책임 분리 위반(Architect). 멱등·재시도 추적이 `RefundJob`과 분리돼 정합성 이중화.

### 옵션 C: cron 재시도 시 위약금 재계산 (동결 안 함)
- 스냅샷 컬럼 불필요.
- 거부: D-day가 재시도 시점 기준으로 바뀌어 "취소 접수 시점 금액"과 불일치 → 사용자 분쟁·환불액 비결정성. 동결이 협상 불가.

### 옵션 D: actor 문자열로 위약금 적용 추론 (`user:`→적용, `admin:`/`system:`→면제)
- 플래그 없이 기존 시그니처 유지.
- 거부: admin이 *사용자 귀책* 취소를 대행할 때 위약금을 부과해야 하는 케이스를 표현 불가. 의도를 호출자가 명시(`applyPenalty`)하는 편이 안전하고 테스트 가능.

## Notes

- 새 취소 경로 추가 시 `applyPenalty`를 의식적으로 지정할 것(전액=false, 위약금=true).
- `DepartureStatus`/`BookingStatus`처럼 위약금 구간 변경은 `OVERSEAS_PENALTY_TIERS` 한 곳만 수정 — RSC 미리보기·사가·메일이 동일 `computePenalty`를 공유.
- Mock(`mock-toss-server.ts`)은 항상 `CANCELED` status를 반환하지만 사가는 응답 status가 아닌 로컬 `penaltyAmount`로 분기하므로 무영향(충실도용 mock 분기는 YAGNI로 미도입).
