# Phase 8 — 다회 부분 환불 (Multiple Partial Refunds) 설계

> 작성일: 2026-06-04 · 도메인: payment / booking · 페르소나: 💳 Domain Booking(주), 🏛️ Architect, ⚙️ Backend, 🔬 QA
> 선행 결정: [ADR-0003](../adr/0003-refund-saga-3phase.md)(환불 사가 3-phase), [ADR-0027](../adr/0027-departure-cms-seat-price-safety.md)(가격 스냅샷 면역), [ADR-0028](../adr/0028-departure-cancel-cascade.md)(취소 배치 fan-out), [ADR-0031](../adr/0031-partial-refund-penalty.md)(단회 위약금)
> 신규 ADR 후보: **ADR-0036 — Ledger 기반 다회 부분 환불**

---

## 1. 배경 (Context)

현재 환불 모델은 **"예약(booking) 1건 = 환불(RefundJob) 1건 = 예약 종료(terminal)"** 라는 강한 불변식 위에 서 있다.

- `refundBooking`(`src/entities/payment/api/refund.ts`)은 booking당 RefundJob 1건만 허용한다. `PENDING/IN_PROGRESS/SUCCEEDED` 중 하나라도 있으면 `REFUND_ALREADY_REQUESTED`로 2번째 환불을 **명시적으로 차단**(refund.ts:88–101).
- 환불 직후 booking은 항상 `CANCELED_BY_USER/AGENCY`(terminal)로 전이되고 좌석 100% 환원(`transitionStatusTx` → `shouldReturnSeats` → `releaseSeats(adultCount+childCount)`).
- "부분 환불"(Phase 5-B/[ADR-0031])은 *다회*가 아니라 *단회-위약금차감*이다: `refundAmount = baseAmount − penalty`. 잔여 추적 개념이 없다.
- `Payment.status`는 `CANCELED | PARTIAL_CANCELED` **2값 플래그**일 뿐, "얼마가 환불됐는지" 컬럼이 없다.
- `Traveler` 레코드는 자기가 어느 단가 버킷(성인/아동/유아)인지, 그 좌석에 얼마가 청구됐는지 **모른다**. 단가는 `Departure.priceAdult/Child/Infant`에 살아있고 **수정 가능**(ADR-0027 D2 — booking.totalPrice가 면역인 이유).

Phase 8은 이 단일-취소 모델을 **원장(Ledger) 기반 다회 부분 환불**로 도약시킨다. 두 가지 환불 단위를 모두 지원한다:

1. **`TRAVELER_CANCEL`** — N명 예약 중 일부 여행자만 구조적으로 취소(좌석 환원 + 위약금 적용).
2. **`DISCRETIONARY`** — 관리자 재량 금액 환불(컴플레인 보상·사후 가격조정 등, 위약금/좌석 무관 순수 머니무브).
3. (기존) **`FULL_CANCEL`** — 예약 전체 취소(= 마지막 여행자 취소의 특수형).

## 2. 목표 / 비목표 (Goals / Non-goals)

**목표**
- 하나의 `Payment`에 대해 여러 환불을 안전하게 누적하고, `Σ 환불액 ≤ 결제액` 불변식을 **DB 수준에서 race-free** 보장.
- 여행자별 위약금을 "취소되는 인원의 결제분" 기준으로 정확히 분리 계산.
- 동일 환불 요청 재시도(더블서브밋·cron 재시도)가 이중 환불을 일으키지 않도록 멱등성 강화.
- 부분 취소가 booking을 조기에 terminal로 보내지 않도록 상태머신 분리.
- 기존 seed/과거 예약을 무손실 backfill(데이터 정합성 보장).

**비목표**
- 🛑 **라이브 실거래 없음** — 결제·환불은 영구히 Mock(localhost:4242)/Toss 샌드박스(`test_` 키) 상한. PG cancel은 부분 취소를 네이티브 지원(`cancelAmount` per call)하므로 본 설계는 샌드박스 내에서 완결 검증 가능. (§5 NO-REAL-MONEY)
- 다회 부분 환불의 고객-셀프 UI(마이페이지)는 본 Phase 범위 밖 — admin 진입점 우선. 셀프 부분취소는 후속.
- 환불 금액의 다회 *분할 결제*(예: 한 환불을 여러 PG 호출로 쪼개기)는 비범위. 1 RefundJob = 1 PG cancel call.

