# Phase 4-A — Departure CMS 설계 (Spec)

> 작성일: 2026-06-02 · brainstorming 세션(2026-06-02) 결정사항 박제.
> 선행: B3 Admin Product CMS(`done/2026-05-31-b3-admin-cms-roadmap.md`), ADR-0002/0003/0005(취소·환불), ADR-0008(listDepartureSeats), ADR-0020(캐시 태그 SSOT).
> ⚠️ 본 문서는 *설계*다. 구현 체크박스는 후속 plan(`writing-plans`)에서 생성한다.

---

## 1. Context — 왜 이 작업인가

- 예약·결제·환불 **흐름은 완성**됐으나, 그 입구인 **출발일(Departure) 데이터가 seed에만 의존**한다. 관리자가 출발일·가격·좌석을 생성·수정·마감하지 못하면 플랫폼을 실제로 운영할 수 없다 — **현재 가장 큰 운영 블로커**.
- B3에서 Departure CMS를 의도적으로 분리한 이유(좌석·결제·🛑 NO-REAL-MONEY 도메인 안전성)를 이번 마일스톤에서 정면으로 다룬다. 💳 Domain Booking 페르소나가 전 구간 강제 참여한다.

---

## 2. 확정된 아키텍처 뼈대 (brainstorming 결정사항)

| # | 결정 | 근거 / 거부된 대안 |
|---|---|---|
| D1 | **취소 cascade는 범위 외** — `CANCELED` 전이는 `bookedSeats === 0`일 때만 허용 | 단건 기준 `refundBooking` Saga를 N건에 fan-out하면 부분 실패 복구가 별도 에픽. fat-finger 일괄취소 대참사 방지. *거부: cascade 환불 포함 — 배보다 배꼽.* |
| D2 | **가격 수정 항상 허용 + 예약 존재 시 경고 배너** · 가격 이력 로그 v1 제외 | `Booking.totalPrice`가 생성 시점 **스냅샷**이라 기존 예약은 가격 변경에 구조적 면역. 차단은 과보호. 이력은 `updatedAt`+`version`이 1차 증거(전용 감사 로그는 YAGNI). |
| D3 | **capacity 축소 가드** — `bookedSeats` 바닥 아래로 축소 거부 (race-free) | 생산자 쪽 TOCTOU. `reserveSeats`(소비자) 대칭. |
| D4 | **CONFIRMED 수동 전이** — `bookedSeats >= minPax` 자동확정 v1 제외 | 자동 전이는 checkout 흐름에 트리거를 심어 booking 도메인을 침범. minPax 달성은 UI 표시만. |
| D5 | **Reopen 허용** — `CLOSED → SCHEDULED` v1 포함 | 단체 블록 취소·차량 증편 등으로 마감 일정 재판매가 빈번. `CLOSED`는 사이드 이펙트가 없어 안전하게 열어둠. |

---

## 3. 도메인 모델 — DepartureStatus 상태머신

`Departure.status`(enum `DepartureStatus { SCHEDULED CONFIRMED CLOSED CANCELED }`)는 현재 seed로만 세팅되고 전이 규칙이 없다. booking의 `assertTransition`(ALLOWED_TRANSITIONS 화이트리스트 SSOT)과 **동일 패턴**으로 신설한다.

```
SCHEDULED ─┬─> CONFIRMED ─┬─> CLOSED ──> SCHEDULED (reopen)
           ├─> CLOSED      └─> CANCELED*         └─> CANCELED*
           └─> CANCELED*
CONFIRMED ──> CLOSED | CANCELED*
CANCELED ──> (terminal)              * 가드: bookedSeats === 0
```

```ts
// entities/departure/model/transitions.ts (신규)
export const ALLOWED_DEPARTURE_TRANSITIONS: Record<DepartureStatus, DepartureStatus[]> = {
  SCHEDULED: ["CONFIRMED", "CLOSED", "CANCELED"],
  CONFIRMED: ["CLOSED", "CANCELED"],
  CLOSED:    ["SCHEDULED", "CANCELED"], // SCHEDULED = reopen (D5)
  CANCELED:  [],                        // terminal
};

export class InvalidDepartureTransitionError extends Error { /* from, to */ }
export function assertDepartureTransition(from, to): void { /* 화이트리스트 검사 */ }

// CANCELED 전이는 추가로 bookedSeats === 0 가드(D1)가 필요 — 이건 순수함수가
// 아니라 DB 상태 의존이므로 mutation 레이어에서 원자적으로 처리(§5.3).
export function requiresEmptySeats(to: DepartureStatus): boolean {
  return to === "CANCELED";
}
```

