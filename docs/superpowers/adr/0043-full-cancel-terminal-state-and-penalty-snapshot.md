# ADR-0043: FULL_CANCEL 결제 Terminal 마감 + 위약금 정책 reference-snapshot (Phase 14)

- **상태**: Accepted
- **결정일**: 2026-06-08
- **영향 범위**: `src/entities/payment/api/refund.ts`, `src/entities/payment/api/refundRetry.ts`, `src/entities/penalty-policy/**`(신규 슬라이스), `src/entities/booking/api/mutations.ts`, `prisma/schema.prisma`(`PenaltyPolicy`, `Booking.penaltyPolicyKey/Version`, `Product/Departure.penaltyPolicyKey`)
- **관련 commit**: `344d5b7`(server-only 가드+invalid tiers 폴백), `859bf4f`(computePenalty 소스 전환+스냅샷 해소), `f5b1c9c`(D-day 경계 복원), `5ce88c0`(예약 시점 스냅샷), `fc0cecf`(FULL_CANCEL CANCELED 마감)
- **관계**: [ADR-0031] 의 결정 #4(`penaltyAmount>0 → PARTIAL_CANCELED`)를 **부분 supersede**. 위약금 동결 원칙(ADR-0031 #1~#3)은 유효.

## Context (배경)

[ADR-0031]이 시간경과 위약금 + 부분취소 상태 모델(`PARTIAL_CANCELED`)을 도입했지만, 단일 하드코딩 `OVERSEAS_PENALTY_TIERS`(국외여행 표준약관, 최대 50%)에 묶여 있었다. Phase 14는 이를 상품/출발일별 커스텀 정책으로 끌어내리는데, 그 과정에서 두 개의 구조적 결함이 드러났다.

1. **100% 위약금이 코드를 깬다.** 커스텀 정책이 `rate=1`(전액 위약)을 허용하면 `refundAmount === 0`이 된다. 그러나 양 환불 사가(`runRefundSaga`/`retryRefundJob`)는 무조건 `tossClient.cancel({ cancelAmount })`을 호출했고, Toss는 `cancelAmount: 0`을 거부한다 → 사가가 영구 실패로 backoff 루프에 빠진다. 기존 max-50% tiers에선 0이 안 나와 잠복해 있던 버그.

2. **FULL_CANCEL이 잘못된 상태로 마감된다.** ADR-0031 #4의 `penaltyAmount > 0 ? PARTIAL_CANCELED : CANCELED` 분기는 *위약금 유무*만 봤다. 그러나 전체취소(`kind === "FULL_CANCEL"`)는 위약금이 붙어도 booking이 terminal(`CANCELED_BY_*`)로 가는 "끝난 거래"다. 위약금 30%를 떼고 70%만 환불한 전체취소가 `PARTIAL_CANCELED`(=아직 잔액취소 여지가 있는 부분환불)로 남으면, 상태가 거래 의미와 어긋나고 재시도/대시보드/메일 필터가 오판한다.

추가로, 정책이 시간에 따라 버전업되면 "예약 당시 약속된 위약 조건"과 "취소 집행 시점의 최신 조건"이 달라지는 소급(retroactive) 문제가 ADR-0031의 *금액* 동결을 넘어 *정책 자체*로 확장된다.

## Decision (결정)

### D1. FULL_CANCEL → Payment 무조건 `CANCELED` (terminal), 환불액 무관

양 사가 Phase 3(결제 상태 settle)에 `kind` 게이트를 추가한다. FULL_CANCEL은 100% 위약(0원 환불)이든 부분 위약(70% 환불)이든 무관하게 `CANCELED`로 마감. 진짜 부분환불(`DISCRETIONARY`/`TRAVELER_CANCEL`)만 `refundedAmount < amount`에서 `PARTIAL_CANCELED` 유지.

```ts
// refund.ts runRefundSaga Phase 3 — booking이 terminal로 가므로 결제도 terminal 마감
status: core.kind === "FULL_CANCEL" || newRefundedAmount >= core.amount
  ? "CANCELED"
  : "PARTIAL_CANCELED",
```

`refundRetry.ts`도 동형(`job.kind === "FULL_CANCEL" || refundedAmount >= amount`).

### D2. `refundAmount === 0` → Toss cancel skip, settle은 정상 수행

위약금이 전액이라 실환불액이 0이면 PG 머니무브 자체를 건너뛴다. settle(Phase 3)·booking 전이(onSettled)는 그대로 진행 — *돈이 0원 움직였을 뿐, 취소는 성립*한다.

```ts
if (core.refundAmount > 0) { await tossClient.cancel({ cancelAmount: core.refundAmount, ... }); }
else { metrics.incr("payment.refund.zero_amount_skip"); }
```

### D3. 위약금 정책 = append-only 불변 버전 + 예약 시점 reference-snapshot + 3단계 폴백

신규 `entities/penalty-policy` 베이스 슬라이스가 `computePenalty`/tiers/Zod/resolve의 SSOT(기존 `payment/model/penaltyPolicy.ts`에서 이전). 정책은 `PenaltyPolicy(key, version, tiers, isActive)` — 수정 = `version+1` 새 행 INSERT(기존 행 불변, `@@unique([key, version])`).

