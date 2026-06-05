# ADR-0036: Ledger 다회 부분 환불 — Payment.refundedAmount 물질화 카운터 + 조건부 차감 동시성

- **상태**: Accepted
- **결정일**: 2026-06-04
- **영향 범위**: `src/entities/payment/api/refund.ts`, `src/entities/payment/api/ledger.ts`, `src/entities/payment/api/refundRetry.ts`, `prisma/schema.prisma` (Payment, RefundJob, Traveler)
- **관련 commit**: `3049722` `1911e8d` `4435988` `972b7a7` `d001b6c`

## Context (배경)

Phase 5-B(ADR-0031)까지는 예약 전체 취소만 지원됐다 — 한 Payment에 한 RefundJob. 신규 요구: 여행자별 부분 취소(`refundTraveler`)와 관리자 재량 금액 환불(`refundDiscretionary`)이 동일 Payment에 여러 번 누적 가능해야 한다.

기존 `refundBooking`은 단일 RefundJob 존재 여부(`findFirst WHERE status IN PENDING/IN_PROGRESS/SUCCEEDED`)로 이중환불을 막았으나, 다회 환불 시나리오에서는 "이미 한 번 했다 → 차단"이 아니라 "아직 남은 금액이 있다 → 허용"으로 판단 기준이 바뀌어야 한다.

동시에 두 요청이 들어올 때 "각자 잔여액을 읽고 판단"하면 TOCTOU(읽기-검사-쓰기) 경쟁이 생겨 합산이 원금을 초과하는 이중환불 가능성이 열린다.

## Decision (결정)

`Payment.refundedAmount` 물질화 카운터를 도입하고, 환불 요청마다 **`updateMany WHERE id=? AND refundedAmount <= amount - requested`** 단일 쿼리로 원자적 선점(reserve)한다. PostgreSQL row-level lock이 동시 요청을 직렬화하여 `count=0`(경합 패자·한도초과)이면 즉시 `REFUND_EXCEEDS_REFUNDABLE`을 throw해 PG 호출로 진입하지 않는다. PG 영구 실패(MAX_ATTEMPTS=8) 시 `releaseRefund`로 선점을 복원해 Ledger 불변식(`0 ≤ refundedAmount ≤ amount`)을 회복한다.

```ts
// reserveRefund — 원자적 CAS 핵심
await tx.payment.updateMany({
  where: {
    id: paymentId,
    status: { in: ["PAID", "PARTIAL_CANCELED"] },
    refundedAmount: { lte: amount - requestedRefund }, // 한도 초과 차단
  },
  data: { refundedAmount: { increment: requestedRefund } },
});
```

멱등성은 `RefundJob.idempotencyKey @unique` + Phase1 `findUnique` 사전 검사로 보장한다. 환불 종류는 `RefundKind`(FULL_CANCEL/TRAVELER_CANCEL/DISCRETIONARY)로 구분하며, TRAVELER_CANCEL은 취소 여행자의 `unitPrice` 스냅샷을 base로 위약금을 계산한다(전체액 기준 과징 방지).

## Consequences (결과)

**얻은 것:**
- 단일 쿼리로 TOCTOU 없이 다회 부분 환불 지원 (retry loop 불필요)
- `RefundJob.idempotencyKey` UNIQUE 제약으로 네트워크 재시도에도 effectively-once 보장
- `refundBooking` → `refundTraveler` 위임 5줄 래퍼로 코드 경로 단일화
- `skipSeatReturn` 옵션으로 사가 정밀 환원과 terminal 전이의 좌석 이중환원 구조적 차단

**포기한 것 / 미해결:**
- 부분환불 전용 메일(`PARTIAL_REFUND_COMPLETED`) — spec §2 비목표, 현재 기존 환불 완료 메일 경로 재사용
- DISCRETIONARY 환불은 좌석/booking 불변 — 순수 머니무브로 인원/좌석 수정은 별도 어드민 작업 필요
- `no_toss_key` Short-circuit에서 ledger 해제 누락 — 데이터 이상 상황이라 운영 알림 별도 처리 대상

## Alternatives Considered (대안 — 가장 중요한 섹션)

### 옵션 A: 순수 파생 SUM (물질화 카운터 없이 RefundJob 집계)
- 환불 가능액을 `SELECT SUM(amount) FROM RefundJob WHERE status=SUCCEEDED` 쿼리로 매번 계산
- 거부 이유: 동시 N 요청이 각자 SUM을 읽으면 모두 "아직 공간 있다"고 판단 → 합산 초과. row lock 직접 관리 추가 복잡도. 인덱스 없이 full-scan 비용.

### 옵션 B: explicit version lock (`Payment.version` increment + WHERE version=?)
- 낙관적 잠금으로 충돌 시 retry loop
- 거부 이유: `refundedAmount` 조건부 차감이 이미 원자적이라 version 카운터가 잉여. retry loop 추가로 코드 복잡도 증가. 빈번한 부분 환불 요청에서 starvation 가능.

### 옵션 C: Departure 현재가 복원 (환불 시점 Departure.priceAdult 재계산)
- 여행자별 환불 base를 booking 시점 단가가 아닌 현재 출발 단가로 계산
- 거부 이유: ADR-0027 D2 — `Booking.totalPrice`는 예약 시점 스냅샷 불변. 가격 변동 후 취소 시 불일치 발생.

### 옵션 D: 전체액(payment.amount) 기준 위약금
- 부분 취소 시에도 전체 결제액을 base로 위약금 비율 적용
- 거부 이유: 2인 중 1인 취소 시 취소하지 않은 여행자 분까지 위약금 산정 → 과징. 취소 여행자의 `unitPrice` 스냅샷을 base로 삼아야 공정.

### 옵션 E: 단일 DB Tx에 PG cancel 포함
- Phase1~3를 하나의 transaction에 묶어 원자성 강화
- 거부 이유: ADR-0003 절대 규칙 — 외부 PG 호출을 DB Tx 안에 두면 PG 지연이 lock 시간에 직결, 롤백 시 PG는 이미 처리된 상태로 불일치 발생.

## Notes

- 부분환불 메일 미지원은 명시적 비목표(spec §2 R2). `PARTIAL_REFUND_COMPLETED` EventType 추가 및 EmailJob 분기는 향후 별도 에픽.
- `refundedAmount`가 `amount`를 초과하는 경우는 `reserveRefund`의 `lte: amount - requested` 조건이 막으므로 정상 경로에서 발생 불가.
- 6개월 뒤 "왜 DISCRETIONARY는 booking을 안 바꾸지?" 의문이 예상됨 → 순수 머니무브 정책, 좌석 조정은 별도 admin 작업.
