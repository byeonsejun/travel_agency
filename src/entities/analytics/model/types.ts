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
