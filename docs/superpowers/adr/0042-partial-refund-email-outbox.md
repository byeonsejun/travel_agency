# ADR-0042: 부분 환불 완료 메일 — settle Tx 아웃박스 + refundJobId 멱등 식별 + FULL_CANCEL 중복 차단

- **상태**: Accepted
- **결정일**: 2026-06-07
- **영향 범위**: `src/entities/payment/api/refund.ts`, `src/entities/payment/api/refundRetry.ts`, `src/entities/payment/api/getPartialRefundCompletedEmailData.ts`, `src/shared/lib/email-job/enqueue.ts`, `src/shared/lib/email-job/worker.ts`, `src/shared/email/templates/PartialRefundCompletedEmail.tsx`, `prisma/schema.prisma` (`EmailType.PARTIAL_REFUND_COMPLETED`, `EmailJob.refundJobId`)
- **관련 commit**: `37ea659` `56494ea` `178a2e6` `88f7e58` `533b36d`

## Context (배경)

거래 종료 메일은 [ADR-0030]에서 **booking 상태전이 아웃박스**(`transitionStatusTx` → `emailJobForTransition`)로 구현됐다. 이 설계는 booking이 `PAID/READY → CANCELED` 로 전이될 때만 `REFUND_COMPLETED` EmailJob을 적재한다.

그러나 [ADR-0036]의 Ledger 다회 부분 환불 시스템(`refundTraveler` not-last = `TRAVELER_CANCEL`, `refundDiscretionary` = `DISCRETIONARY`)은 **booking 상태를 전이시키지 않는다** — 순수 머니무브이거나 일부 여행자만 취소되므로 booking은 여전히 PAID로 활성 상태다. 결과적으로 부분 환불 고객은 환불이 실제로 처리됐는데도 **아무 메일도 받지 못했다.** [ADR-0036] Notes에 "PARTIAL_REFUND_COMPLETED 미구현 — 별도 에픽"으로 박제됐던 갭이다.

세 가지 설계 난제가 있었다:
1. **적재 트리거 부재** — 부분 환불엔 상태전이가 없어 기존 아웃박스가 발동하지 않는다.
2. **대상 식별 불가** — 한 예약(booking)에 부분 환불이 여러 번 누적될 수 있다. 기존 `REFUND_COMPLETED` hydration은 `bookingId`로 "최신 SUCCEEDED RefundJob"을 읽는데, 부분 환불은 *특정* RefundJob을 가리켜야 한다.
3. **중복 발송 위험** — 전체 취소(`FULL_CANCEL`)는 이미 `REFUND_COMPLETED`를 받는데, 환불 settle에 무조건 partial 메일을 걸면 한 사건에 메일 2통이 나간다.

## Decision (결정)

**(1) settle Phase 3 Tx 내부 트랜잭셔널 아웃박스.** 환불 settle은 두 경로에 존재한다(동기 happy-path `runRefundSaga`, cron 재시도 `retryRefundJob`). 각 경로의 Phase 3 정산 `$transaction`(Payment 상태 + RefundJob SUCCEEDED + PaymentEvent) **내부**, `paymentEvent.create` 직후에 EmailJob을 적재한다. settle이 롤백되면 메일 적재도 함께 롤백 → 유실/유령 메일 0.

**(2) `EmailJob.refundJobId` 로 멱등 식별.** nullable 스칼라 컬럼을 신설하고 dedupeKey를 `partial-refund-completed:<refundJobId>` 로 둔다. 워커는 hydration 시점에 이 id로 RefundJob을 직접 조회(`getPartialRefundCompletedEmailData`) → 다회 부분 환불에서도 "이 환불"의 금액을 정확히 읽는다.

**(3) `FULL_CANCEL` 제외 게이트.** 두 경로 모두 `kind !== "FULL_CANCEL"` 일 때만 적재. 전체 취소는 onSettled의 booking 전이가 기존 `REFUND_COMPLETED`를 담당한다.

```ts
// refund.ts / refundRetry.ts — Phase 3 settle Tx 내부
if (kind !== "FULL_CANCEL") {
  await enqueueEmailJob(tx, {
    type: "PARTIAL_REFUND_COMPLETED",
    dedupeKey: `partial-refund-completed:${refundJobId}`,
    bookingId, refundJobId,
  });
}
```

