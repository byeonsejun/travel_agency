# Phase 5-B — 부분 환불 및 위약금 정책 (Partial Refunds & Penalty Policy)

> 작성일: 2026-06-04
> 상태: Draft (브레인스토밍 확정 → 스펙)
> 도메인: 💳 Domain Booking / ⚙️ Backend / 🏛️ Architect / 🎨 Frontend
> 선행: Phase 2 결제·환불 Saga([ADR-0003]), Phase 4-B 출발취소 Cascade([ADR-0028]), Phase 5-A 메일 아웃박스([ADR-0030])

---

## 1. 배경 & 문제 정의

현재 환불 시스템은 **전액 환불(full refund)만** 지원한다.

- `refundBooking`/`retryRefundJob` 모두 `cancelAmount = paidPayment.amount`(전액) 고정.
- 환불 결과는 `Payment.status = CANCELED`(이진) 한 가지뿐.
- **위약금(취소 수수료) 개념이 코드에 존재하지 않는다.**

실제 여행 상거래에서는 출발일이 가까울수록 취소 위약금이 커진다(국외여행 표준약관). 사용자가 출발 3일 전 취소하면 여행요금의 30%를 위약금으로 공제하고 70%만 환불해야 한다. 이 정책이 없으면 여행사는 출발 임박 취소로 인한 손실(항공·호텔 선결제분)을 전가할 수 없다.

**핵심 통찰**: PG 레이어는 이미 부분취소 준비가 끝나 있다.
- `tossClient.cancel`이 `cancelAmount`를 파라미터로 받는다(전액일 필요 없음).
- `TossCancelStatus`에 `PARTIAL_CANCELED`, `TossCancelResponse.cancels[]` 누적 엔트리 타입이 이미 선언됨.
- webhook 스키마(`PaymentStatusChangedDataSchema`)도 `PARTIAL_CANCELED` status를 이미 수용.

> **빠진 것은 PG 연동이 아니라 (a) 얼마를 환불할지 결정하는 도메인 정책 (b) 그 부분취소 상태를 표현할 스키마 (c) 사용자에게 공제액을 보여주는 미리보기다.**

## 2. 목표 / 비목표

### 목표
1. 국외여행 표준약관 기준 **시간경과 위약금 정책 엔진**(순수 함수, SSOT 상수 테이블).
2. **사용자 자가취소**에 위약금 자동 적용 → Toss 부분취소(`cancelAmount = total − penalty`).
3. **부분취소 상태**(`PaymentStatus.PARTIAL_CANCELED`) + 위약금 스냅샷(`RefundJob.penaltyAmount`) 동결.
4. 취소 전 **환불 예정액/위약금 미리보기**(RSC 주입 + Server Action 권위 재계산).
5. **Admin 단건 취소**의 위약금 부과/면제 토글.
6. 환불완료 **메일 정합성 수정**(부분취소 시 실제 환불액·위약금 반영).

### 비목표 (Out of Scope)
- ❌ **금액분할 환불**(한 결제를 여러 번 나눠 부분취소) — 1회 취소 = 1회 환불 유지.
- ❌ **출발취소 Cascade에 위약금 적용** — 여행사 귀책이므로 표준약관상 위약금 0(전액). 기존 동작 보존.
- ❌ **상품/출발일별 커스텀 정책 CMS** — 표준약관 단일 테이블 SSOT. (향후 에픽)
- ❌ **부분취소 후 재취소/잔액취소** — terminal.
- 🛑 **라이브 실거래** — 전 과정 Mock(localhost:4242)/샌드박스(`test_`) 상한 (§5 NO-REAL-MONEY).

## 3. 위약금 정책 엔진 (순수 함수)

**위치**: `src/entities/payment/model/penaltyPolicy.ts` (외부 IO 0, TDD 1순위)

### 3.1 정책 테이블 (SSOT)

국외여행 표준약관 / 소비자분쟁해결기준(국외여행) — 여행개시일 기준 통보 시점별 여행요금 대비 위약금률:

