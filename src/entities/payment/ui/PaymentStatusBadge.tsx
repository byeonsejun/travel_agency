import type { PaymentStatus } from "@prisma/client";

const STATUS_STYLE: Record<PaymentStatus, string> = {
  PENDING: "bg-yellow-100 text-yellow-800",
  PAID: "bg-emerald-100 text-emerald-800",
  CANCELED: "bg-gray-100 text-gray-700",
  FAILED: "bg-red-100 text-red-700",
};

// 사용자 관점 라벨 — Prisma enum의 1:1 번역이 아닌, 환불 의미를 명시.
// CANCELED는 도메인 모델에서는 "취소"이지만 사용자에게는 "환불 완료" 의미.
const STATUS_LABEL: Record<PaymentStatus, string> = {
  PENDING: "결제 대기",
  PAID: "결제 완료",
  CANCELED: "환불 완료",
  FAILED: "결제 실패",
};

type Props = { status: PaymentStatus };

export function PaymentStatusBadge({ status }: Props) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export { STATUS_LABEL as PAYMENT_STATUS_LABEL };
