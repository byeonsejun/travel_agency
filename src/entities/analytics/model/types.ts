export type RangeKey = "today" | "7d" | "30d" | "90d" | "all";

export interface DateRange {
  /** 집계 하한(포함). all 이면 epoch(1970-01-01). */
  from: Date;
  /** 집계 상한(미포함) = 지금. */
  to: Date;
  key: RangeKey;
  /** 추이 차트 버킷 단위. all=월별, 그 외 일별. */
  bucket: "day" | "month";
}

export interface RevenueSummary {
  paid: number; // Σ 결제액(원)
  refunded: number; // Σ 실환불액(원)
  net: number; // paid − refunded
}

export interface CancellationStats {
  total: number; // range 내 생성 booking
  canceled: number; // 그 중 취소
  rate: number; // canceled / total (0~1), total=0 이면 0
}

export interface SeatOccupancy {
  booked: number;
  capacity: number;
  rate: number; // booked / capacity (0~1), capacity=0 이면 0
}

export interface RevenueTrendPoint {
  /** ISO 날짜 문자열 (버킷 라벨). */
  date: string;
  paid: number;
  refunded: number;
}

export interface StatusSlice {
  status: string; // 그룹 라벨 (예: "PAID/READY")
  count: number;
}

export interface DashboardData {
  revenue: RevenueSummary;
  penaltyRevenue: number;
  cancellation: CancellationStats;
  occupancy: SeatOccupancy;
  trend: RevenueTrendPoint[];
  statusDistribution: StatusSlice[];
}

// ─── Phase 9: 드릴다운 ───────────────────────────────────────────
export type DrilldownMetric = "revenue" | "penalty" | "cancellation" | "occupancy";

export interface RevenueRow {
  paidAt: string;        // YYYY-MM-DD
  orderId: string;
  productTitle: string;
  customer: string;
  amount: number;        // 결제액(원)
  refundedAmount: number;
  status: string;
}
export interface PenaltyRow {
  processedAt: string;   // RefundJob.updatedAt
  productTitle: string;
  customer: string;
  kind: string;          // FULL_CANCEL | TRAVELER_CANCEL | DISCRETIONARY
  baseAmount: number;
  penaltyAmount: number;
  refundedAmount: number; // RefundJob.amount(실환불액)
}
export interface CancellationRow {
  createdAt: string;
  canceledAt: string;    // 없으면 ""
  productTitle: string;
  customer: string;
  status: string;        // CANCELED_BY_USER | CANCELED_BY_AGENCY
  cancelReason: string;  // 없으면 ""
  totalPrice: number;
}
export interface OccupancyRow {
  departureDate: string;
  productTitle: string;
  capacity: number;
  bookedSeats: number;
  occupancyPct: number;  // 0~100 정수
  status: string;        // DepartureStatus
}

/** 메트릭별 row 타입 매핑. */
export interface DrilldownRowMap {
  revenue: RevenueRow;
  penalty: PenaltyRow;
  cancellation: CancellationRow;
  occupancy: OccupancyRow;
}

export interface DrilldownResult<T> {
  rows: T[];
  total: number;     // WHERE 매칭 전체 건수(cap 무시)
  capped: boolean;   // total > 5000
}

/** Server Action 반환 — metric 으로 태깅된 판별 유니온(any 회피). */
export type DrilldownData = {
  [M in DrilldownMetric]: { metric: M; result: DrilldownResult<DrilldownRowMap[M]> };
}[DrilldownMetric];