| 취소 통보 시점 (출발일까지 남은 일수 D) | 위약금률 |
|---|---:|
| 30일 이전 (D ≥ 30) | 0% |
| 29 ~ 20일 전 (20 ≤ D ≤ 29) | 10% |
| 19 ~ 10일 전 (10 ≤ D ≤ 19) | 15% |
| 9 ~ 8일 전 (8 ≤ D ≤ 9) | 20% |
| 7 ~ 1일 전 (1 ≤ D ≤ 7) | 30% |
| 여행 당일 이후 (D ≤ 0) | 50% |

```ts
// 경계는 "남은 일수 하한(minDaysBefore) 이상"으로 평가. 내림차순 첫 매칭.
export const OVERSEAS_PENALTY_TIERS = [
  { minDaysBefore: 30, rate: 0.0 },
  { minDaysBefore: 20, rate: 0.1 },
  { minDaysBefore: 10, rate: 0.15 },
  { minDaysBefore: 8,  rate: 0.2 },
  { minDaysBefore: 1,  rate: 0.3 },
  { minDaysBefore: -Infinity, rate: 0.5 }, // 당일(D≤0) 포함
] as const;
```

### 3.2 함수 계약

```ts
export interface PenaltyInput {
  baseAmount: number;      // 위약금 산정 기준액(원 단위 정수) = 결제 금액(paidPayment.amount)
  departureDate: Date;     // 출발일 (KST 자정 기준으로 해석)
  now: Date;               // 취소 통보 시각 (주입 — 테스트 결정성)
}

export interface PenaltyResult {
  daysBefore: number;      // 출발일까지 남은 일수 (음수 가능 = 당일/지난 후)
  rate: number;            // 적용된 위약금률 (0 ~ 0.5)
  penaltyAmount: number;   // = floor(baseAmount * rate), 원 단위 정수
  refundAmount: number;    // = baseAmount − penaltyAmount
}

export function computePenalty(input: PenaltyInput): PenaltyResult;
```

### 3.3 불변식 (테스트로 강제)

- **정수 보존**: `penaltyAmount`, `refundAmount` 모두 정수. `Math.floor`로 위약금 내림 → 환불액 올림(소비자 유리).
- **합 보존**: `penaltyAmount + refundAmount === baseAmount` (1원 누락 금지).
- **범위**: `0 ≤ penaltyAmount ≤ baseAmount`, `refundAmount ≥ 0`.
- **D-day 계산**: `daysBefore = floor((departureDate@KST자정 − now) / 86_400_000)`. KST(Asia/Seoul) 고정. `departureDate`는 `@db.Date`라 시간 정보 없음 → KST 자정으로 해석.
- **경계값**: D=30 → 0%, D=29 → 10%, D=20 → 10%, D=19 → 15%, D=8 → 20%, D=7 → 30%, D=1 → 30%, D=0 → 50%, D=-3 → 50%.
- **순수성**: 입력 배열·객체 변이 금지, 동일 입력 → 동일 출력.

## 4. 데이터 모델 변경

### 4.1 스키마 (`prisma/schema.prisma`)

```prisma
enum PaymentStatus {
  PENDING
  PAID
  CANCELED
  PARTIAL_CANCELED   // ← 추가: 위약금 공제 후 부분 환불됨
  FAILED
}

model RefundJob {
  // ... 기존 필드 ...
  amount        Int   // (의미 명확화) 실제 환불액 = baseAmount − penaltyAmount.
                      //   전액 환불(위약금 0) 시 = 결제 전액. 기존 행과 호환.
  penaltyAmount Int   @default(0)  // ← 추가: 취소 요청 시점 동결된 위약금 스냅샷
  // ...
}
```

**`amount` 의미 변경 노트**: 기존 `RefundJob.amount`는 "결제 전액(=cancelAmount)"이었다. Phase 5-B 이후 **"실제 환불액(refundAmount)"** 으로 의미를 명확히 한다. 위약금 0인 전액 환불에서는 값이 동일(=결제 전액)하므로 **기존 행/코드와 100% 호환**. `cancelAmount`로 Toss에 보내는 값도 그대로 `RefundJob.amount`(=환불액)이다.

### 4.2 마이그레이션 전략