- **폴백 3단계**: `resolvePenaltyPolicyKey(productKey, departureKey)` = `departure ?? product ?? "standard_overseas"`(시스템 기본 상수).
- **reference-snapshot**: 예약 생성 시 `Booking.{penaltyPolicyKey, penaltyPolicyVersion}`에 해소된 `(key, version)`을 동결(값이 아닌 참조). 취소 시 `getTiersBySnapshot(key, version)`로 *그 버전*의 tiers를 정확히 복원 → 정책 버전업에 소급 면역. legacy(null) → 시스템 기본 상수.

## Consequences (결과)

**얻은 것:**
- 100% 위약금 정책이 사가를 깨지 않음 — `refundAmount===0` 가드가 양 경로(saga/retry)에 방어선.
- 결제 상태가 거래 의미와 정합 — FULL_CANCEL은 항상 terminal `CANCELED`, 재시도/메일/대시보드 필터 오판 제거. `getRefundCompletedEmailData`의 status `in` 필터 + 금액을 RefundJob에서 read하는 구조는 무영향(검증 완료).
- 정책 버전업이 기존 예약에 소급되지 않음 — `Booking.totalPrice` 스냅샷([ADR-0027] D2)·위약금 금액 동결([ADR-0031] #3)과 동형의 *정책 버전* 동결.
- `computePenalty` SSOT가 한 슬라이스(`penalty-policy`)로 수렴 — payment/booking/admin이 단방향 의존.
- 전체 회귀 1014 tests green, tsc clean.

**포기한 것 / 미해결:**
- FULL_CANCEL은 이제 잔액취소 여지가 없는 terminal — 전체취소 후 "위약금 일부 추가 환불" 같은 후속 조정은 별도 admin DISCRETIONARY 환불로만 가능(설계 의도).
- 부분환불 완료 메일(`PARTIAL_REFUND_COMPLETED`)은 [ADR-0042]에서 별도 처리 — 본 ADR은 상태 마감 정합성에 한정.
- admin CMS(정책 생성 UI + 상품/출발 매핑)는 Phase 14 Task 4에서 별도(본 ADR은 코어 상태/스냅샷 결정).

## Alternatives Considered (대안 — 가장 중요한 섹션)

### 옵션 A: 상태 분기를 위약금 유무로 유지 (ADR-0031 #4 그대로) + FULL_CANCEL 예외만 별도 컬럼
- `Payment`에 `isFullyCanceled` 같은 플래그를 추가해 status와 분리.
- 거부: `PaymentStatus`가 이미 표현해야 할 정보를 별도 불리언으로 이중화 → 두 진실의 정합성 부채. `kind`가 이미 사가에 흐르므로 Phase 3 게이트 한 줄이 최소 변경. 상태머신 단일 SSOT 유지.

### 옵션 B: 위약금 100%일 때 환불 자체를 enqueue하지 않음 (RefundJob 생략)
- 머니무브가 0이니 job을 안 만들면 Toss-skip 가드도 불필요.
- 거부: RefundJob이 *감사 원장*(penaltyAmount/actor/PaymentEvent) 역할도 한다. 0원 환불도 "100% 위약으로 취소됨"이 원장에 남아야 분쟁 대응 가능. job은 만들되 PG 호출만 skip이 옳다. booking 전이(onSettled)도 job settle에 묶여 있어 생략 시 좌석 환원/메일이 끊긴다.

### 옵션 C: 정책 value-snapshot (예약 시 tiers 배열 전체를 Booking에 복사)
- `(key, version)` 참조 대신 tiers JSON을 통째로 booking에 박제 → 조회 1회 절약.
- 거부: booking 행이 정책 데이터로 비대해지고, 정책 표시/감사 시 "어느 버전인지" 식별자가 사라진다. `PenaltyPolicy`가 이미 불변 버전 테이블이라 `(key, version)`이 영구 안정 참조 — value 복사는 중복 저장. ADR-0031 금액 동결이 value-snapshot인 것과 역할이 다름(금액=계산결과 동결, 정책=입력 버전 참조 동결).

### 옵션 D: 폴백을 product 단일 레벨로 (departure 오버라이드 없음)
- 상품에만 `penaltyPolicyKey`, 출발일은 항상 상속.
- 거부: 성수기 특정 출발편만 강한 위약 정책을 거는 실무 요구를 표현 불가. departure→product→system 3단계가 `??` 체인 한 줄로 표현되므로 비용 없이 유연성 확보.

## Notes

- 새 환불/취소 경로 추가 시: (a) `kind`를 정확히 지정(FULL_CANCEL vs TRAVELER_CANCEL/DISCRETIONARY) — Phase 3 status 분기가 여기 의존. (b) `refundAmount`/`job.amount`가 0일 수 있음을 가정(Toss skip 가드 통과).
- 위약 tiers 변경은 이제 `OVERSEAS_PENALTY_TIERS`(시스템 기본 폴백)와 DB `PenaltyPolicy` 두 출처. 커스텀 정책은 admin CMS(Task 4)에서 버전 생성, 시스템 기본은 코드 상수 한 곳.
- Mock(`mock-toss-server.ts`)은 항상 `CANCELED`를 반환하나 사가는 로컬 `kind`/`refundedAmount`로 분기하므로 무영향.
- 모니터링: `payment.refund.zero_amount_skip`/`payment.refund.retry.zero_amount_skip` 메트릭으로 100% 위약 경로 발생 빈도 관찰.
