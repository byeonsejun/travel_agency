import type { PaymentMethod, PaymentStatus } from "@prisma/client";

/** 공개 API 응답에 노출되는 결제 안전 뷰 (민감 필드 제외). */
export interface PaymentSafe {
  id: string;
  bookingId: string;
  method: PaymentMethod;
  /** 원 단위 정수. */
  amount: number;
  status: PaymentStatus;
  tossOrderId: string;
  receiptUrl: string | null;
  paidAt: Date | null;
  canceledAt: Date | null;
  createdAt: Date;
}

/** 관리자·내부 서비스용 전체 결제 뷰 (실패 코드·메시지 포함). */
export interface PaymentDetail extends PaymentSafe {
  tossPaymentKey: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  updatedAt: Date;
}