이 저장소는 `ProductEmbedding`(pgvector) 때문에 shadow DB 기반 `prisma migrate dev`가 실패한다([[project_prisma_migration_workaround]]). 따라서 3-step 우회:

1. `prisma db push`로 dev DB에 스키마 반영 (enum 값 + 컬럼 추가).
2. `prisma/migrations/<ts>_phase5b_partial_refund/migration.sql` 수동 작성 (`ALTER TYPE ... ADD VALUE 'PARTIAL_CANCELED'` + `ALTER TABLE "RefundJob" ADD COLUMN "penaltyAmount" INTEGER NOT NULL DEFAULT 0`).
3. `prisma migrate resolve --applied <migration>`로 히스토리 정합.

> ⚠️ Postgres `ALTER TYPE ... ADD VALUE`는 트랜잭션 내 실행 불가/즉시 사용 제약이 있다 — 별도 statement로 분리. 기존 데이터 backfill 불필요(`penaltyAmount` default 0, 신규 enum은 신규 행만 사용).

## 5. 사가 확장

### 5.1 진입점 `refundBooking` (`refund.ts`)

시그니처에 **명시적 위약금 플래그** 추가 (actor 추론 대신 호출자가 의도 전달):

```ts
interface RefundInput {
  bookingId: string;
  actor: string;
  reason?: string;
  applyPenalty: boolean;   // ← 추가. true=위약금 산정, false=전액 환불
}
```

**Phase 1 enqueue 전 위약금 동결**:
1. 사전 조회를 확장 — `booking.departure.departureDate` + `paidPayment.amount` 동시 select.
2. `applyPenalty === true` → `computePenalty({ baseAmount: paidPayment.amount, departureDate, now: new Date() })`로 `{ penaltyAmount, refundAmount }` 산출.
   `applyPenalty === false` → `penaltyAmount = 0`, `refundAmount = paidPayment.amount` (기존 동작).
3. `RefundJob.create`에 `amount: refundAmount`, `penaltyAmount` 저장 → **이 시점이 동결점**. cron 재시도는 재계산하지 않고 이 스냅샷을 신뢰.

**Phase 2 PG 호출**: `tossClient.cancel({ cancelAmount: refundAmount, ... })` — 환불액만 취소(나머지 = 위약금은 매출 유지 → `PARTIAL_CANCELED`).

**Phase 3 DB Tx**: `Payment.status = penaltyAmount > 0 ? "PARTIAL_CANCELED" : "CANCELED"`. `PaymentEvent.payload`에 `{ penaltyAmount, refundAmount, baseAmount, rate }` 감사 기록.

**booking 전이**: 변경 없음 — `CANCELED_BY_USER`/`CANCELED_BY_AGENCY`로 전이, 좌석 환원은 `shouldReturnSeats` 자동(부분취소여도 좌석은 100% 환원). 메일 트리거(`emailJobForTransition`)도 그대로 발동.

### 5.2 재시도 worker `retryRefundJob` (`refundRetry.ts`)

- **재계산 없음**: `job.amount`(동결된 환불액)를 `cancelAmount`로 사용. `job.penaltyAmount`로 Payment 상태 분기.
- Phase 3: `Payment.status = job.penaltyAmount > 0 ? "PARTIAL_CANCELED" : "CANCELED"`.
- Short-circuit 보강: `payment.status === "CANCELED" || "PARTIAL_CANCELED"` 둘 다 "이미 환불됨"으로 간주해 job 정리.
- 엣지: `job.amount === 0`(이론상 위약금 100%) → Toss `cancelAmount=0` 거부 위험. 표준약관 최대 50%라 실제 발생 불가하나, 방어적으로 `refundAmount === 0`이면 Phase 2 skip + Payment를 `PARTIAL_CANCELED`로 직접 종료(환불할 금액 없음). 스펙에 명시, 테스트로 경계 고정.

### 5.3 Cascade fan-out `enqueueRefundJob` (변경 최소)

- 출발취소 cascade는 **위약금 0(전액)** 유지([ADR-0028] 불변). `penaltyAmount` 기본값 0으로 `create`되므로 **호출자 변경 불필요**. retry worker가 `penaltyAmount=0`을 읽어 `CANCELED`로 처리 → 기존 동작 그대로.

