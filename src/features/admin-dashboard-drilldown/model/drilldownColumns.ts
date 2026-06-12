// 드릴다운 테이블/CSV 컬럼 정의 — 프레젠테이션 메타데이터(헤더 라벨 + 접근자 함수).
// [ADR-0053] 원래 `entities/analytics/model/columns.ts`에 있었으나, 접근자 함수(non-serializable)라
// props로 client에 전달 불가 + 'use cache'를 품은 analytics 배럴을 client가 import하면 서버 그래프가
// 누출된다. 소비처가 이 feature의 client island(DrilldownSheet)뿐이고 본질이 "표현"이므로
// FSD상 feature로 이관(entity는 순수 도메인 데이터/타입만 유지). row 타입은 type-only로 erase.
import type { CsvColumn } from "@/shared/lib/csv/toCsv";
import type {
  DrilldownMetric,
  DrilldownRowMap,
  RevenueRow,
  PenaltyRow,
  CancellationRow,
  OccupancyRow,
} from "@/entities/analytics";

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
