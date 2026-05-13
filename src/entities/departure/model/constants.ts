import type { DepartureStatus } from "@prisma/client";

export const DEPARTURE_STATUS_LABEL: Record<DepartureStatus, string> = {
  SCHEDULED: "모객 중",
  CONFIRMED: "출발 확정",
  CLOSED: "마감",
  CANCELED: "출발 취소",
};

// 달력 UI에서 마감 임박 기준 잔여석 수
export const ALMOST_FULL_THRESHOLD = 5;
