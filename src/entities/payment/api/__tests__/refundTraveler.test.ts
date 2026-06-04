import { describe, it, expect } from "vitest";
import { computeCanceledBase } from "../refund";

describe("computeCanceledBase", () => {
  it("취소 여행자 unitPrice 합 + 좌석점유분(ADULT/CHILD) 계산", () => {
    const r = computeCanceledBase([
      { paxType: "ADULT", unitPrice: 1000 },
      { paxType: "CHILD", unitPrice: 600 },
      { paxType: "INFANT", unitPrice: 0 },
    ]);
    expect(r.canceledBase).toBe(1600);
    expect(r.seatsReleased).toBe(2); // INFANT 미차감
  });
});