---

## 3. 아키텍처 결정 (승인된 5개)

### D1. Ledger 스키마 — 물질화 카운터 + RefundJob 원장화

`RefundJob`을 "booking당 1건"에서 **"Payment에 달리는 N개의 불변 원장 엔트리"**로 재정의. 잔여액은 `Payment`의 물질화 카운터로 추적한다.

```prisma
model Payment {
  // ... 기존 필드 유지 ...
  refundedAmount Int @default(0) // 예약(reserved)된 환불 총액. 불변식: 0 ≤ refundedAmount ≤ amount
  // 잔여 환불가능액 = amount − refundedAmount (파생, 별도 컬럼 없음)
}

enum RefundKind {
  FULL_CANCEL      // 예약 전체 취소 (마지막 여행자 취소 포함)
  TRAVELER_CANCEL  // 일부 여행자 구조적 취소 (좌석 환원 + 위약금)
  DISCRETIONARY    // 관리자 재량 금액 환불 (위약금/좌석 무관)
}

model RefundJob {
  // ... 기존 필드 유지 (amount=실환불액, penaltyAmount=동결 위약금, status, attempts, nextRunAt, actor, cancellationBatchId) ...
  kind           RefundKind @default(FULL_CANCEL) // 기존 row 호환 디폴트
  baseAmount     Int        @default(0)            // 이 환불이 계산된 base (감사용; FULL/TRAVELER는 취소분 base, DISCRETIONARY는 0)
  seatsReleased  Int        @default(0)            // 이 환불이 환원하는 좌석 수 (DISCRETIONARY=0)
  idempotencyKey String?    @unique                // 요청 단위 멱등 (D4). nullable=기존 row 호환
}

model Traveler {
  // ... 기존 필드 유지 ...
  paxType              PaxType?  // 단가 버킷. nullable=backfill 전 호환 → backfill 후 NOT NULL 승격 목표
  unitPrice            Int       @default(0)        // 이 좌석에 청구된 base 스냅샷. 불변식: Σ unitPrice == Booking.totalPrice
  canceledAt           DateTime? // 부분 취소된 여행자 표식 (null=활성)
  canceledByRefundJobId String?  // 어떤 환불로 취소됐는지 추적
}

enum PaxType {
  ADULT
  CHILD
  INFANT
}
```

**근거**
- **물질화 `refundedAmount` 카운터 (vs 매번 SUM 집계):** 프로젝트가 `Departure.bookedSeats`를 같은 방식(매번 Booking 집계 안 함)으로 운영 — 하우스 스타일 일치. RefundJob.amount를 **불변**으로 두어 drift를 원천 차단하고, 예약/해제 2경로만 카운터를 건드린다. 순수-파생(enqueue마다 `SUM(RefundJob.amount)` + `SELECT FOR UPDATE Payment`) 대안은 drift 0이지만 락+집계 왕복 증가로 거부.
- **`refundedAmount`는 SUCCEEDED만이 아니라 예약 중(PENDING/IN_PROGRESS)도 포함.** PG 호출 윈도우 동안 동시 초과환불을 막기 위함 — 좌석 hold와 동형(예약 즉시 점유, 영구실패 시에만 해제).
- **`Traveler.unitPrice` 스냅샷 (vs Departure 현재가 복원):** "취소되는 인원의 결제분"을 Departure 현재가에서 복원하면 가격이 바뀐 예약에서 틀린다(ADR-0027 D2 위반). 각 Traveler가 청구 base를 자기 안에 동결 → `canceledBase = Σ(취소 Traveler.unitPrice)`가 **참조 아닌 스냅샷**이 되어 가격수정 면역 + `Σ unitPrice == Booking.totalPrice` 정합.

> **infant 좌석 규칙:** `reserveSeats`는 `adultCount + childCount`만 좌석 차감(infant 미차감, mutations.ts:39). `Traveler.seatsReleased`/좌석 환원도 동일 규칙 — INFANT 취소는 `seatsReleased=0`, ADULT/CHILD 취소는 인당 1좌석.

### D2. 동시성 방어 — 조건부 `updateMany` 차감 (좌석 패턴 재사용)

explicit version 컬럼이 아니라 **`updateMany` 조건부 차감**을 채택. §5 Domain Booking 절대규칙("`findUnique→검사→update`(TOCTOU) 금지, 반드시 `updateMany` 조건부 차감") + ADR-0027 D3 좌석 가드와 동일 패턴.

