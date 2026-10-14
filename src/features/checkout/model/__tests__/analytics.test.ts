import { describe, expect, it } from "vitest";
import { buildPaxItems } from "../analytics";

const base = { productId: "p1", title: "다낭", destination: "다낭, 베트남" };
const prices = { priceAdult: 1000000, priceChild: 700000, priceInfant: 100000 };

describe("buildPaxItems (인원 유형별 GA4 item)", () => {
  it("인원 0 인 유형은 제외하고 유형별 단가·수량·variant 를 매핑", () => {
    expect(buildPaxItems(base, prices, { adult: 2, child: 1, infant: 0 })).toEqual([
      { ...base, unitPrice: 1000000, quantity: 2, variant: "adult" },
      { ...base, unitPrice: 700000, quantity: 1, variant: "child" },
    ]);
  });

  it("유아 포함 3유형", () => {
    expect(buildPaxItems(base, prices, { adult: 1, child: 0, infant: 1 }).map((i) => i.variant)).toEqual([
      "adult",
      "infant",
    ]);
  });

  it("합계가 서버 가격 공식(Σ 단가×인원)과 일치", () => {
    const items = buildPaxItems(base, prices, { adult: 2, child: 1, infant: 1 });
    const sum = items.reduce((a, i) => a + i.unitPrice * (i.quantity ?? 1), 0);
    expect(sum).toBe(2 * 1000000 + 700000 + 100000);
  });
});