**(4) 순환 의존(circular import) 회피 — 딥 경로 import.** `entities/payment`(refund.ts/refundRetry.ts)는 적재 헬퍼를 `@/shared/lib/email-job` **배럴이 아니라** `@/shared/lib/email-job/enqueue` **딥 경로**로 import한다. 배럴은 `worker.ts`를 re-export하고 worker는 다시 `@/entities/payment`(hydration 로더)를 import하므로, 배럴을 쓰면 `entities/payment → email-job 배럴 → worker → entities/payment` 순환이 생긴다. `enqueue.ts`만 콕 집으면 worker를 끌고 오지 않아 순환이 끊긴다. [ADR-0030]에서 `mutations.ts`가 같은 이유로 채택한 선례를 따른다.

## Consequences (결과)

**얻은 것:**
- 부분 환불(TRAVELER_CANCEL / DISCRETIONARY) 고객이 원결제 금액·공제 위약금·최종 환불액이 명시된 완료 메일을 받는다 — 결제/환불 도메인의 마지막 알림 루프 봉합.
- settle과 메일 적재가 원자적(아웃박스) → PG 지연·Resend 장애가 환불 트랜잭션을 막지 않고, settle 롤백 시 메일도 안 나간다([ADR-0003] 외부 IO 격리 유지).
- 동기 경로와 cron 재시도 경로 중 정확히 하나만 settle하며, dedupeKey 멱등이 at-least-once를 effectively-once로 만든다.
- FSD 단방향·순환 무손상.

**포기한 것 / 미해결:**
- `EmailJob.refundJobId` 는 back-relation 없는 plain 스칼라다(워커가 id로 직접 조회). FK 무결성보다 마이그레이션 최소화·payload-free 아웃박스 일관성을 택함.
- `getPartialRefundCompletedEmailData` 의 `originalAmount` 는 *전체* 결제액(`payment.amount`)이다. 부분 취소분 원금(`baseAmount`)이 아니므로 "원결제 − 위약금 = 환불"의 산술 항등은 성립하지 않는다 — 템플릿은 세 값을 *독립 사실*로만 표기(오해 방지).
- 출발 취소 cascade(batch fan-out)로 생성되는 RefundJob도 부분 환불이면 이 메일을 받는다(의도된 동작). 배치 단위 묶음 알림은 범위 밖.

## Alternatives Considered (대안)

### 옵션 A: dedupeKey에 refundJobId를 인코딩하고 컬럼은 추가 안 함
- `partial-refund-completed:<refundJobId>` 에서 워커가 문자열을 파싱해 refundJobId 추출.
- 거부: 워커가 dedupeKey 포맷에 강결합 → 키 스킴 변경이 hydration을 깨뜨린다. nullable 스칼라 컬럼 하나가 명시적이고 견고. 결제 도메인은 명시성이 우선.

### 옵션 B: `REFUND_COMPLETED` 타입 재사용 + hydration만 수정
- 새 enum/템플릿 없이 기존 타입으로 부분 환불도 처리.
- 거부: (a) dedupeKey `refund-completed:<bookingId>` 는 한 예약의 다회 부분 환불에서 충돌(첫 건만 발송). (b) 기존 템플릿 카피("취소된 예약 / 환불이 완료되었습니다")가 부분 환불에 부정확. 별도 타입 + per-refundJob 키가 필수.

### 옵션 C: 동기 발송(settle 시점에 Resend 직접 호출)
- 거부: 외부 IO를 환불 트랜잭션에 묶으면 Resend 지연이 결제/환불 경로에 직결되고, settle 롤백 시 메일-DB 불일치. [ADR-0003]/[ADR-0030] 아웃박스 원칙 위반.

### 옵션 D: `@/shared/lib/email-job` 배럴로 import
- 거부: worker.ts를 경유해 `entities/payment ↔ email-job` 순환 의존 발생. 딥 경로 `/enqueue` 로 차단([ADR-0030] mutations.ts 선례).

## Notes

- 후속 부채: 부분 환불 완료 메일의 통합 테스트(실 DB + cron 워커 e2e)는 미작성 — 현재는 saga 단위(enqueue 호출 검증) + worker 단위(hydrate→send 페이로드) + render 단위로 커버.
- 모니터링: `cron.email-job.*` 메트릭에 PARTIAL 타입이 섞여 들어온다. 타입별 분리가 필요하면 worker 메트릭에 type 라벨 추가 검토.
- `originalAmount` 의미를 baseAmount로 바꾸자는 요구가 6개월 뒤 나올 수 있음 — 그때는 산술 항등 표기까지 함께 도입할 것(현재는 의도적으로 독립 사실 표기).
- 관련: [ADR-0003] 외부 IO Tx 격리, [ADR-0030] 메일 아웃박스 + 딥 import 선례, [ADR-0031] 위약금 동결 스냅샷, [ADR-0036] Ledger 다회 부분 환불.
