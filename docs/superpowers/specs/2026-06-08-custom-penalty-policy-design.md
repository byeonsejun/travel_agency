# Spec — 상품별 커스텀 위약금 정책 CMS (Phase 14 / C2)

> 하드코딩된 `OVERSEAS_PENALTY_TIERS`([ADR-0031]) 단일 정률을 DB 층위의 **네임드·불변 버전 정책 템플릿**으로 끌어내려, 상품/출발일별로 위약금 정책을 커스터마이즈하는 admin CMS.
> 설계 확정일: 2026-06-08. 브레인스토밍 4대 결정 모두 권장안 채택.

---

## 1. 확정된 설계 결정 (브레인스토밍 산출)

| # | 쟁점 | 결정 |
|---|---|---|
| D1 | 적용 단위 | **Product 기본값 + Departure 오버라이드** (3단계 폴백 체인) |
| D2 | 소급/스냅샷 | **예약 시점 스냅샷** — 정책 수정은 미래 예약에만, 기존 예약 불변 |
| D3 | 데이터 모델 | **네임드 `PenaltyPolicy` 테이블 + append-only 불변 버전 + tiers JSONB** |
| D4 | 100% 위약금(환불불가) | **0~100% 전 범위 허용 + `refundAmount===0` 가드 신설** |

근거: 소비자보호(가입 당시 약관 유지)는 `Booking.totalPrice` 스냅샷([ADR-0027]) · 위약금 금액 동결([ADR-0031])과 동형. 불변 버전이 reference-snapshot을 안전하게 만든다(취소 시 정확한 tiers 복원 보장).

---

## 2. 데이터 모델

### 2.1 신규 테이블 `PenaltyPolicy`

```prisma
model PenaltyPolicy {
  id        String   @id @default(cuid())
  key       String   // 논리 식별자, 버전 간 안정. ex) "standard_overseas", "peak_season"
  version   Int      // key별 1부터 증가. 수정 = 새 버전 행 생성(기존 행 불변)
  name      String   // 표시명. ex) "국외여행 표준약관", "성수기 강화"
  tiers     Json     // [{ minDaysBefore: number, rate: number }, ...] 내림차순
  isActive  Boolean  @default(true) // key당 정확히 1개만 true (현재 활성 버전)
  createdBy String?  // "admin:<id>" (감사)
  createdAt DateTime @default(now())

  @@unique([key, version])
  @@index([key, isActive])
}
```

- **불변성**: 기존 행은 절대 UPDATE(tiers 변경) 안 함. 정책 편집 = `version+1` 새 행 INSERT + 이전 활성 행 `isActive=false` + 새 행 `isActive=true` (단일 Tx).
- **tiers JSONB shape** (Zod로 검증 — §4):
  ```ts
  // PenaltyTier[]
  { minDaysBefore: number; rate: number }
  ```

### 2.2 할당 (Product / Departure)

```prisma
// Product
penaltyPolicyKey String?  // null → 시스템 기본("standard_overseas")
// Departure
penaltyPolicyKey String?  // null → 상품 정책 상속 (오버라이드 시에만 set)
```

- 논리 `key` 참조(특정 버전 id 아님). 예약 시점에 key → **활성 버전**으로 해소 → 스냅샷. 하드 FK 미설정(문자열 key + app-layer 검증; 정책 템플릿 멘탈모델에 부합).

### 2.3 Booking 스냅샷

```prisma
// Booking
penaltyPolicyKey     String?  // 예약 시점 동결 (legacy 예약 = null → 시스템 기본 상수)
penaltyPolicyVersion Int?     // 동결 버전 → 취소 시 정확한 tiers 복원
```

- 추가로 기존 `BookingTerms`에 동일 `(termKey=key, termVersion=version)` 행 적재 → "동의한 취소약관" 감사기록(이미 `termKey: "standard_overseas_v1"` 주석이 이 의도를 시사). 취소 시 **권위 앵커는 `Booking.penaltyPolicyVersion`**(BookingTerms는 감사용).

