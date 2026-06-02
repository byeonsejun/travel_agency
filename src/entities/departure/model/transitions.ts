import type { DepartureStatus } from "@prisma/client";

// booking ALLOWED_TRANSITIONS와 동일한 화이트리스트 SSOT 패턴.
// CANCELED는 terminal. CLOSED→SCHEDULED는 reopen(D5).
export const ALLOWED_DEPARTURE_TRANSITIONS: Record<
  DepartureStatus,
  DepartureStatus[]
> = {
  SCHEDULED: ["CONFIRMED", "CLOSED", "CANCELED"],
  CONFIRMED: ["CLOSED", "CANCELED"],
  CLOSED: ["SCHEDULED", "CANCELED"],
  CANCELED: [],
};

export class InvalidDepartureTransitionError extends Error {
  constructor(
    public readonly from: DepartureStatus,
    public readonly to: DepartureStatus,
  ) {
    super(`Invalid departure transition: ${from} → ${to}`);
    this.name = "InvalidDepartureTransitionError";
  }
}

export function assertDepartureTransition(
  from: DepartureStatus,
  to: DepartureStatus,
): void {
  if (!ALLOWED_DEPARTURE_TRANSITIONS[from].includes(to)) {
    throw new InvalidDepartureTransitionError(from, to);
  }
}

// CANCELED 전이만 추가로 bookedSeats === 0 가드 필요(D1) — DB 상태 의존이라
// 순수함수가 아닌 mutation 레이어에서 원자적으로 처리. 여기서는 "요구 여부"만 판단.
export function requiresEmptySeats(to: DepartureStatus): boolean {
  return to === "CANCELED";
}

// UI 전이 버튼 노출 게이트용 — 현재 status에서 갈 수 있는 다음 status 목록.
export function allowedNextStatuses(from: DepartureStatus): DepartureStatus[] {
  return ALLOWED_DEPARTURE_TRANSITIONS[from];
}