> **`reserveSeats`와의 정합성**: `reserveSeats`는 `status IN ('SCHEDULED','CONFIRMED')`인 출발만 좌석을 차감한다. 따라서 `CLOSED`/`CANCELED` 전이 즉시 **신규 예약이 자동 차단**되고 기존 예약은 무영향 — D1/D5 설계와 코드가 이미 정합.

---

## 4. 동시성 제어 — TOCTOU 방어 (핵심)

### 4.1 두 방향의 좌석 안전

| 방향 | 주체 | 위험 | 방어 |
|---|---|---|---|
| **소비** | 고객 예약 | 초과예약 | `reserveSeats` raw CAS (**기존**, `WHERE capacity >= bookedSeats + N`) |
| **생산** | admin capacity 축소 | 유령 초과예약 | **신규** CAS (`WHERE bookedSeats <= :newCapacity`) |

### 4.2 admin 가드는 raw SQL 불필요 — Prisma `updateMany` 리터럴 가드

`reserveSeats`가 raw `$executeRaw`를 쓴 이유는 **컬럼 표현식**(`bookedSeats + N`, N도 변수)을 비교했기 때문이다. admin 쪽 가드는 모두 `bookedSeats`를 **스칼라 리터럴 입력값**과 비교한다:
- capacity 축소: `bookedSeats <= :newCapacity` (newCapacity는 폼 입력 정수)
- 취소: `bookedSeats === 0` (리터럴 0)

따라서 Prisma `updateMany({ where: { id, bookedSeats: { lte: newCapacity } }, data })`로 **DB 단일 원자 연산** + `count === 0` 분기만으로 race-free하다. 타입 안전 + raw 회피 → admin 경로는 `updateMany` 채택.

> 단일 행에 대한 `updateMany`는 Postgres row-level lock으로 직렬화되므로, 고객의 `reserveSeats`(같은 행 UPDATE)와 admin의 capacity 축소가 동시에 일어나도 한쪽이 먼저 커밋되고 다른 쪽이 갱신된 값 위에서 가드를 재평가한다 — lost update 없음.

---

## 5. 데이터 흐름 (Approach 1 — RSC-우선 풀페이지 폼)

쓰기는 전부 Server Action 단일 경로. 읽기는 RSC. 상태 전이 버튼은 `<form action>` progressive enhancement(JS 없이 동작).

### 5.1 생성 — `createDepartureAction`
```
[admin form 제출]
  → auth() + role==="ADMIN" 가드 (3-layer 중 3차)
  → departureSchema.safeParse (Zod: 날짜 정합·minPax<=capacity·정수 가격)
  → entities/departure/api/mutations.createDeparture(tx, productId, data)
      · status = SCHEDULED (default), bookedSeats = 0
      · @@unique([productId, departureDate]) 충돌 → Prisma P2002 캐치 → 친절한 메시지
  → revalidateTag(tagDeparturesByProduct(productId)) + revalidatePath(`/products/${productId}`)
  → redirect(`/admin/products/${productId}/departures`)
```

### 5.2 수정 — `updateDepartureAction`
```
  → ADMIN 가드 + Zod
  → updateDeparture(departureId, data):
      db.departure.updateMany({
        where: { id: departureId, bookedSeats: { lte: data.capacity } },  // D3 CAS
        data: { ...prices, dates, minPax, capacity, version: { increment: 1 } },
      })
      · count === 0 → bookedSeats > capacity 이므로 CapacityBelowBookedError
        (단, 동시에 P2002 날짜 충돌 가능성도 분리 캐치)
  → 가격이 바뀌었고 bookedSeats > 0 이면: 응답에 warning 플래그 (UI 배너용, D2)
  → revalidate 동일
```
> status는 이 폼에서 바꾸지 않는다. 상태 전이는 §5.3 별도 액션(관심사 분리 + 가드 차이).