### 2.4 시스템 기본 폴백

- `OVERSEAS_PENALTY_TIERS` 상수(`penaltyPolicy.ts`)는 **최종 코드 폴백**으로 잔존(null-안전: 정책 미할당·legacy·DB 조회 실패 graceful).
- `prisma/seed.ts`: 이 상수를 `PenaltyPolicy{ key:"standard_overseas", version:1, name:"국외여행 표준약관", isActive:true }`로 시드해 admin이 조회·복제 가능.

---

## 3. 핵심 흐름

### 3.1 정책 해소 (resolve) — 순수 함수
```
resolvePenaltyPolicyKey(productKey, departureKey): string
  = departureKey ?? productKey ?? "standard_overseas"
```
DB에서 active version 조회는 별도(불순). 해소 키 결정만 순수.

### 3.2 예약 시점 (snapshot) — `entities/booking/api/mutations.ts` createBooking Tx
1. product/departure의 `penaltyPolicyKey` 로드(이미 departure 조회 중) → `resolvePenaltyPolicyKey`.
2. 해당 key의 활성 `PenaltyPolicy` 조회(없으면 "standard_overseas" 활성, 그것도 없으면 상수 → version=0 표기).
3. `Booking.penaltyPolicyKey/Version` 동결 + `BookingTerms` 행 적재(같은 Tx).

### 3.3 취소 시점 (apply) — `entities/payment/api/refund.ts` refundTraveler
1. `booking.penaltyPolicyVersion`/`Key` 로드 → `PenaltyPolicy.tiers` 조회.
   - null(legacy) 또는 조회 실패 → `OVERSEAS_PENALTY_TIERS` 상수 폴백.
2. `computePenalty({ baseAmount, departureDate, now, tiers })`.
3. **정책 수정 소급 ❌** — 스냅샷 버전만 읽으므로 admin이 정책을 바꿔도 기존 예약 금액 불변.

### 3.4 computePenalty 리팩터
```ts
// before: 내부에서 OVERSEAS_PENALTY_TIERS 사용
// after: tiers를 주입받는 순수 함수
computePenalty({ baseAmount, departureDate, now, tiers: PenaltyTier[] }): PenaltyResult
```
호출처 2곳(refund.ts, BookingDetailView) + 신규 호출처가 tiers를 전달. 시그니처 변경은 타입체커가 누락을 전부 잡음.

---

## 4. tiers 검증 불변식 (Zod)

`PenaltyTierSchema` / `PenaltyTiersSchema`:
- 최소 1행.
- 각 `rate`: `0 ≤ rate ≤ 1` (D4 — 100% 허용).
- 각 `minDaysBefore`: 정수 또는 `Number.NEGATIVE_INFINITY`(당일 catch-all). JSON 직렬화 불가 → DB엔 sentinel(예: `-99999`) 또는 마지막 행 규약으로 저장, 로드 시 복원. **결정: 마지막 행의 `minDaysBefore`는 항상 매우 작은 정수(예: `-99999`)로 저장**(NEGATIVE_INFINITY 회피, JSON-safe).
- `minDaysBefore` **엄격 내림차순** (정렬 깨지면 find 매칭 오류).
- 마지막 행이 catch-all(가장 작은 minDaysBefore)인지 검증 — 모든 D-day가 매칭되도록.

---

## 5. 100% 위약금 가드 (D4 — Task 1 최우선)

`refundAmount === 0`이면 Toss `cancel({ cancelAmount: 0 })`는 거부됨. 양 사가 경로에 가드:

