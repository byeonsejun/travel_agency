import { describe, it, expect } from "vitest";
import { DRILLDOWN_COLUMNS, DRILLDOWN_LABEL } from "../columns";

describe("DRILLDOWN_COLUMNS", () => {
  it("메트릭 4종 모두 컬럼을 가진다", () => {
    expect(DRILLDOWN_COLUMNS.revenue.length).toBeGreaterThan(0);
    expect(DRILLDOWN_COLUMNS.penalty.length).toBeGreaterThan(0);
    expect(DRILLDOWN_COLUMNS.cancellation.length).toBeGreaterThan(0);
    expect(DRILLDOWN_COLUMNS.occupancy.length).toBeGreaterThan(0);
  });
  it("revenue 컬럼 value 접근자가 row 값을 추출", () => {
    const col = DRILLDOWN_COLUMNS.revenue.find((c) => c.header === "결제액")!;
    expect(col.value({ paidAt: "2026-06-01", orderId: "o1", productTitle: "t", customer: "c", amount: 1000, refundedAmount: 0, status: "PAID" })).toBe(1000);
  });
  it("각 메트릭에 한글 라벨이 있다", () => {
    expect(DRILLDOWN_LABEL.revenue).toBeTruthy();
    expect(DRILLDOWN_LABEL.occupancy).toBeTruthy();
  });
});
