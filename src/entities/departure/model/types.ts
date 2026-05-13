import type { Departure, DepartureStatus } from "@prisma/client";

export type { DepartureStatus };

// 잔여석 계산이 포함된 출발일
export type DepartureWithAvailability = Departure & {
  availableSeats: number;   // capacity - bookedSeats
  isSoldOut: boolean;
  isAlmostFull: boolean;    // availableSeats <= 5
};

// 출발일 달력 UI용 — 최소 필드만
export type DepartureCalendarItem = Pick<
  Departure,
  "id" | "departureDate" | "returnDate" | "priceAdult" | "priceChild" | "priceInfant" | "status"
> & {
  availableSeats: number;
};
