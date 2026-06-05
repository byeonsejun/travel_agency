export interface DashboardFilter {
  /** 집계 하한(포함), UTC 일 경계 00:00:00.000Z. */
  from: Date;
  /** 집계 상한(미포함), endDay + 1일의 UTC 00:00. */
  to: Date;
  /** 추이 버킷. span ≤ 92일 = day, 초과 = month. */
  bucket: "day" | "month";
  /** null = 전체 상품. */
  productId: string | null;
  /** unstable_cache 키 파트 (직렬화 가능 string). */
  cacheKey: {
    startDay: string; // "YYYY-MM-DD"
    endDay: string; // "YYYY-MM-DD"
    product: string; // productId | "all"
  };
}

export interface ProductOption {
  id: string;
  title: string;
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
