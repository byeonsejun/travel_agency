import { describe, it, expect } from "vitest";
import { assignPaxTypes } from "../../model/paxAssignment";

// createBooking이 travelers를 입력 순서가 아닌 assignPaxTypes 결과로 채우는지
// 단위 수준에서 매핑 규칙을 고정(통합은 Task 12). 여기선 매핑 계약만 박제.
describe("createBooking pax mapping contract", () => {
  it("입력 traveler에 index key를 부여해 assignPaxTypes 결과를 역매핑할 수 있다", () => {
    const travelers = [
      { lastNameEn: "A", birthDate: new Date("1990-01-01") },
      { lastNameEn: "B", birthDate: new Date("2018-01-01") },
    ];
    const assigned = assignPaxTypes({
      travelers: travelers.map((t, i) => ({ key: String(i), birthDate: t.birthDate })),
      adultCount: 1, childCount: 1, infantCount: 0,
      priceAdult: 1000, priceChild: 600, priceInfant: 0, totalPrice: 1600,
    });
    const byIndex = new Map(assigned.map((a) => [a.key, a]));
    expect(byIndex.get("0")!.paxType).toBe("ADULT");
    expect(byIndex.get("1")!.paxType).toBe("CHILD");
  });
});