```ts
// Phase 1 (DB Tx) — 환불 예약 = 원장에 reserve
const reserved = await tx.payment.updateMany({
  where: {
    id: paymentId,
    status: { in: ["PAID", "PARTIAL_CANCELED"] },     // 재진입 허용 (PARTIAL_CANCELED는 비-terminal)
    refundedAmount: { lte: amount - requestedRefund }, // ← 초과환불 차단 불변식
  },
  data: { refundedAmount: { increment: requestedRefund } },
});
if (reserved.count === 0) {
  // 경합 패자 또는 한도초과 — 둘 다 안전하게 거부
  throw new PaymentError("REFUND_EXCEEDS_REFUNDABLE", { requestedRefund });
}
```

Postgres가 row lock으로 두 동시 요청을 직렬화 → 두 번째 트랜잭션은 첫 번째 커밋된 `refundedAmount`로 WHERE를 재평가(READ COMMITTED 하에서 잠금 해제 후 최신 row 재읽기). **app 레벨 retry 루프 없이 DB가 불변식을 보장**(원자적 compare-and-swap). 재량환불·여행자취소가 동시에 와도 합이 `amount`를 넘지 못한다.

**거부한 대안**
- **순수 Optimistic (Payment에 `version` 컬럼 + app 재시도 루프):** 동작하지만 `refundedAmount ≤ amount−req` 가드가 이미 원자적 CAS라 version 컬럼+재시도는 잉여. (Departure도 `version`을 "보조용"으로만 두고 실제 안전은 raw CAS로 함 — seatLock.ts:19.)
- **Pessimistic (`SELECT FOR UPDATE Payment` + 형제 RefundJob 집계):** 불변식이 단일 row 조건식으로 표현 가능하므로 멀티-row 락 불필요. 왕복·락보유 시간 증가로 거부.

**reservation 생명주기 (보상):**
- Phase 2 (PG cancel) **영구 실패** → `refundedAmount` 차감 복원(`decrement`) + RefundJob `FAILED`(예약 해제).
- Phase 2 **일시 실패** → 예약 **유지** + RefundJob `PENDING`+backoff(cron 재시도). 보유한 예약이 곧 동시성 방어선이므로 조기 해제 절대 금지.
- 이는 좌석 hold(`reserveSeats`)와 동형: 점유는 시도 즉시, 해제는 영구 실패에서만.

### D3. 위약금 재정의 — '취소되는 부분 금액' 기준 분리 계산

표준약관 위약금률은 **시간(출발일까지 잔여일)의 함수**이지 금액의 함수가 아니다. 같은 rate를 **취소되는 인원의 base**에 적용하면 그 인원분의 정확한 약관 위약금이 나온다(전체액 기준은 한 명 취소에 전원분 위약금 과징).

```ts
// TRAVELER_CANCEL: canceledBase = Σ(취소 Traveler.unitPrice)
const { penaltyAmount, refundAmount } = computePenalty({
  baseAmount: canceledBase,        // ← 부분 base만 주입
  departureDate: booking.departure.departureDate,
  now: new Date(),
});

// DISCRETIONARY: 위약금 개념 없음
// → penaltyAmount=0, refundAmount=요청액, baseAmount=0, seatsReleased=0 (순수 머니무브)

// FULL_CANCEL: canceledBase = Σ(모든 활성 Traveler.unitPrice) = 잔여 결제분
```

`computePenalty`(`penaltyPolicy.ts`)는 이미 `baseAmount`를 파라미터로 받으므로 **순수 함수는 한 줄도 안 바뀐다.** 바뀌는 건 "무엇을 base로 넣느냐"뿐. `OVERSEAS_PENALTY_TIERS` SSOT 그대로.

> **반올림 주의:** `computePenalty`는 `Math.floor(base * rate)`. 여행자별 개별 호출 시 floor가 여러 번 적용돼 전체 취소와 미세 차이(원 단위)가 날 수 있다. 정책: **여행자별 취소는 각 호출이 독립 거래이므로 개별 floor가 정답**(전체 일괄 취소와 합이 1~2원 달라도 무방, 각 환불이 독립 약관 적용). 검증 테스트에 이 의도를 박제.

### D4. 멱등성 — `idempotencyKey` 고도화

