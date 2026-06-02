# ADR-0027: Departure CMS — 취소 cascade 범위 제외 + 가격 스냅샷 무결성 + admin 리터럴 CAS

- **상태**: Accepted
- **결정일**: 2026-06-02
- **영향 범위**: `src/entities/departure/model/transitions.ts`, `src/entities/departure/api/mutations.ts`, `src/features/admin-departure/server/actions.ts`
- **관련 commit**: `64ed3e1` (상태머신), `98af0d3`/`7e775f6` (mutations CAS), `4d8860a`/`4ea25e4` (server actions)

## Context (배경)

Phase 4-A에서 관리자가 출발일(Departure)을 생성·수정·마감·취소하는 CMS를 구축했다. 예약 시스템의 코어 데이터 공급원이라 좌석(초과예약)·가격(무결성) 안전이 협상 불가였다. 세 가지 결정이 도메인 안전을 좌우했고, 6개월 뒤 같은 고민이 반복되지 않도록 박제한다.

- 출발일을 취소하면 거기 묶인 PAID 예약은 어떻게 되는가?
- 관리자가 가격을 바꾸면 이미 결제한 예약의 금액은?
- 좌석 정원을 줄일 때 이미 찬 예약보다 낮게 줄이는 초과예약(TOCTOU)을 어떻게 막는가?

## Decision (결정)

**D1 — 취소 cascade 범위 제외 + `bookedSeats === 0` 가드.** `CANCELED` 전이는 활성 예약이 0일 때만 허용. PAID 예약 일괄 환불(fan-out)은 별도 마일스톤.

```ts
// 취소 전이는 원자적 가드를 where에 포함 — count===0 이면 예약 존재로 거부
await db.departure.updateMany({
  where: { id, status: current.status, ...(requiresEmptySeats(to) ? { bookedSeats: 0 } : {}) },
  data: { status: to, version: { increment: 1 } },
});
```

**D2 — 가격 무결성은 스냅샷으로 이미 해결.** `Booking.totalPrice`는 예약 생성 시 departure 가격을 서버에서 **복사한 스냅샷**(참조 아님). 따라서 가격 수정은 항상 허용하되 예약 존재 시 경고 배너만 노출. 기존 예약은 구조적으로 면역.

**D3 — admin 가드는 Prisma `updateMany` 리터럴 CAS (raw 회피).** capacity 축소는 `bookedSeats <= newCapacity`(리터럴 비교)라 `updateMany` where 조건만으로 race-free. 소비자 쪽 `reserveSeats`는 `bookedSeats + N`(컬럼 표현식) 비교라 raw `$executeRaw`가 필요했던 것과 대비된다.

```ts
await db.departure.updateMany({
  where: { id, bookedSeats: { lte: data.capacity } }, // 리터럴 가드
  data: { ...fields, version: { increment: 1 } },
}); // count===0 → CapacityBelowBookedError
```

**상태머신**: `assertDepartureTransition`(booking SSOT 패턴 미러). `CLOSED → SCHEDULED` reopen 허용(D5), `CANCELED` terminal.

## Consequences (결과)

**얻은 것:**
- fat-finger 일괄취소 대참사 원천 차단 — 예약 있는 출발일은 개별 취소를 거쳐야만 취소 가능.
- 가격 수정이 기존 예약 금액을 절대 훼손하지 않음(스냅샷) — 차단 로직 없이 운영 유연성 확보.
- 초과예약 TOCTOU 양방향(소비자 reserveSeats / 생산자 capacity 축소) 모두 원자적 CAS로 봉쇄.
- admin 경로는 타입 안전한 `updateMany`로 raw SQL 0 — 유지보수성↑.

**포기한 것 / 미해결:**
- 출발 취소 시 PAID 예약 cascade 환불(별도 마일스톤, 💳 Domain Booking 주도, 부분 실패 복구 설계 필요).
- `bookedSeats >= minPax` 자동 CONFIRMED 전이(수동 유지, 후속 cron/trigger).
- 가격 변경 감사 로그 테이블(`updatedAt`/`version`로 대체).

## Alternatives Considered (대안)

### 옵션 A: 취소 시 cascade 환불 포함
- 출발 취소가 묶인 모든 PAID 예약에 `refundBooking` Saga를 fan-out.
- **거부**: 단건 기준 Saga를 N건에 펼치면 "30건 중 17건 성공, 13건 PG 타임아웃" 같은 부분 실패(partial failure) 복구를 새로 설계해야 함 — ADR 한 장으로 안 끝나는 별도 에픽. fat-finger 위험도 큼.

### 옵션 B: 취소 자체를 v1에서 제외
- CANCELED 전이를 아예 만들지 않음.
- **거부**: reopen만으론 "모객 실패로 무산된 출발"을 표현 못 함. 좌석 0일 때의 취소는 돈 경로와 무관해 안전하므로 포함하는 게 옳음.

### 옵션 C: admin capacity 가드도 raw SQL(`$executeRaw`)
- `reserveSeats`처럼 raw로 통일.
- **거부**: admin 가드는 `bookedSeats`를 **리터럴 입력값**과 비교하므로 Prisma `updateMany` where로 충분. raw는 컬럼 표현식(`bookedSeats + N`) 비교에만 필요. 불필요한 raw는 타입 안전·가독성을 해침.

### 옵션 D: 가격 수정 시 예약 있으면 차단
- 예약이 하나라도 있으면 가격 편집 금지.
- **거부**: `totalPrice`가 스냅샷이라 기존 예약은 어차피 영향 0. 차단은 과보호로 운영을 마비시킴. 경고 배너로 충분.

## Notes

- 새 force-dynamic 도메인이 아니라 기존 admin 도메인 확장이므로 ADR-0020/0025 캐시·CSP 정책 무손상.
- 캐시 무효화는 checkout과 동일 contract(`tagDeparturesByProduct` + `revalidatePath('/products/[id]')`) 재사용 — admin 라우트는 force-dynamic이라 무효화 불필요.
- 6개월 뒤 의심 가능 지점: "왜 출발 취소가 예약 있으면 막히나?" → cascade 환불 별도 에픽(D1). "왜 admin은 raw 안 쓰나?" → 리터럴 vs 컬럼식 구분(D3).