### 5.3 상태 전이 — `transitionDepartureAction`
```
  → ADMIN 가드
  → 현재 status 조회(read) → assertDepartureTransition(from, to)  // 친절한 InvalidTransition 에러
  → 원자적 조건부 UPDATE (TOCTOU + 낙관적 동시전이 방어):
      db.departure.updateMany({
        where: {
          id, status: from,                       // 동시 이중전이 방어(낙관적)
          ...(to === "CANCELED" ? { bookedSeats: 0 } : {}),  // D1 가드
        },
        data: { status: to, version: { increment: 1 } },
      })
      · count === 0 → (a) 그새 status 바뀜 or (b) 취소인데 예약 발생
        → 재조회로 사유 분기: bookedSeats>0 이면 "예약 N건 존재로 취소 불가",
          아니면 "상태가 변경되었습니다. 새로고침 후 재시도"
  → revalidate 동일 (+ CLOSED/CANCELED는 신규 예약 자동 차단되므로 PDP 좌석표 갱신 중요)
```

---

## 6. 에러 처리

| 상황 | 처리 | 사용자 메시지 |
|---|---|---|
| 비-ADMIN 접근 | middleware(1차)+layout(2차)+action(3차) | redirect / "관리자 권한 필요" |
| Zod 실패 | `fieldErrors` 반환 → 폼 필드별 표시 | 필드별 |
| 날짜 충돌(P2002) | Prisma 에러코드 캐치 | "해당 날짜에 이미 출발일이 있습니다" |
| capacity < bookedSeats | `updateMany` count===0 | "현재 N석 예약됨 · 그 이하로 축소 불가" |
| 취소인데 예약 존재(D1) | 전이 count===0 + 재조회 | "예약 N건 존재 — 개별 취소 후 출발 취소 가능" |
| 불가능한 전이 | `assertDepartureTransition` throw | "이 상태에서는 불가능한 전이입니다" |
| **가격 수정 경고(D2)** | 차단 아님 — 정보성 배너 | "기존 N건 예약은 잠긴 가격 유지 · 신규 예약부터 새 가격" |

**경고 배너 vs 에러의 구분**: 경고(D2)는 저장을 **막지 않는다**(노란 배너, 진행 가능). 에러(capacity/취소/충돌)는 저장을 **막는다**(빨간 메시지, 트랜잭션 미실행).

---

## 7. UI 범위 & 라우팅

departure ⊂ product 위계 → 상품 하위 중첩 라우트. 전부 RSC + `force-dynamic`(ADR-0020 admin 안전 도메인).

```
/admin/products/[id]/departures               목록 (RSC) — 출발/귀국·가격3·bookedSeats/capacity·minPax·status배지·행액션
/admin/products/[id]/departures/new           생성 폼 (useActionState 클라 아일랜드)
/admin/products/[id]/departures/[depId]/edit   편집 폼 + 상태 전이 버튼 그룹
```

- **상태 전이 버튼**: 상태머신 화이트리스트로 **노출 게이트**(booking `isCancelableByUser` 패턴). 취소 버튼은 `bookedSeats > 0`이면 `disabled` + 사유 툴팁.
- **minPax 달성 표시**: `bookedSeats >= minPax` 이면 "확정 가능" 배지(자동확정 아님, 판단 보조 — D4).
- `/admin/products/[id]/edit` 또는 목록에 "출발일 관리" 링크 추가.

---

## 8. FSD 레이어 배치

| 레이어 | 파일 | 책임 | 신규/수정 |
|---|---|---|---|
| entities | `departure/model/transitions.ts` | 상태머신 SSOT (`assertDepartureTransition`) | 신규 |
| entities | `departure/api/mutations.ts` | `createDeparture`/`updateDeparture`(CAS)/`transitionDepartureStatus`(가드) | 신규 |
| entities | `departure/model/schema.ts` | 기존 `departureSchema` 재사용(수정 최소) | 기존 |
| entities | `departure/index.ts` | barrel — mutations·transitions 공개 | 수정 |
| features | `admin-departure/server/actions.ts` | create/update/transition Server Actions (ADMIN 가드+Zod+revalidate) | 신규 |
| features | `admin-departure/ui/DepartureForm.tsx` | `useActionState` 폼 + 경고 배너 | 신규 |
| features | `admin-departure/ui/StatusTransitionButtons.tsx` | `<form action>` 전이 버튼 그룹 | 신규 |
| features | `admin-departure/index.ts` | barrel | 신규 |
| app | `(admin)/admin/products/[id]/departures/{page,new/page,[depId]/edit/page}.tsx` | RSC 라우트 | 신규 |
| entities | `product` 또는 admin product 페이지 | "출발일 관리" 링크 | 수정 |

> 좌석/가격/상태 가드는 **전부 entities/features 서버 레이어**에 위치. 클라이언트는 표시만. (Approach 1 핵심.)