### 5.4 취소 경로별 분기 요약

| 경로 | 호출 | `applyPenalty` | 결과 status |
|---|---|---|---|
| 사용자 자가취소 (`cancelBookingAction`) | `refundBooking` | `true` | 위약금>0 → `PARTIAL_CANCELED`, =0(D≥30) → `CANCELED` |
| Admin 단건취소 (`adminCancelBookingAction`) | `refundBooking` | `!waivePenalty` (토글) | 면제 시 `CANCELED`, 부과 시 위 규칙 |
| 출발취소 Cascade (`startDepartureCancellation`) | `enqueueRefundJob` | (해당 없음, 0 고정) | `CANCELED` |

## 6. 미리보기 & UI 표면화

### 6.1 사용자 자가취소 (`features/booking-cancel`)

- **RSC 주입**: booking 상세 위젯(`widgets/booking-detail`)이 렌더 시점에 PAID payment + departureDate를 읽어 `computePenalty({ now: new Date() })`로 미리보기 산출 → `CancelBookingButton`에 props 주입(`refundPreview`, `penaltyPreview`, `daysBefore`, `rate`). **round-trip 0**.
- **다이얼로그 표시**: "환불 예정 **{refundPreview}원** · 위약금 **{penaltyPreview}원** (출발 D-{daysBefore}, {rate*100}%)". 위약금 0이면 "전액 환불" 배지.
- **권위 재계산**: `cancelBookingAction`이 실행 시점에 `refundBooking({ applyPenalty: true })`로 다시 계산·동결 → 사용자가 페이지를 오래 열어둬 D-day가 바뀐 stale도 서버가 보정. 정책 엔진은 서버에서만 SSOT 실행.
- 결과 state에 확정 환불액/위약금 포함 → 토스트/배너 노출.

### 6.2 Admin 단건취소 (`features/admin-booking-cancel`)

- `AdminCancelBookingSchema`에 `waivePenalty: boolean` 추가(기본 false=부과).
- Admin 취소 폼에 "위약금 면제(여행사 귀책)" 체크박스 + 미리보기(부과 시 환불 예정액 / 면제 시 전액).
- `adminCancelBookingAction` → `refundBooking({ applyPenalty: !waivePenalty })`.

## 7. 환불 메일 정합성 수정 (선행 버그)

현재 `getRefundCompletedEmailData`는 `Payment.amount`(원결제액)를 `refundAmount`로 보고하고 `status:"CANCELED"`만 필터한다 → **부분취소 시 (a) PARTIAL_CANCELED 누락으로 메일 데이터 null (b) 환불액을 원결제액으로 과대 보고**.

수정:
1. 결제 필터에 `PARTIAL_CANCELED` 포함(`status: { in: ["CANCELED", "PARTIAL_CANCELED"] }`).
2. 실제 환불액·위약금은 해당 booking의 **SUCCEEDED `RefundJob`**(`amount`=환불액, `penaltyAmount`)에서 읽는다 → 권위 출처.
3. `RefundCompletedEmailProps`에 `penaltyAmount: number` 추가. `RefundCompletedEmail.tsx`에 위약금>0일 때만 "위약금 {penaltyAmount}원 공제" 라인 조건부 노출.

## 8. 멱등성 & 안전성 불변식 (Domain Booking)

- ✅ **동결(snapshot)**: 위약금은 enqueue 시점 1회 계산·저장. cron 재시도가 며칠 뒤 실행돼도 D-day 재평가로 금액이 바뀌지 않음([ADR-0027] totalPrice 스냅샷 선례 동형).
- ✅ **TOCTOU 없음**: 이중 환불 차단은 기존 `RefundJob` active(PENDING/IN_PROGRESS/SUCCEEDED) 멱등 게이트 그대로. 부분취소도 동일 게이트.
- ✅ **정수 금액**: 모든 금액 원 단위 정수. float 금지.
- ✅ **외부 IO Tx 밖**: Phase 2 PG 호출은 DB Tx 바깥 유지([ADR-0003]).
- ✅ **멱등키**: Toss `Idempotency-Key: cancel:{paymentKey}` 그대로. 부분취소도 같은 키 → 재시도 안전.
- ✅ **좌석 100% 환원**: 부분취소여도 booking이 cancel terminal로 가므로 좌석은 전부 환원(좌석은 금액과 무관).

