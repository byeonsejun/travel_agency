# ADR-0057: 예약 접근통제 = 소유권 인가(WHERE userId), ID 비밀성 아님

- **상태**: Accepted
- **결정일**: 2026-06-14
- **영향 범위**: `src/entities/booking/api/queries.ts`, `src/widgets/booking-list/ui/BookingHistoryList.tsx`
- **관련 commit**: `0304e5a` (mypage RSC + listMyBookings 확장, 잘린 ID 표시 도입), 인접 [ADR-0010]

## Context (배경)

마이페이지 예약 카드에 CUID 뒤 8자리(예: `orl83p21`)가 "예약 ID"로 노출된다. 이 잘린 값이 *조회 키*로 쓰인다면(라우트/쿼리가 suffix로 예약을 찾는다면), 짧은 식별자의 추측·열거가 보안 경계가 되어 위험하다. 그래서 "잘린 ID가 인가 메커니즘인가, 표시 라벨인가"를 코드로 확정하고, 실제 인가가 어디서 강제되는지를 박제한다.

## Decision (결정)

**접근통제는 잘린 ID의 비밀성이 아니라 쿼리 WHERE 절의 `userId` 소유권 스코프가 강제한다.** 잘린 ID는 순수 표시용 라벨이고, 라우트/조회는 전체 CUID + 소유자 스코프로 동작한다.

코드 근거:

```ts
// src/entities/booking/api/queries.ts — 고객 조회는 전부 userId 스코프
:9   getBookingById       where: { id, userId }
:38  listMyBookings       where: { userId }
:72  getBookingForRetry   where: { id, userId }
:86  getBookingDetail     where: { id, userId }
// 대비: admin 은 userId 스코프를 빼고 역할 게이트에 의존
:154 getAdminBookingDetail where: { id }
```

```tsx
// src/widgets/booking-list/ui/BookingHistoryList.tsx
:72  예약 ID {booking.id.slice(-8)}              // 표시용 라벨
:61  href={`/bookings/${booking.id}`}            // 상세 = 전체 CUID
:110 href={`/reviews/new?bookingId=${booking.id}`} // 후기 = 전체 CUID
```

→ 잘린 suffix를 조회 키로 쓰는 곳은 0건. 타인 예약 접근은 "ID를 못 맞혀서"가 아니라 "`userId` 스코프가 행을 안 돌려줘서(null→notFound)" 막힌다.

## Consequences (결과)

**얻은 것:**
- 보안 모델이 명확해짐: 인가 = 소유권(서버 WHERE), 식별자 = 표시. 잘린 ID를 "비밀"로 오해해 보안을 거기에 의존하는 회귀를 방지.
- 잘린 ID는 자유롭게 표시·로깅 가능(보안 자산 아님) — UX/디버깅에 활용 여지.
- admin 경로는 의도적으로 `userId` 스코프를 빼고 역할 게이트로 분리([ADR-0010]의 취소 권한 SSOT와 정합).

**포기한 것 / 미해결:**
- 전체 CUID가 URL(`/bookings/{cuid}`)에 노출됨. 이는 보안 문제가 아니나(소유권 스코프가 방어), 사람이 외우기 어려운 식별자라 고객 응대용 "예약번호" UX는 별도 과제로 남음(아래 옵션 B).

## Alternatives Considered (대안 — 가장 중요한 섹션)

### 옵션 A: 잘린/난독화한 ID를 비밀 토큰처럼 취급(security by obscurity)
- 짧은/난독 식별자를 알아야만 예약에 접근하게 만들고, 그 비밀성에 인가를 의존.
- **거부.** 잘못된 보안 모델이다. 짧은 식별자는 추측·열거에 취약하고, 공유/로그/스크린샷으로 새면 그대로 접근권이 된다. 인가는 "누가 요청했나(`userId`)"로 판단해야지 "식별자를 아느냐"로 판단하면 안 된다. 현행은 이미 `userId` 스코프로 올바르게 막고 있으므로 ID 비밀성은 불필요하고 해롭다.

### 옵션 B: 사람이 읽기 쉬운 불투명 공개 예약번호 도입
- 내부 CUID와 분리된 짧은 공개 예약번호(예: `NT-2406-XXXX`)를 발급해 고객 응대·표시에 사용.
- **백로그(거부 아님).** 이건 보안 결정이 아니라 *제품/UX 폴리시*다. 현재 잘린 CUID 표시로 충분하고, 별도 번호 체계는 발급·유일성·매핑 비용이 든다. 고객센터/영수증 UX가 필요해지면 검토 — 그때도 인가는 여전히 `userId` 스코프가 담당(공개번호는 표시·검색 편의일 뿐).

## Notes

- 새 예약 조회 경로를 추가할 때 반드시 `userId`(또는 admin 역할 게이트)를 WHERE에 넣을 것 — 이게 인가의 단일 지점.
- 잘린 ID는 보안 자산이 아니므로 절대 "비밀"로 다루지 말 것(로그/표시 자유).
- admin 경로(`getAdminBookingDetail` where `{ id }`)는 페이지 레벨 역할 게이트가 인가를 책임진다 — 그 게이트가 빠지면 IDOR이 되므로 admin 라우트 가드와 한 쌍으로 본다.
