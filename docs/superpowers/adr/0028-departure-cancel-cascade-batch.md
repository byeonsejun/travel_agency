# ADR-0028: 출발 취소 Cascade — 부모 배치 오케스트레이션 + 부분 실패 복구

- **상태**: Accepted
- **결정일**: 2026-06-02
- **영향 범위**: `src/features/admin-departure-cancel/`, `src/entities/departure-cancellation/`, `src/entities/payment/api/enqueueRefundJob.ts`, `src/entities/booking/api/mutations.ts`(transitionStatusTx), `src/app/api/cron/process-refunds/route.ts`
- **관련 commit**: `fb520bd`(스키마), `10a6554`(enqueue+tx코어), T3~T7

## Context (배경)

Phase 4-A는 예약이 있는 출발일(`bookedSeats > 0`) 취소를 **차단**했다([ADR-0027] D1) — 단건 환불 Saga([ADR-0003])를 N건에 fan-out하면 **부분 실패(partial failure)** 복구가 별도 에픽이기 때문. Phase 4-B가 그 에픽이다: 관리자가 출발일을 강제 취소하면 묶인 N건(PAID는 환불, 미결제는 단순 취소)을 처리하고, 일부 환불 실패를 추적·가시화·재시도해야 한다.

단건 부분 실패 복구(CAS claim·backoff·job 격리·`attempts≥max → FAILED`)는 `process-refunds` cron + `RefundJob`으로 이미 완성돼 있었다. 비어 있던 것은 그 위의 **fan-out 오케스트레이션 + 배치 관찰성**.

## Decision (결정)

**부모 배치 `DepartureCancellation` + `RefundJob.cancellationBatchId`로 오케스트레이션. 실제 환불은 ADR-0003 Saga를 그대로 재사용.**

1. **단일 트랜잭션 오케스트레이션** (`startDepartureCancellation`, 외부 IO 0):
   force-CAS(departure `SCHEDULED|CONFIRMED|CLOSED → CANCELED`, `count===0`이면 멱등 거부) → 배치(PROCESSING) 생성 → PAID/READY는 `enqueueRefundJob`(Phase 1 enqueue, PG는 cron) / 미결제는 `cancelBookingByAgencyTx`(즉시). 전부 한 tx → all-or-nothing.

2. **상태/프로세스 분리**: departure는 취소 결심 즉시 `CANCELED`(신규 판매 차단), 환불 drain "진행 중"은 배치(`PROCESSING`)가 소유.

3. **배치 status = 자식 RefundJob의 투영(fold)**: `recomputeBatchStatus`가 FAILED 우선 규칙으로 파생 — 하나라도 FAILED→`PARTIALLY_FAILED`, 모두 SUCCEEDED→`COMPLETED`, 그 외 `PROCESSING`. cron이 drain 후 영향 배치를 재계산 → 자동 수렴.

4. **중첩 트랜잭션 회피**: `transitionStatus`의 tx 본문을 `transitionStatusTx(tx, …)` 코어로 추출(기존은 얇은 래퍼). 배치 단일 tx에 booking 전이가 합류 가능.

## Consequences (결과)

**얻은 것:**
- 결제 여부 무관 N건을 1 배치 정체성으로 통합 추적 — 부분 실패 가시성 + 재시도(`retryBatchRefundAction`).
- ADR-0003 Saga·멱등성 무손상(enqueue-only로 PG를 cron에 위임). 이중 환불 수학적 불가(enqueue 중복 게이트 + 3중 멱등성).
- all-or-nothing 적재(외부 IO 0) — "중간만 처리된" 어정쩡한 상태 불가.
- 배치 status가 파생이라 자식과 어긋날 수 없음.

**포기한 것 / 미해결:**
- 부분 환불(금액 일부)·위약금 차등 — 전액 환불만(별도 정책 마일스톤).
- 배치 진행 실시간 푸시 — admin RSC 새로고침.
- `bookedSeats >= minPax` 자동 CONFIRMED([ADR-0027] D4 유지).

## Alternatives Considered

### 옵션 A: 동기 루프 (admin 액션에서 N건 PG 순차 호출)
- **거부**: 30건 PG 동기 = 60s+ → Server Action 타임아웃. partial failure 복구 부재. ADR-0003 "외부 IO Tx 밖" 위반.

### 옵션 B: 파생 집계 (부모 테이블 없이 RefundJob join)
- **거부**: 미결제 즉시취소는 RefundJob이 없어 누락 → 배치 전체를 커버 못 함. "묶음" 정체성·재시도-전체 버튼 구현 곤란.

### 옵션 C: RefundJob에 batch 태그만 (부모 테이블 없음)
- **거부**: 옵션 B와 동일하게 미결제 예약 누락.

### 옵션 D: 새 `CANCELING` departure 중간 상태
- **거부**: enum 마이그레이션 + 상태머신 확장 비용. `reserveSeats`가 이미 CANCELED를 차단하므로 불필요. "진행 중"은 배치가 표현(상태/프로세스 분리).

## Notes

- QA(`scripts/qa/4b-cascade-qa.ts`)는 결함 주입(tossPaymentKey 훼손→FAILED) → PARTIALLY_FAILED → 재시도 → COMPLETED 수렴을 실제 워커 short-circuit으로 결정적 재현(16/16 PASS). PG mock 미가동 환경에서도 SC1/SC2로 양 경로 검증.
- 6개월 뒤 의심 지점: "왜 departure가 환불 전에 CANCELED?"(상태/프로세스 분리) · "배치 status는 누가 갱신?"(파생, cron+재시도 후 recompute) · "PG는 어디서?"(admin 0, cron이 ADR-0003 Saga).