---

## 9. 테스트 전략 (TDD — 💳 Domain Booking + ⚙️ Backend + 🔬 QA)

| 대상 | 종류 | 핵심 케이스 |
|---|---|---|
| `transitions.ts` | 순수함수 단위(TDD 우선) | 모든 합법/불법 전이쌍, terminal(CANCELED) 출구 0, reopen 합법성, `requiresEmptySeats` |
| `mutations.ts` | 통합(가드) | capacity 축소 `count===0` 거부 / 증가 통과 / 취소 `bookedSeats=0` 가드 / 낙관적 status 가드 / P2002 분리 |
| `actions.ts` | 서버액션 spy | ADMIN 아닌 자 forbidden / Zod fieldErrors / revalidateTag·Path 호출(spy) / 가격경고 플래그 / dispatch |
| 런타임 QA | 🔬 evidence | (a) 좌석 가득 → capacity 축소 거부 raw DB 인용 (b) 예약 존재 출발 취소 거부 (c) 개별취소 후 bookedSeats=0 → 취소 성공 (d) CLOSED 후 reserveSeats 신규예약 차단 (e) reopen 후 재판매 가능 |

**동시성 회귀 테스트(권장)**: capacity 축소와 `reserveSeats`를 인접 실행해 lost update 부재 확인 — 또는 `updateMany` count 기반 가드의 결정성으로 단위 검증 대체.

---

## 10. 캐시 무효화 (ADR-0020 SSOT 준수)

모든 departure 쓰기(생성·수정·전이) 후:
- `revalidateTag(tagDeparturesByProduct(productId))` — PDP 좌석표(`getDeparturesByProduct` unstable_cache)
- `revalidatePath('/products/${productId}')` — PDP ISR 엔트리

checkout 좌석 차감과 **동일 contract** 재사용 — 신규 태그 도입 없음.

---

## 11. Out of Scope (명시적 제외)

- 출발 취소 시 PAID 예약 **cascade 환불** (D1 — 별도 마일스톤, 💳 Domain Booking 주도)
- `bookedSeats >= minPax` **자동 CONFIRMED** 전이 (D4 — 후속 cron/trigger)
- 가격 변경 **감사 로그 테이블** (D2 — `updatedAt`/`version`로 대체)
- 다중 출발일 **일괄(bulk) 생성·편집** UI
- departure 단위 **좌석 hold TTL**(현재 checkout 즉시 확정 모델이라 불필요)

---

## 12. ADR 후보

- **출발 취소 cascade 범위 제외 + `bookedSeats===0` 취소 가드** (D1) — 여러 대안(cascade 포함 / 취소 자체 제외) 검토 후 채택. ADR 발행 가치 있음(사용자 승인 시).
- **admin 가드 = `updateMany` 리터럴 CAS (raw 회피)** vs `reserveSeats` raw — 컬럼식/리터럴 구분 근거. ADR 또는 본 spec §4.2로 충분할 수 있음.

> CLAUDE.md §6.1: 사용자 명시 요청 전 ADR 임의 발행 금지. 후보로만 기록.

---

## 13. 인수인계 — 다음 작업자가 헷갈릴 지점

- **"왜 admin은 raw SQL 안 쓰고 booking은 raw 썼나?"** → §4.2. 컬럼 표현식(`bookedSeats + N`) 비교는 raw 필요, 리터럴 비교는 `updateMany`로 충분.
- **"왜 가격 수정이 기존 예약을 안 망가뜨리나?"** → `Booking.totalPrice`는 생성 시 스냅샷(checkout actions Step 3). 참조 아님 → 구조적 면역(D2).
- **"왜 출발 취소가 예약 있으면 막히나?"** → cascade 환불은 별도 에픽(D1). 관리자는 `/admin/bookings`에서 개별 취소 후 `bookedSeats=0`이 되어야 출발 취소 가능.
- **"CLOSED와 CANCELED 차이?"** → 둘 다 `reserveSeats` 가드(`status IN SCHEDULED,CONFIRMED`)로 신규 예약 차단. 차이: CLOSED는 reopen 가능(D5, 일시 마감), CANCELED는 terminal(출발 무산).
- **"status를 왜 편집 폼이 아니라 별도 액션으로?"** → 전이는 상태머신+좌석 가드가 다르고 관심사가 분리됨. 폼은 속성, 전이는 생명주기.