**현행 잠복 버그:** `providerEventId = refund:${paymentId}:${Date.now()}`(refund.ts:161)는 **재시도마다 키가 바뀌는 비-멱등** 구조. 단일환불이라 안 터졌을 뿐, 다회에선 더블서브밋 = 이중환불.

**해결:**
- `RefundJob.idempotencyKey @unique` 도입. 요청 단위로 안정적 키 생성:
  - `TRAVELER_CANCEL`: `traveler-cancel:{bookingId}:{정렬된 travelerIds.join(",")}` — 같은 여행자 집합 재요청은 동일 키 → 기존 Job 반환(새 예약 안 함).
  - `DISCRETIONARY`: UI가 버튼 마운트 시 생성한 `requestId`(uuid) 전달 — 더블클릭/재제출이 같은 키 → 1건만 생성.
  - `FULL_CANCEL`: `full-cancel:{bookingId}` (booking당 1회).
- enqueue는 unique 위반을 잡아 **기존 RefundJob 반환**(idempotent no-op). 잔여액 예약은 최초 1회만 발생.
- `PaymentEvent.providerEventId`도 `Date.now()` 제거 → `refund:{refundJobId}`(RefundJob id가 이미 unique)로 결정화.
- Toss `cancel` 호출에 `Idempotency-Key: {refundJobId}` 헤더 전달 → PG 재시도도 이중취소 방지(Toss 네이티브 멱등).
- **기존 "single active RefundJob이 전부 차단" 가드(refund.ts:88–101)는 제거** — idempotencyKey + 잔여액 가드(D2)가 대체.

### D5. 상태머신 분리 — Non-terminal 부분취소 + Booking 터미널 조건

`refundBooking`이 **항상 terminal로 전이**하던 것을 환불 종류별로 분기한다.

| 환불 종류 | Payment.status | Booking.status | 좌석 | Traveler |
|---|---|---|---|---|
| `DISCRETIONARY` | `refundedAmount<amount`→`PARTIAL_CANCELED`, `==amount`→`CANCELED` | **불변** | **불변(0)** | 불변 |
| `TRAVELER_CANCEL` (잔여 여행자>0) | `PARTIAL_CANCELED` | **불변(PAID/READY 유지)** | N개 환원 | 취소분 `canceledAt` 표식 |
| `TRAVELER_CANCEL` (마지막 여행자) | `CANCELED` | `CANCELED_BY_*` (terminal) | 잔여 전부 환원 | 전부 표식 |
| `FULL_CANCEL` | `CANCELED` | `CANCELED_BY_*` (terminal) | 전부 환원 | 전부 표식 |

**핵심 원칙 — Booking terminal은 "좌석점유(잔여 활성 여행자 수)"로 구동, money 원장은 독립:**
- `DISCRETIONARY`는 좌석·여행자·booking 상태를 **절대 건드리지 않는다**(순수 money). 따라서 admin이 재량으로 `amount`까지 다 빼도 booking은 PAID 유지·좌석 점유 유지(여행자는 여전히 탑승). 이는 의도된 분리.
- `TRAVELER_CANCEL` 후 **활성 여행자(`canceledAt IS NULL`) 수가 0이 되면** booking을 `CANCELED_BY_*`로 전이(terminal). 그 전까지는 비-terminal.
- 좌석 환원은 종류별 정밀: `TRAVELER_CANCEL`은 취소 여행자 중 좌석점유분(ADULT+CHILD)만 `releaseSeats(tx, departureId, seatsReleased)`. 전체 환원이 아님.
- `transitionStatusTx`의 `shouldReturnSeats`(전체 좌석 환원)는 **FULL_CANCEL/마지막 여행자 terminal 경로에서만** 작동해야 함 → 부분취소는 terminal 전이를 일으키지 않으므로 자연히 비활성. 단, terminal 도달 시 이미 부분 환원된 좌석을 **이중 환원하지 않도록** 주의(아래 §5.3).

> **booking 상태 보존 vs 카운트:** 부분취소는 `Booking.adultCount/childCount/infantCount`를 **변경하지 않는다**(과거 결제 근거 보존). 현재 활성 인원은 `Traveler where canceledAt=null`로 도출. totalPrice도 불변(스냅샷). 이로써 BookingEvent 감사 로그와 결제 근거가 보존된다.

---

