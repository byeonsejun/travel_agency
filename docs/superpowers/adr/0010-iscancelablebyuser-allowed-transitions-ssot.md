# ADR-0010: `isCancelableByUser` — `ALLOWED_TRANSITIONS` 단일 진실 원천

- **상태**: Accepted
- **결정일**: 2026-05-20
- **영향 범위**: `src/entities/booking/model/transitions.ts`, `src/widgets/booking-detail/`
- **관련 commit**: `feat(booking): isCancelableByUser derived from ALLOWED_TRANSITIONS`

## Context (배경)

예약 상세 페이지에서 "취소하기" 버튼을 노출할지 판별하는 `isCancelableByUser(status)` 함수가 필요했다. 가장 직관적인 구현은 취소 가능 상태 목록을 별도 상수나 switch문으로 정의하는 것이다.

그런데 `ALLOWED_TRANSITIONS`에는 이미 각 상태에서 전이 가능한 목표 상태들이 정의되어 있다. 별도 상수를 두면 **두 곳에서 도메인 룰을 관리**하게 되고, 나중에 취소 가능 상태가 바뀔 때 `ALLOWED_TRANSITIONS`만 수정하고 UI 상수를 잊는 불일치 버그 위험이 생긴다.

## Decision (결정)

`isCancelableByUser`를 `ALLOWED_TRANSITIONS`를 파생 계산으로 구현한다:

```ts
// src/entities/booking/model/transitions.ts
export function isCancelableByUser(status: BookingStatus): boolean {
  return ALLOWED_TRANSITIONS[status].includes("CANCELED_BY_USER");
}
```

이 방식으로 `ALLOWED_TRANSITIONS`가 단일 진실 원천(SSOT)이 되고, 도메인 룰이 바뀌면 `ALLOWED_TRANSITIONS` 한 곳만 수정하면 UI가 자동으로 동기화된다.

## Consequences (결과)

**얻은 것:**
- 도메인 룰 변경 시 `ALLOWED_TRANSITIONS` 1곳만 수정 → UI 자동 반영.
- `CancelableBookingStatus` 같은 별도 타입 리터럴이 필요 없음 — 코드 중복 제거.
- 로직이 단 한 줄이라 테스트가 `assertTransition` 테스트와 공유됨.

**포기한 것 / 미해결:**
- 간접 참조라 "어떤 상태에서 취소 가능한가?" 를 한눈에 파악하려면 `ALLOWED_TRANSITIONS`를 열어봐야 함.
- `ALLOWED_TRANSITIONS`가 취소 가능성 이외의 다른 관심사에도 사용된다면 결합도 증가.

## Alternatives Considered (대안)

### 옵션 A: 별도 `CANCELABLE_STATES` 상수 정의
```ts
const CANCELABLE_STATES: BookingStatus[] = ["RECEIVED", "AWAITING_GROUP", ...];
export function isCancelableByUser(status: BookingStatus): boolean {
  return CANCELABLE_STATES.includes(status);
}
```
- 직관적이지만, `ALLOWED_TRANSITIONS` 변경 시 `CANCELABLE_STATES`도 수동 동기화 필요.
- 불일치 버그의 온상이 될 수 있음 → 거부.

### 옵션 B: `switch` / `if-else` 분기
- 옵션 A와 동일한 문제에 더 많은 코드 → 거부.

### 옵션 C: `CancelableBookingStatus` 유니온 타입 별도 선언 + `satisfies` 제약
- 타입 안전성은 높지만 런타임 로직은 여전히 별도 상수 필요 — 중복 해소 안 됨 → 거부.

## Notes

- `shouldReturnSeats` 함수도 동일 원칙으로 `SEAT_HELD_STATES` / `CANCEL_STATES` 상수를 지역 선언해 사용 중.
- 좌석 반환 로직도 나중에 `ALLOWED_TRANSITIONS`에서 파생할 수 있으나, 현재 직관성 우선으로 지역 상수 유지.
