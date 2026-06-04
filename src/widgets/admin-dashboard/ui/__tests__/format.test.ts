import { describe, it, expect } from "vitest";
import { formatKRW, formatPercent } from "../format";

describe("formatKRW", () => {
  it("천단위 콤마 + 원 기호", () => {
    expect(formatKRW(48230000)).toBe("₩48,230,000");
  });
  it("0원", () => {
    expect(formatKRW(0)).toBe("₩0");
  });
  it("음수(순매출 적자)", () => {
    expect(formatKRW(-1500)).toBe("-₩1,500");
  });
});

describe("formatPercent", () => {
  it("비율(0~1) → 소수1자리 %", () => {
    expect(formatPercent(0.087)).toBe("8.7%");
  });
  it("0", () => {
    expect(formatPercent(0)).toBe("0.0%");
  });
  it("1(=100%)", () => {
    expect(formatPercent(1)).toBe("100.0%");
  });
});