## 4. 마이그레이션 / Backfill 전략 (데이터 정합성)

프로젝트는 pgvector shadow DB 이슈로 표준 `migrate dev`를 쓰지 않는다 → **`db push` + 수동 SQL + `migrate resolve` 3-step 우회**([project memory: Prisma Migration Workaround] 준수).

### 4.1 컬럼 추가 (전부 nullable/default — 무중단)
모든 신규 컬럼은 nullable 또는 default를 가지므로 기존 row를 깨지 않는다:
- `Payment.refundedAmount Int @default(0)` — 기존 환불완료 건은 backfill에서 보정(§4.3).
- `RefundJob.kind @default(FULL_CANCEL)`, `baseAmount @default(0)`, `seatsReleased @default(0)`, `idempotencyKey String? @unique`.
- `Traveler.paxType PaxType?`, `unitPrice Int @default(0)`, `canceledAt`, `canceledByRefundJobId`.

### 4.2 Traveler backfill — paxType + unitPrice (핵심 난제)

**문제:** 기존 Traveler는 `paxType`가 없고, booking은 집계 카운트(`adultCount/childCount/infantCount`)만 안다. seed 예시는 traveler 2명(role만 TRAVELER)인데 adultCount:1/childCount:1 → 누가 성인이고 누가 아동인지 레코드에 없다. 게다가 단가는 가격수정 가능한 Departure에만 있어 과거 실제 청구 단가를 직접 알 수 없다(totalPrice 합계만 스냅샷).

**Backfill 알고리즘 (booking 단위, 멱등 idempotent 스크립트):**
1. booking의 `travelers`를 `birthDate` **오름차순(나이 많은 순)**으로 정렬.
2. **paxType 그리디 배정** — booking의 `adultCount`개를 앞에서 ADULT, 다음 `childCount`개를 CHILD, 나머지 `infantCount`개를 INFANT로 배정. (카운트가 진실 원천 — 나이 분류의 모호함을 카운트로 확정.)
   - 정합 가드: `travelers.length == adultCount+childCount+infantCount` 검증. 불일치 시 해당 booking을 로그+스킵(수동 검토 큐).
3. **unitPrice 배정** — 해당 booking의 `departure` 현재가(`priceAdult/Child/Infant`)를 nominal로 각 paxType에 부여.
4. **잔차 보정 (totalPrice 정합 강제)** — `Σ(배정 unitPrice)`가 `booking.totalPrice`와 다르면(가격 드리프트), **차액을 첫 ADULT 여행자의 unitPrice에 가감**해 `Σ unitPrice == totalPrice` 불변식을 정확히 성립시킨다. ADULT가 없으면 첫 CHILD, 그것도 없으면 첫 INFANT.
   - 근거: 과거 결제액(totalPrice)이 절대 진실이고, 개별 단가는 그 분해일 뿐. 잔차를 한 명에게 몰아 불변식을 깨지 않게 한다(원 단위 정수 보존).
5. 멱등성: 이미 `paxType IS NOT NULL`인 booking은 스킵 → 재실행 안전.

### 4.3 Payment.refundedAmount backfill (기존 환불 건)
- 각 Payment에 대해 `refundedAmount = Σ(RefundJob.amount where status ∈ {PENDING, IN_PROGRESS, SUCCEEDED})`를 1회 집계해 set.
- 기존 RefundJob은 `kind=FULL_CANCEL`(default), `baseAmount = payment.amount`, `seatsReleased = booking.adultCount+childCount`, `idempotencyKey = "full-cancel:{bookingId}"`로 backfill(unique 충돌 시 기존 우선).

### 4.4 검증 (QA R1/R8 증거)
backfill 직후 다음 불변식을 SQL로 검증(전부 0건이어야 통과):
```sql
-- (a) Σ unitPrice ≠ totalPrice 인 booking
SELECT b.id FROM "Booking" b
  JOIN (SELECT "bookingId", SUM("unitPrice") s FROM "Traveler" GROUP BY "bookingId") t
  ON t."bookingId"=b.id WHERE t.s <> b."totalPrice";
-- (b) refundedAmount > amount 인 Payment
SELECT id FROM "Payment" WHERE "refundedAmount" > amount;
-- (c) paxType IS NULL 인 활성 Traveler (스킵된 booking 외)
SELECT id FROM "Traveler" WHERE "paxType" IS NULL;
```

