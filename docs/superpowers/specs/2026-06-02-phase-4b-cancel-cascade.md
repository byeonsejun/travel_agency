# Phase 4-B — 취소/환불 Cascade & 부분 실패 복구 설계 (Spec)

> 작성일: 2026-06-02 · brainstorming 세션(2026-06-02) 결정사항 박제.
> 선행: Phase 4-A Departure CMS([ADR-0027]), 환불 Saga 3-phase([ADR-0003]), Cron 워커 3-layer 멱등([ADR-0005]).
> ⚠️ 본 문서는 *설계*다. 구현 체크박스는 후속 plan(`writing-plans`)에서 생성한다.
> 💳 Domain Booking + ⚙️ Backend 페르소나 전 구간 강제 참여 (돈·좌석·멱등성).

---

## 1. Context — 왜 이 작업인가

Phase 4-A는 예약이 있는 출발일(`bookedSeats > 0`)의 취소를 **차단**했다([ADR-0027] D1). 이유: 단건 기준 환불 Saga(`refundBooking`)를 N건에 fan-out하면 부분 실패(partial failure) 복구가 별도 에픽이기 때문. Phase 4-B가 바로 그 에픽이다 — 관리자가 **예약이 묶인 출발일을 강제 취소**하고, N건의 환불/취소를 비동기로 처리하며, **부분 실패를 추적·가시화·재시도**한다.

**핵심 통찰**: 단건의 부분 실패 복구(CAS claim·backoff·job 격리·`attempts≥max → FAILED`)는 `process-refunds` cron + `RefundJob`으로 **이미 완성**돼 있다. 4-B가 추가하는 것은 그 위의 **fan-out 오케스트레이션 + 배치 관찰성** 레이어뿐이다. 실제 환불은 기존 3-phase Saga가 그대로 수행한다.

---

## 2. 확정된 아키텍처 (brainstorming 결정사항)

| # | 결정 | 근거 / 거부된 대안 |
|---|---|---|
| B1 | **신규 부모 배치 테이블 `DepartureCancellation`** — 결제 여부 무관 N건을 1 배치로 통합 추적 | 파생 집계(미결제 누락·배치 정체성 없음)·RefundJob 태그만(미결제 누락) 거부. |
| B2 | **departure 즉시 `CANCELED`** (새 CANCELING 상태 없음) | `reserveSeats` 가드로 신규 판매 자동 차단. "진행 중"은 배치가 소유 → 상태/프로세스 분리. enum 마이그레이션 회피. |
| B3 | **비동기 enqueue + 기존 cron drain** (동기 루프 금지) | 30건 PG 동기호출 = 타임아웃. ADR-0003 "외부 IO는 Tx 밖" 원칙 + 검증된 격리/backoff 재사용. |
| B4 | **force-cancel 전용 경로** — Phase 4-A의 `bookedSeats===0` 가드 우회 | 4-A 일반 취소 가드는 보존(예약 0일 때만). force 경로가 좌석 drain의 주체이므로 별도. |

---

## 3. 신규 스키마 — `DepartureCancellation` + `RefundJob.cancellationBatchId`

> ⚠️ Prisma 마이그레이션 필요. 본 프로젝트는 `prisma migrate dev` shadow DB 재현이 불가(첫 migration이 partial raw artifact)하므로, 기존 컨벤션 `prisma db execute --file <migration.sql>` + `prisma migrate resolve --applied <name>`을 사용([ADR-0027] Task 1 선례와 동일).

```prisma
enum DepartureCancellationStatus {
  PROCESSING        // 환불 job 일부 미종결
  COMPLETED         // 전 건 종결 + 실패 0
  PARTIALLY_FAILED  // 전 건 종결 but FAILED 1건 이상 (admin 재시도 필요)
}

model DepartureCancellation {
  id               String   @id @default(cuid())
  departureId      String
  status           DepartureCancellationStatus @default(PROCESSING)
  totalBookings    Int      // 취소 시점 활성(좌석점유) 예약 수
  immediateCancels Int      @default(0) // 미결제 → 즉시 취소된 건수(환불 불필요)
  actor            String   // "admin:<id>"
  reason           String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  departure  Departure   @relation(fields: [departureId], references: [id], onDelete: Cascade)
  refundJobs RefundJob[]

  @@index([status])
  @@index([departureId])
}
```

`RefundJob`에 추가 (nullable — 단일 사용자 환불은 batch 없음, 기존 row 호환):

```prisma
  cancellationBatchId String?
  cancellationBatch   DepartureCancellation? @relation(fields: [cancellationBatchId], references: [id])
  // 기존 @@index([status, nextRunAt]) 유지 + 추가:
  @@index([cancellationBatchId])
```

