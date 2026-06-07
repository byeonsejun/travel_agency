/** 템플릿은 도메인 객체가 아닌 평문 props만 받는다 (도메인 무지·독립 테스트). */

export interface BookingConfirmationEmailProps {
  customerName: string;
  bookingId: string;
  productTitle: string;
  departureDate: string; // "2026-08-15"
  travelerCount: number;
  totalPrice: number; // 원
  receiptUrl: string | null;
}

export interface RefundCompletedEmailProps {
  customerName: string;
  bookingId: string;
  productTitle: string;
  refundAmount: number; // 원 (위약금 차감 후 실제 환불액)
  penaltyAmount: number; // 위약금 (0이면 템플릿에서 라인 숨김)
  paymentMethod: string; // "카드"
}

export interface PartialRefundCompletedEmailProps {
  customerName: string;
  bookingId: string;
  productTitle: string;
  originalAmount: number; // 원결제 금액 (payment.amount, 원)
  penaltyAmount: number; // 공제된 위약금 (원, 0이면 라인 숨김)
  refundAmount: number; // 최종 환불 금액 (원)
  paymentMethod: string; // "카드"
}