### 4.5 코드 경로 동시 갱신
- `createBooking`(mutations.ts): traveler 생성 시 `paxType`(나이/카운트 그리디 배정) + `unitPrice`(departure 가격 스냅샷)를 채운다. 동일 그리디 로직을 backfill과 공유(순수 함수 `assignPaxTypes`로 추출).
- `prisma/seed.ts`: traveler에 paxType/unitPrice 반영(검증 데이터 정합).

---

## 5. 환불 사가 흐름 (3-phase, 종류별)

기존 [ADR-0003] 3-phase(Phase1 DB / Phase2 외부IO / Phase3 DB) 골격 유지. 종류별 차이만 기술.

### 5.1 공통 Phase 1 (DB Tx) — 예약(reserve)
1. 멱등: `idempotencyKey`로 기존 RefundJob 조회 → 있으면 그대로 반환(no-op).
2. 잔여액 조건부 차감(D2 `updateMany`). `reserved.count===0` → `REFUND_EXCEEDS_REFUNDABLE`.
3. RefundJob `IN_PROGRESS` 생성(kind/baseAmount/penaltyAmount/seatsReleased/idempotencyKey 동결).

### 5.2 Phase 2 (외부 IO, Tx 밖)
- `tossClient.cancel({ paymentKey, cancelAmount: refundAmount, Idempotency-Key: refundJobId })`.
- 실패 시 §3-D2 보상(영구→해제+decrement+FAILED, 일시→유지+PENDING+backoff).

### 5.3 Phase 3 (DB Tx) — 정산(settle)
1. RefundJob `SUCCEEDED`.
2. `Payment.status` 갱신: `refundedAmount < amount` → `PARTIAL_CANCELED`, `== amount` → `CANCELED`.
3. `PaymentEvent` append(`providerEventId = refund:{refundJobId}`, base/penalty/refund 3-tuple 보존).
4. 종류별 후처리:
   - `DISCRETIONARY`: 끝(좌석·booking·traveler 불변).
   - `TRAVELER_CANCEL`: 취소 여행자 `canceledAt`/`canceledByRefundJobId` 표식 + `releaseSeats(tx, departureId, seatsReleased)`. 그 후 **활성 여행자 0이면** `transitionStatusTx(tx, {to: CANCELED_BY_*})` 호출. **단 이때 좌석 이중환원 방지** — 이미 부분 환원했으므로, terminal 전이의 `shouldReturnSeats` 전체 환원과 충돌. → terminal 도달은 "마지막 1명 취소" 케이스이므로, 마지막 취소의 `seatsReleased`만 환원하고 booking 전이는 좌석환원 **없이** 수행하도록 분리(아래 구현 노트).
   - `FULL_CANCEL`: 활성 여행자 전부 표식 + 잔여 좌석 환원 + terminal 전이.

> **구현 노트 — 좌석 이중환원 차단:** `transitionStatusTx`는 `shouldReturnSeats`로 `adultCount+childCount` 전체를 환원한다. 부분취소 경로는 좌석을 *이미* 정밀 환원하므로, terminal 전이 시 전체 환원이 또 일어나면 음수 보정(`GREATEST(...,0)`)에 가려 silent over-release. **대책:** terminal 전이를 일으키는 부분취소 경로는 좌석 환원을 사가가 전담하고, booking 전이는 좌석을 건드리지 않는 변형(`transitionStatusTx({ skipSeatReturn: true })` 옵션 또는 전용 헬퍼)으로 호출. `FULL_CANCEL`도 동일하게 사가가 좌석 전담 → 일관. 이 옵션의 SSOT/회귀 위험은 ADR-0036 Alternatives에 박제.

### 5.4 메일/알림 파급 (Phase 5-A 아웃박스)
- `emailJobForTransition`(emailPolicy.ts)은 booking 상태전이에 묶여 있다. **부분취소는 booking 전이가 없으므로 자동으로 환불메일이 안 나간다** → 부분환불 전용 메일 타입(`PARTIAL_REFUND_COMPLETED`?) 필요 여부는 후속 결정(본 Phase는 최소: terminal 도달 시 기존 환불완료 메일만, 부분건 메일은 비범위/후속). `getRefundCompletedEmailData`는 [ADR-0031]대로 **SUCCEEDED RefundJob**(실환불액+위약금)에서 금액을 읽으므로 다회에도 "최신 1건" 기준 — 다회 메일 시 어느 Job인지 명시 필요(후속).

