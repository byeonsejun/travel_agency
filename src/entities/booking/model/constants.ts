import type { BookingStatus, PaymentMethod } from "@prisma/client";

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  RECEIVED: "예약 접수",
  AWAITING_GROUP: "출발 대기",
  DEPARTURE_CONFIRMED: "출발 확정",
  PAID: "결제 완료",
  READY: "여행 준비",
  COMPLETED: "여행 완료",
  CANCELED_BY_USER: "고객 취소",
  CANCELED_BY_AGENCY: "여행사 취소",
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  CARD: "신용카드",
  VIRTUAL_ACCOUNT: "가상계좌",
  TRANSFER: "계좌이체",
};

// 마이페이지 Progress Bar 단계 순서 (취소 상태 제외)
export const BOOKING_PROGRESS_STEPS = [
  "RECEIVED",
  "AWAITING_GROUP",
  "DEPARTURE_CONFIRMED",
  "PAID",
  "READY",
  "COMPLETED",
] as const;

export type BookingProgressStep = (typeof BOOKING_PROGRESS_STEPS)[number];

// 약관 키 상수
export const TERM_KEYS = {
  STANDARD_OVERSEAS: "standard_overseas_v1",
  SPECIAL_CANCELLATION: "special_cancellation_v1",
} as const;

// 사용자 자가 취소 사유 프리셋
export const CANCEL_REASON_PRESETS = [
  "일정 변경으로 인한 취소",
  "개인 사정으로 인한 취소",
  "건강상의 이유로 인한 취소",
  "다른 여행 상품으로 변경",
  "기타 사유",
] as const;
