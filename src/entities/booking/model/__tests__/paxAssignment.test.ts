import { describe, it, expect } from "vitest";
import { assignPaxTypes } from "../paxAssignment";

const prices = { priceAdult: 1000, priceChild: 600, priceInfant: 0 };

describe("assignPaxTypes", () => {
  it("나이 많은 순으로 adult→child→infant 그리디 배정", () => {
    const result = assignPaxTypes({
      travelers: [
        { key: "young", birthDate: new Date("2020-01-01") },
        { key: "old", birthDate: new Date("1990-01-01") },
        { key: "mid", birthDate: new Date("2015-01-01") },
      ],
      adultCount: 1,
      childCount: 1,
      infantCount: 1,
      ...prices,
      totalPrice: 1600,
    });
    const byKey = Object.fromEntries(result.map((r) => [r.key, r]));
    expect(byKey.old.paxType).toBe("ADULT");
    expect(byKey.old.unitPrice).toBe(1000);
    expect(byKey.mid.paxType).toBe("CHILD");
    expect(byKey.mid.unitPrice).toBe(600);
    expect(byKey.young.paxType).toBe("INFANT");
    expect(byKey.young.unitPrice).toBe(0);
  });

  it("Σ unitPrice == totalPrice 불변식 (가격 드리프트 잔차를 첫 ADULT에 보정)", () => {
    // 현재가 합 1600이지만 과거 결제 totalPrice가 1700(드리프트) → 차액 +100을 ADULT에
    const result = assignPaxTypes({
      travelers: [
        { key: "a", birthDate: new Date("1990-01-01") },
        { key: "c", birthDate: new Date("2015-01-01") },
      ],
      adultCount: 1,
      childCount: 1,
      infantCount: 0,
      ...prices,
      totalPrice: 1700,
    });
    const sum = result.reduce((s, r) => s + r.unitPrice, 0);
    expect(sum).toBe(1700);
    const adult = result.find((r) => r.paxType === "ADULT")!;
    expect(adult.unitPrice).toBe(1100); // 1000 + 100 잔차
  });

  it("traveler 수 ≠ 카운트 합이면 throw", () => {
    expect(() =>
      assignPaxTypes({
        travelers: [{ key: "a", birthDate: new Date("1990-01-01") }],
        adultCount: 1,
        childCount: 1,
        infantCount: 0,
        ...prices,
        totalPrice: 1600,
      })
    ).toThrow(/count mismatch/i);
  });
});
