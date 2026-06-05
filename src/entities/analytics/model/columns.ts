import type { CsvColumn } from "@/shared/lib/csv/toCsv";
import type {
  DrilldownMetric,
  DrilldownRowMap,
  RevenueRow,
  PenaltyRow,
  CancellationRow,
  OccupancyRow,
} from "./types";

const revenue: CsvColumn<RevenueRow>[] = [
  { header: "결제일", value: (r) => r.paidAt },
  { header: "주문ID", value: (r) => r.orderId },
  { header: "상품", value: (r) => r.productTitle },
  { header: "고객", value: (r) => r.customer },
  { header: "결제액", value: (r) => r.amount },
  { header: "환불액", value: (r) => r.refundedAmount },
  { header: "상태", value: (r) => r.status },
];
const penalty: CsvColumn<PenaltyRow>[] = [
  { header: "처리일", value: (r) => r.processedAt },
  { header: "상품", value: (r) => r.productTitle },
  { header: "고객", value: (r) => r.customer },
  { header: "유형", value: (r) => r.kind },
  { header: "기준액", value: (r) => r.baseAmount },
  { header: "위약금", value: (r) => r.penaltyAmount },
  { header: "실환불액", value: (r) => r.refundedAmount },
];
const cancellation: CsvColumn<CancellationRow>[] = [
  { header: "예약일", value: (r) => r.createdAt },
  { header: "취소일", value: (r) => r.canceledAt },
  { header: "상품", value: (r) => r.productTitle },
  { header: "고객", value: (r) => r.customer },
  { header: "상태", value: (r) => r.status },
  { header: "사유", value: (r) => r.cancelReason },
  { header: "예약금액", value: (r) => r.totalPrice },
];
const occupancy: CsvColumn<OccupancyRow>[] = [
  { header: "출발일", value: (r) => r.departureDate },
  { header: "상품", value: (r) => r.productTitle },
  { header: "정원", value: (r) => r.capacity },
  { header: "예약좌석", value: (r) => r.bookedSeats },
  { header: "점유율(%)", value: (r) => r.occupancyPct },
  { header: "상태", value: (r) => r.status },
];

/** 메트릭 → 컬럼 정의(테이블/CSV 공유 SSOT). */
export const DRILLDOWN_COLUMNS: {
  [M in DrilldownMetric]: CsvColumn<DrilldownRowMap[M]>[];
} = { revenue, penalty, cancellation, occupancy };

/** 메트릭 → 패널 제목 라벨. */
export const DRILLDOWN_LABEL: Record<DrilldownMetric, string> = {
  revenue: "결제 내역",
  penalty: "위약금/환불 내역",
  cancellation: "취소 예약",
  occupancy: "출발 좌석 현황",
};