`Departure`에 역참조: `cancellations DepartureCancellation[]`.

**집계 모델**: 불변 사실(`totalBookings`, `immediateCancels`)만 저장. 진행 카운트는 RefundJob(batchId) 상태로 **파생**:
- `pending` = PENDING|IN_PROGRESS 수, `failed` = FAILED 수, `succeeded` = SUCCEEDED 수
- 진척 = `immediateCancels + succeeded` / `totalBookings`
- `status`: pending>0 → PROCESSING · pending==0 & failed>0 → PARTIALLY_FAILED · else COMPLETED

---

## 4. `forceCancel` 전용 경로 명세

> 위치: `features/admin-departure-cancel/server/actions.ts`의 오케스트레이션. 여러 entity(departure·booking·payment·departure-cancellation)를 조합하므로 **features 레이어**가 정위치(entity 간 cross-import 금지 회피).

`startDepartureCancellation({ departureId, actor, reason })` — **DB-only 단일 트랜잭션**(외부 IO 0, ADR-0003 원칙):

```ts
return db.$transaction(async (tx) => {
  // 1. force CAS: SCHEDULED|CONFIRMED|CLOSED → CANCELED (4-A의 bookedSeats===0 가드 우회)
  const cas = await tx.departure.updateMany({
    where: { id: departureId, status: { in: ["SCHEDULED", "CONFIRMED", "CLOSED"] } },
    data: { status: "CANCELED", version: { increment: 1 } },
  });
  if (cas.count === 0) throw new DepartureNotCancelableError(departureId); // 이미 CANCELED/부재 → 멱등 no-op

  // 2. 활성(좌석점유) 예약 로드 — SEAT_HELD_STATES + PAID payment 동반
  const bookings = await tx.booking.findMany({
    where: { departureId, status: { in: SEAT_HELD_STATES } },
    select: { id: true, status: true, payments: { where: { status: "PAID" }, select: { id: true, amount: true, tossPaymentKey: true }, take: 1 } },
  });

  // 3. 배치 생성
  const batch = await tx.departureCancellation.create({
    data: { departureId, actor, reason, totalBookings: bookings.length, status: "PROCESSING" },
    select: { id: true },
  });

  // 4. fan-out 분기 (DB-only) — **status 기준** 분기.
  //    PAID/READY는 반드시 환불 enqueue (키/금액 이상은 cron의 기존 short-circuit이
  //    FAILED로 가시화 — PAID를 환불 없이 silent 취소하는 위험을 원천 차단).
  let immediate = 0, enqueued = 0;
  for (const b of bookings) {
    if (b.status === "PAID" || b.status === "READY") {
      const paid = b.payments[0];
      if (!paid) throw new RefundablePaymentMissingError(b.id); // PAID인데 payment 부재 = 데이터 이상 → 배치 중단(롤백)
      await enqueueRefundJob(tx, { bookingId: b.id, paymentId: paid.id, amount: paid.amount,
        actor, reason, cancellationBatchId: batch.id }); // Phase 1 enqueue only (PG는 cron)
      enqueued++;
    } else {
      await cancelBookingByAgencyTx(tx, { bookingId: b.id, fromStatus: b.status, actor, reason }); // 미결제 즉시(releaseSeats)
      immediate++;
    }
  }

  // 5. 즉시 종결 여부
  const status = enqueued === 0 ? "COMPLETED" : "PROCESSING";
  await tx.departureCancellation.update({ where: { id: batch.id }, data: { immediateCancels: immediate, status } });
  return { batchId: batch.id, total: bookings.length, enqueued, immediate };
});
```

- **멱등/재진입**: step 1 CAS `count===0`이면 이미 취소 → 신규 배치 미생성(no-op). `enqueueRefundJob`은 기존 중복 게이트(PENDING/IN_PROGRESS/SUCCEEDED 존재 시 skip) 재사용 → 더블클릭/중복 cron 안전. 이중 환불 수학적 불가.
- **tx 범위**: 외부 IO 0(create batch / departure update / RefundJob create / 미결제 booking 전이만). capacity ~20-40이라 tx 크기 무해.

---

## 5. ADR-0003 Saga 연결 — 부분 실패 집계·재시도 메커니즘

> 배치는 **오케스트레이션·관찰성 레이어**. 실제 PAID 환불은 기존 3-phase Saga가 cron에서 그대로 수행. RefundJob에 `cancellationBatchId`만 더해 묶는다.

