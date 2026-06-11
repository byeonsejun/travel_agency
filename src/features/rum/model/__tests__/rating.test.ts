import { describe, it, expect } from "vitest";
import { ratingFor } from "../rating";

describe("ratingFor (web-vitals 표준 임계)", () => {
  it("LCP: ≤2500 good, ≤4000 ni, >4000 poor", () => {
    expect(ratingFor("LCP", 2500)).toBe("good");
    expect(ratingFor("LCP", 2501)).toBe("needs-improvement");
    expect(ratingFor("LCP", 4000)).toBe("needs-improvement");
    expect(ratingFor("LCP", 4001)).toBe("poor");
  });

  it("INP: ≤200 good, ≤500 ni, >500 poor", () => {
    expect(ratingFor("INP", 200)).toBe("good");
    expect(ratingFor("INP", 350)).toBe("needs-improvement");
    expect(ratingFor("INP", 501)).toBe("poor");
  });

  it("CLS: ≤0.1 good, ≤0.25 ni, >0.25 poor", () => {
    expect(ratingFor("CLS", 0.1)).toBe("good");
    expect(ratingFor("CLS", 0.2)).toBe("needs-improvement");
    expect(ratingFor("CLS", 0.26)).toBe("poor");
  });

  it("FCP: ≤1800 good, ≤3000 ni, >3000 poor", () => {
    expect(ratingFor("FCP", 1800)).toBe("good");
    expect(ratingFor("FCP", 3001)).toBe("poor");
  });

  it("TTFB: ≤800 good, ≤1800 ni, >1800 poor", () => {
    expect(ratingFor("TTFB", 800)).toBe("good");
    expect(ratingFor("TTFB", 1801)).toBe("poor");
  });
});