---

## 6. 영향 범위 (Architect — 레이어/배럴)
- `entities/payment`: refund.ts 대수술, 신규 `refundTraveler.ts`/`refundDiscretionary.ts` 또는 `refund.ts` 내 종류 분기. `index.ts` 배럴 공개 API 갱신.
- `entities/booking`: `transitionStatusTx` 좌석 환원 스킵 옵션, `Traveler` 활성 도출 쿼리, `assignPaxTypes` 순수 함수.
- `entities/payment/api/refundRetry.ts`(cron worker): 종류별 보상·예약 해제 로직 반영. 동결 스냅샷만 읽고 재계산 0 유지([ADR-0031]).
- `features/admin-booking-cancel`, 신규 `features/admin-traveler-cancel`·`features/admin-discretionary-refund`(Server Actions, Zod 검증, 권한 게이트).
- `widgets/booking-detail`: 여행자별 취소 UI + 재량환불 입력 + 잔여 환불가능액 표시.
- 직접 DB 금지/배럴 import 준수, `entities/**/ui`에 `'use client'` 금지.

## 7. 테스트 전략 (TDD — 순수 함수 먼저)
- **순수 함수(테스트 우선):** `assignPaxTypes`(그리디+잔차보정), `computePenalty` 부분 base 호출, 잔여액 계산 헬퍼, idempotencyKey 생성기.
- **동시성:** 두 환불 동시 요청 → `Σ ≤ amount` 보장(조건부 updateMany 경합 테스트). 한쪽만 성공.
- **멱등성:** 동일 idempotencyKey 재요청 → RefundJob 1건·예약 1회.
- **사가 보상:** Phase2 영구실패 → refundedAmount 복원·FAILED. 일시실패 → 예약 유지·PENDING.
- **상태머신:** 마지막 여행자 취소 → terminal + 좌석 이중환원 0. DISCRETIONARY → booking/좌석 불변.
- **Backfill:** §4.4 불변식 SQL 0건. 멱등 재실행.
- 런타임 증거: Mock(localhost:4242)/Toss 샌드박스 `cancelAmount` 부분취소 curl 검증.

## 8. 리스크 & 오픈 이슈
- **R1 (좌석 이중환원):** §5.3 구현 노트의 skip 옵션이 회귀 표면 — 테스트로 박제 필수.
- **R2 (부분환불 메일):** §5.4 — 부분건 알림은 본 Phase 비범위. terminal 도달 메일만. 후속 Phase에서 `PARTIAL_REFUND_COMPLETED` 검토.
- **R3 (DISCRETIONARY vs 좌석점유 불일치):** admin이 좌석 그대로 두고 money만 전액 환불 가능 — 의도된 분리지만 UI에 경고 배너 권장.
- **R4 (backfill 스킵 booking):** 카운트≠traveler 수인 이상 데이터는 수동 검토 큐로. seed는 정합 보장.
- **R5 (floor 누적 오차):** §3-D3 — 여행자별 독립 floor가 정답(약관상 각 취소가 독립 거래). 테스트로 의도 박제.

## 9. NO-REAL-MONEY 준수
본 설계는 PG cancel을 Mock/Toss 샌드박스(`test_`)로만 검증한다. `cancelAmount` 부분 취소는 샌드박스 네이티브 지원이라 라이브 전환 없이 완결 검증 가능. live 키·실거래 경로 도입 0. (§5 NO-REAL-MONEY, [ADR-0009]/[ADR-0014])

---

## 부록 A — 불변식 요약 (SSOT)
1. `0 ≤ Payment.refundedAmount ≤ Payment.amount` (D2 조건부 차감이 강제).
2. `Σ(booking의 Traveler.unitPrice) == Booking.totalPrice` (생성/backfill이 강제).
3. `refundedAmount = Σ(RefundJob.amount where status ∈ {PENDING,IN_PROGRESS,SUCCEEDED})` (예약/해제 2경로만 변경).
4. Booking terminal ⟺ 활성 여행자(canceledAt IS NULL) 수 == 0 (DISCRETIONARY는 영향 0).
5. 좌석 환원 합 == 취소된 ADULT+CHILD 여행자 수 (INFANT·DISCRETIONARY=0, 이중환원 0).