## 9. 테스트 전략 (TDD)

| 레이어 | 테스트 | 방식 |
|---|---|---|
| 정책 엔진 | `penaltyPolicy.test.ts` — 경계값 6구간 × 정수/합 불변식 | 순수 단위, FAIL→PASS 선행 |
| 사가 진입 | `refund.test.ts` 확장 — applyPenalty true/false × PARTIAL/CANCELED 분기, 스냅샷 저장 | db/toss mock |
| 사가 재시도 | `refundRetry.test.ts` 확장 — penaltyAmount 읽어 분기, 재계산 안 함 | db/toss mock |
| 메일 데이터 | `getRefundCompletedEmailData.test.ts` 확장 — PARTIAL_CANCELED 포함 + RefundJob 환불액 출처 | db mock |
| Server Action | 자가취소/admin토글 분기 (권위 재계산, waivePenalty) | mock |
| 🔬 런타임 | Mock Toss(4242)로 부분취소 e2e — RefundJob.amount/penaltyAmount/Payment.status 증거 | curl/prisma |

Mock 서버(`scripts/qa/mock-toss-server.ts`)는 현재 항상 `CANCELED` 반환. 사가는 Toss 응답이 아닌 로컬 `penaltyAmount`로 상태 분기하므로 **로직엔 영향 없음**. 충실도 향상을 위해 `cancelAmount < 원금액`이면 `PARTIAL_CANCELED` 반환하도록 확장(선택 태스크).

## 10. 관측성

- `payment.refund.partial`(부분취소 성공), `payment.refund.full`(전액) metrics 분리.
- `PaymentEvent.payload`에 `{ baseAmount, penaltyAmount, refundAmount, rate, daysBefore }` 박제(감사·분쟁 대응).
- admin 환불 모니터링(`/admin/...`)에 `penaltyAmount` 컬럼 노출(선택).

## 11. NO-REAL-MONEY 준수 (§5)

본 에픽은 전 과정 Mock(localhost:4242)/토스 샌드박스(`test_`) 범위에서만 검증한다. 부분취소도 동일 — 운영(live) 키·실거래 경로 도입 없음. `tossClient`는 `env.TOSS_API_BASE_URL`(mock/sandbox)만 호출.

## 12. ADR 후보

- **ADR-0031 — 위약금 정책 동결 & 부분취소 상태 모델**: (a) 위약금을 actor 추론이 아닌 명시적 `applyPenalty` 플래그로 받는 결정 (b) 취소 시점 스냅샷 동결(재시도 무재계산) (c) `RefundJob.amount` 의미를 "환불액"으로 재정의하고 별도 ledger 테이블 대신 컬럼 확장 채택 — 거부한 대안(별도 Refund 원장, Booking 금액 필드)의 이유 박제.

## 13. 파일 영향 범위 (요약)

| 종류 | 파일 |
|---|---|
| 신규 | `entities/payment/model/penaltyPolicy.ts` (+ test) |
| 스키마 | `prisma/schema.prisma`, `prisma/migrations/<ts>_phase5b_partial_refund/migration.sql` |
| 사가 | `entities/payment/api/refund.ts`, `refundRetry.ts` (+ tests) |
| 메일 | `entities/payment/api/getRefundCompletedEmailData.ts`, `shared/email/templates/types.ts`, `RefundCompletedEmail.tsx`, `render.ts` (+ test) |
| Server Action | `features/booking-cancel/server/actions.ts`, `features/admin-booking-cancel/server/actions.ts` + 각 `model/schemas.ts` |
| UI | `widgets/booking-detail/ui/BookingDetailView.tsx`, `features/booking-cancel/ui/CancelBookingButton.tsx`, admin 취소 폼 |
| barrel | `entities/payment/index.ts` (computePenalty 노출 여부 검토) |
| Mock(선택) | `scripts/qa/mock-toss-server.ts` |
| ADR | `docs/superpowers/adr/0031-*.md` |
