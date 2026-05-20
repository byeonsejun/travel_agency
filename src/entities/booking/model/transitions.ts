import type { BookingStatus } from "@prisma/client";

export const ALLOWED_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  RECEIVED: [
    "AWAITING_GROUP",
    "DEPARTURE_CONFIRMED",
    "CANCELED_BY_USER",
    "CANCELED_BY_AGENCY",
  ],
  AWAITING_GROUP: [
    "DEPARTURE_CONFIRMED",
    "CANCELED_BY_USER",
    "CANCELED_BY_AGENCY",
  ],
  DEPARTURE_CONFIRMED: ["PAID", "CANCELED_BY_USER", "CANCELED_BY_AGENCY"],
  PAID: ["READY", "CANCELED_BY_USER", "CANCELED_BY_AGENCY"],
  READY: ["COMPLETED", "CANCELED_BY_USER", "CANCELED_BY_AGENCY"],
  COMPLETED: [],
  CANCELED_BY_USER: [],
  CANCELED_BY_AGENCY: [],
};

export class InvalidTransitionError extends Error {
  constructor(from: BookingStatus, to: BookingStatus) {
    super(`Invalid booking transition: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function assertTransition(from: BookingStatus, to: BookingStatus): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new InvalidTransitionError(from, to);
  }
}

const CANCEL_STATES: BookingStatus[] = ["CANCELED_BY_USER", "CANCELED_BY_AGENCY"];
const SEAT_HELD_STATES: BookingStatus[] = [
  "RECEIVED",
  "AWAITING_GROUP",
  "DEPARTURE_CONFIRMED",
  "PAID",
  "READY",
];

export function shouldReturnSeats(from: BookingStatus, to: BookingStatus): boolean {
  return SEAT_HELD_STATES.includes(from) && CANCEL_STATES.includes(to);
}

/**
 * 사용자 자가 취소가 가능한 상태인가? — UI 노출 게이트.
 * ALLOWED_TRANSITIONS의 화이트리스트를 단일 진실 원천으로 사용해 추후
 * 도메인 룰 변경 시 UI가 자동 동기화되게 한다 (CancelableBookingStatus
 * 리터럴 타입을 따로 들지 않는 이유).
 */
export function isCancelableByUser(status: BookingStatus): boolean {
  return ALLOWED_TRANSITIONS[status].includes("CANCELED_BY_USER");
}