- **`refund.ts` runRefundSaga Phase 2**: `core.refundAmount === 0`이면 `tossClient.cancel` **호출 skip**, 바로 Phase 3 settle로(환불액 0이므로 PG 머니무브 불필요). PaymentEvent는 기록(감사). booking 전이/좌석 환원(onSettled)은 정상 수행.
- **`refundRetry.ts` retryRefundJob Phase 2**: `job.amount === 0`이면 동일 skip → Phase 3.
- ledger reserveRefund: refundAmount=0도 정상(0 차감) — refundedAmount 불변, status는 `>= amount` 여부로 결정(전액 위약금이면 환불액 0이라도 booking은 취소 terminal로 감).

**Task 1을 최우선**으로 두는 이유: 이 가드가 없으면 이후 100% 정책 생성·취소 e2e가 PG 거부로 실패. 방어선을 먼저 깔고 그 위에 정책 시스템을 쌓는다.

---

## 6. 타격 범위 (Blast Radius) 요약

| 영역 | 변경 |
|---|---|
| `entities/payment/model/penaltyPolicy.ts` | `computePenalty(tiers 주입)`, `PenaltyTier` 타입, 시스템 기본 상수 잔존 |
| `entities/penalty-policy/**` (신규 슬라이스) | model(Zod 검증·resolve 순수함수) + api(활성버전 조회·CRUD/버전전환) + barrel |
| `entities/payment/api/refund.ts`·`refundRetry.ts` | tiers 해소 + `refundAmount===0` 가드 (Task 1) |
| `entities/booking/api/mutations.ts` | 예약 시점 정책 해소·스냅샷·BookingTerms 적재 |
| `widgets/booking-detail/ui/BookingDetailView.tsx` | 미리보기 tiers를 booking 스냅샷 기반으로 |
| `prisma/schema.prisma` + 마이그레이션 + seed | PenaltyPolicy 테이블, Product/Departure/Booking 컬럼, standard_overseas 시드 |
| `app/(admin)/admin/penalty-policies/**` + `features/admin-penalty-policy/**` | 정책 목록·편집 폼·상품/출발일 매핑 UI |

FSD 단방향 유지: `penalty-policy`는 독립 슬라이스, `payment`/`booking`이 이를 참조(또는 payment 내부 model로 둘지 plan에서 확정 — 순환 주의).

---

## 7. Admin CMS UI

- `/admin/penalty-policies` (RSC 목록): key별 활성 버전·tiers 요약·버전 히스토리.
- 정책 생성/편집 폼(`'use client'` island): tier 사다리 행 추가/삭제/편집(minDaysBefore, rate%), 저장 = 새 버전 생성 Server Action(`withRateLimitAction` mutation tier — [ADR-0040]).
- 상품 편집(`/admin/products/[id]`)·출발일 편집 화면: `penaltyPolicyKey` 드롭다운(활성 정책 목록 + "기본값(상속)").
- admin nav에 "위약금 정책" 항목 추가.

---

## 8. 테스트 전략 (TDD)

- **순수함수**: `computePenalty(다양한 tiers)`, `resolvePenaltyPolicyKey` 폴백 체인, `PenaltyTiersSchema`(역순·범위·100%·catch-all 누락 reject).
- **사가**: 스냅샷 동결 후 정책 수정 무영향, `refundAmount===0` 경로(Toss skip + 전이), legacy(null) 상수 폴백.
- **예약 생성**: 스냅샷 컬럼·BookingTerms 적재 검증.
- **admin action**: 새 버전 생성 + isActive 단일성(이전 버전 false 전환) 멱등.
- 종합: typecheck/test/lint/**build**(server-only·배럴·클라경계 회귀 — 메모리 규칙).

---

## 9. ADR 후보

- 정책 CMS 스냅샷 전략(불변 버전 + reference-snapshot) + 3단계 폴백 체인 + 100% 위약금 `refundAmount===0` 가드. 구현 후 발행 제안.

## 10. NO-REAL-MONEY

- 본 작업은 정책/계산/스냅샷 로직 — 실거래 무관. 검증은 Mock/샌드박스(`test_`) 상한 유지(§5 NO-REAL-MONEY).
