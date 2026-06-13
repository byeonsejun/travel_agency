export { parseFilter } from "./model/filter";
export type { DashboardFilterInput } from "./model/filter";
export { presetRange, PRESETS } from "./model/presets";
export type { PresetKey, PresetRange } from "./model/presets";
export type {
  DashboardFilter,
  ProductOption,
  RevenueSummary,
  CancellationStats,
  SeatOccupancy,
  RevenueTrendPoint,
  StatusSlice,
  DashboardData,
} from "./model/types";
export {
  getRevenueSummary,
  getPenaltyRevenue,
  getCancellationStats,
  getSeatOccupancy,
  getRevenueTrend,
  getBookingStatusDistribution,
  getProductOptions,
  TAG_DASHBOARD,
} from "./api/queries";
export type {
  DrilldownMetric,
  DrilldownData,
  DrilldownResult,
  RevenueRow,
  PenaltyRow,
  CancellationRow,
  OccupancyRow,
  DrilldownRowMap,
} from "./model/types";
// DRILLDOWN_COLUMNS/DRILLDOWN_LABEL는 client-only 프레젠테이션이라
// features/admin-dashboard-drilldown/model/drilldownColumns.ts로 이관됨([ADR-0053], 배럴 누출 차단).
export {
  getRevenueRows,
  getPenaltyRows,
  getCancellationRows,
  getOccupancyRows,
} from "./api/drilldown";
export type { WebVitalP75, RouteVitalP75, VitalTrendPoint } from "./model/types";
export { getWebVitalSummary, getWebVitalByRoute, getWebVitalTrend, TAG_RUM } from "./api/rum";
