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

// 체크아웃 페이지에서 필요한 가격·날짜·잔여석 정보
export type DepartureCheckoutInfo = Pick<
  Departure,
  | "id"
  | "departureDate"
  | "returnDate"
  | "priceAdult"
  | "priceChild"
  | "priceInfant"
  | "status"
> & {
  remainingSeats: number;
};

// 상품 카드·목록·PDP 추천 등에서 사용하는 출발일 요약
export type DepartureSummary = Pick<
  Departure,
  "id" | "departureDate" | "returnDate" | "priceAdult" | "priceChild" | "capacity" | "bookedSeats" | "minPax" | "status"
> & {
  remainingSeats: number;
};

// 폴링용 lightweight payload — 동적으로 변하는 필드만(좌석/상태).
// PDP를 열어둔 클라이언트가 15-20초 주기로 fetch해 매진 race 직전을 감지.
export type DepartureLiveSeat = {
  id: string;
  status: DepartureStatus;
  remainingSeats: number;
  capacity: number;
};
