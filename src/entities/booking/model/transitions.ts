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