```
① startDepartureCancellation (동기, DB-only)  → §4
② [process-refunds cron]  기존 워커 무수정 — RefundJob별 격리 drain:
     CAS claim → Phase 2(PG cancel) → Phase 3(Payment CANCELED + RefundJob SUCCEEDED + booking CANCELED_BY_AGENCY)
     실패 → PENDING+backoff / attempts≥max → FAILED(terminal)
   (확장) drain 후 처리된 job들의 distinct cancellationBatchId 수집 → recomputeBatchStatus(batchId) 호출
③ recomputeBatchStatus(batchId)  RefundJob(batchId) 상태 집계 → PROCESSING|PARTIALLY_FAILED|COMPLETED 갱신
④ [admin 배치 상세]  배치 진척 + 예약별 RefundJob 상태 · FAILED → "재시도"
     retryBatchRefundAction: updateMany(status=FAILED → PENDING, nextRunAt=now) CAS → cron 재drain → 같은 Saga 재진입
     재시도 직후 recomputeBatchStatus → PROCESSING 복귀
```

**FSD 정합**: `recomputeBatchStatus`는 `entities/departure-cancellation/api`에 위치하되 자기 배치 row + `db.refundJob`(shared db 접근, entity import 아님)만 조회 → cross-slice import 0. cron route(app)·retry action(features)이 호출(app/features가 entity 조합 — 허용).

**Saga 변경점은 단 하나**: 단건 동기 PG를 수행하던 `refundBooking`과 별개로, **enqueue-only `enqueueRefundJob(tx, args)`** (Phase 1만, PG는 cron)를 `entities/payment/api`에 추가(refundBooking의 Phase 1 로직 추출·재사용). 기존 단일 사용자 동기 취소 경로 무손상.

---

## 6. 상태머신 영향

- **Departure**: force-cancel은 `SCHEDULED|CONFIRMED|CLOSED → CANCELED` (4-A `transitionDepartureStatus`의 `bookedSeats===0` 가드를 우회하는 별도 `updateMany` CAS). 4-A 일반 전이 경로·가드는 무손상.
- **Booking**: PAID/READY → `CANCELED_BY_AGENCY`(cron의 Saga Phase 3) · 미결제(RECEIVED/AWAITING_GROUP/DEPARTURE_CONFIRMED) → `CANCELED_BY_AGENCY`(배치 tx 인라인). 둘 다 기존 `assertTransition` 화이트리스트 통과 + `shouldReturnSeats` → `releaseSeats`로 좌석 환원. 신규 전이 없음.
- **DepartureCancellation**: PROCESSING → (COMPLETED | PARTIALLY_FAILED). PARTIALLY_FAILED → PROCESSING(재시도 시) → 재종결.

---

## 7. 관찰성 UI (admin)

- **배치 목록** `/admin/departure-cancellations` (RSC, force-dynamic): 배치별 행 — 상품/출발일, status 배지, 진척(`immediate+succeeded / total`), failed 카운트, 생성 시각.
- **배치 상세** `/admin/departure-cancellations/[id]`: 예약별 RefundJob 상태 테이블(bookingId, status, attempts, lastError) + 미결제 즉시취소 요약. **FAILED 행에 "재시도" 버튼**(`<form action>` → retry action). PARTIALLY_FAILED 배치 상단에 "전체 재시도" 버튼(모든 FAILED → PENDING).
- **진입점**: Phase 4-A departure 편집 페이지의 "출발 취소" 버튼 — `bookedSeats>0`일 때 4-A에선 비활성이었으나, 4-B에선 **"강제 취소 (N건 환불)"** 로 전환(빨강 + 확인 + 건수 경고). 클릭 → `startDepartureCancellation` → 배치 상세로 redirect.

---

## 8. FSD 레이어 배치 & Files Map

| 레이어 | 경로 | 책임 | 신규/수정 |
|---|---|---|---|
| prisma | `schema.prisma` | `DepartureCancellation` + enum + `RefundJob.cancellationBatchId` + 역참조 | 수정 |
| prisma | `migrations/<ts>_departure_cancellation/migration.sql` | DDL + 인덱스 | 신규 |
| entities | `payment/api/enqueueRefundJob.ts` | Phase 1 enqueue-only(dedup 게이트) — refundBooking에서 추출 | 신규 |
| entities | `payment/index.ts` | barrel `enqueueRefundJob` | 수정 |
| entities | `booking/api/mutations.ts` | `cancelBookingByAgencyTx(tx, ...)` — tx 수용 인라인 취소 헬퍼 | 수정 |
| entities | `departure-cancellation/model/types.ts` | 배치 타입 | 신규 |
| entities | `departure-cancellation/api/recomputeBatchStatus.ts` | 배치 상태 파생·갱신 | 신규 |
| entities | `departure-cancellation/api/queries.ts` | 목록·상세 조회 | 신규 |
| entities | `departure-cancellation/index.ts` | barrel | 신규 |
| features | `admin-departure-cancel/server/actions.ts` | `startDepartureCancellation` 오케스트레이션 + `retryBatchRefundAction` | 신규 |
| features | `admin-departure-cancel/index.ts` | barrel | 신규 |
| app | `api/cron/process-refunds/route.ts` | drain 후 영향 배치 `recomputeBatchStatus` 호출 | 수정 |
| app | `(admin)/admin/departure-cancellations/page.tsx` | 배치 목록 | 신규 |
| app | `(admin)/admin/departure-cancellations/[id]/page.tsx` | 배치 상세 + 재시도 | 신규 |
| app | `(admin)/admin/products/[id]/departures/[depId]/edit/page.tsx` | "강제 취소" 버튼 전환 | 수정 |
| docs | `adr/0028-departure-cancel-cascade-batch.md` | ADR(사용자 승인 시) | 후보 |
| docs | `CLAUDE.md` §8 | Phase 4-B 완료 노트 | 수정 |

---

## 9. 테스트 전략 (TDD)

| 대상 | 종류 | 핵심 케이스 |
|---|---|---|
| `enqueueRefundJob` | 단위(mock db) | PENDING 생성 · 중복 게이트(기존 active job 존재 시 skip) · batchId 보존 |
| `recomputeBatchStatus` | 단위(mock db) | pending>0→PROCESSING · failed>0&pending0→PARTIALLY_FAILED · 전부 SUCCEEDED→COMPLETED · 0 job→COMPLETED |
| `startDepartureCancellation` | 단위(mock db tx) | force CAS(이미 CANCELED→DepartureNotCancelable) · PAID→enqueue·미결제→인라인 취소 분기 · 배치 totalBookings/immediateCancels · enqueued0→COMPLETED |
| `retryBatchRefundAction` | 서버액션 | ADMIN 가드 · FAILED→PENDING CAS · recompute 호출 |
| 런타임 QA | 🔬 evidence | 혼합 배치(PAID+미결제) 강제취소 → cron drain → 일부 PG 실패 주입 → PARTIALLY_FAILED → 재시도 → COMPLETED. departure CANCELED 즉시 신규예약 차단. 이중클릭 멱등(배치 1개). 좌석 환원(bookedSeats→0). |

---

## 10. Out of Scope (명시적 제외)

- 부분 환불(금액 일부) — 전액 환불만(기존 RefundJob.amount 전액 모델 유지).
- 취소 사유별 환불 정책(위약금 차등) — 별도 정책 마일스톤.
- 배치 진행 실시간 푸시(SSE/WebSocket) — admin은 RSC 새로고침(force-dynamic).
- 자동 재시도 무한화 — `attempts≥max → FAILED`는 기존 정책 유지, 이후엔 수동 재시도만.
- 사용자(고객) 측 출발 취소 알림(이메일) — 이메일 마일스톤과 연계.

---

## 11. ADR 후보

- **ADR-0028**: fan-out 취소를 부모 배치(`DepartureCancellation`) + RefundJob `batchId`로 오케스트레이션, 상태/프로세스 분리(departure 즉시 CANCELED + 배치 PROCESSING), enqueue-only로 ADR-0003 Saga 재사용. 거부 대안: 동기 루프(타임아웃)·파생 집계(미결제 누락)·새 CANCELING 상태(enum 비용).

---

## 12. 인수인계 — 다음 작업자가 헷갈릴 지점

- **"왜 배치 테이블이 따로 있나? RefundJob로 안 되나?"** — RefundJob은 PAID 환불(돈 경로)만. 미결제 즉시취소는 RefundJob이 없어 누락 → 배치가 결제 여부 무관 N건을 통합 추적(B1).
- **"왜 departure가 환불 끝나기 전에 CANCELED?"** — 상태(판매 종결) vs 프로세스(환불 drain) 분리(B2). 신규 판매는 즉시 막아야 하고, 환불 진행은 배치가 추적.
- **"force-cancel이 왜 4-A 가드를 우회하나?"** — 4-A는 "예약 있으면 취소 불가"(안전 차단). 4-B force 경로가 바로 그 예약들을 drain하는 주체라 우회가 정당. 일반 `transitionDepartureStatus` 가드는 보존.
- **"PG 호출은 어디서?"** — admin 액션엔 0(DB-only enqueue). 기존 `process-refunds` cron이 Phase 2 PG 수행(ADR-0003 무수정). 배치는 결과만 관찰.
- **"이중 환불 안 나나?"** — `enqueueRefundJob`의 중복 게이트 + ADR-0003 3중 멱등성. 더블클릭은 departure CAS `count===0`으로 차단.
- **"배치 status는 누가 갱신?"** — `recomputeBatchStatus`(파생). cron drain 후 + 재시도 후 호출. RefundJob 상태가 SSOT, 배치 status는 그 투영.
