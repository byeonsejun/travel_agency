import { describe, it, expect } from "vitest";
import { ReviewInputSchema } from "../validation";

describe("ReviewInputSchema", () => {
  const base = { rating: 5, content: "정말 좋은 여행이었습니다." };

  describe("rating", () => {
    it("0 → 거부 (하한 미달)", () => {
      const result = ReviewInputSchema.safeParse({ ...base, rating: 0 });
      expect(result.success).toBe(false);
    });

    it("1 → 통과 (하한)", () => {
      const result = ReviewInputSchema.safeParse({ ...base, rating: 1 });
      expect(result.success).toBe(true);
    });

    it("5 → 통과 (상한)", () => {
      const result = ReviewInputSchema.safeParse({ ...base, rating: 5 });
      expect(result.success).toBe(true);
    });

    it("6 → 거부 (상한 초과)", () => {
      const result = ReviewInputSchema.safeParse({ ...base, rating: 6 });
      expect(result.success).toBe(false);
    });

    it("3.5 → 거부 (비정수 별점 금지)", () => {
      const result = ReviewInputSchema.safeParse({ ...base, rating: 3.5 });
      expect(result.success).toBe(false);
    });
  });

  describe("content", () => {
    it("빈 문자열 → 거부", () => {
      const result = ReviewInputSchema.safeParse({ ...base, content: "" });
      expect(result.success).toBe(false);
    });

    it("1001자 → 거부 (상한 초과)", () => {
      const result = ReviewInputSchema.safeParse({
        ...base,
        content: "x".repeat(1001),
      });
      expect(result.success).toBe(false);
    });

    it("정상 문자열 + 양끝 공백 → 통과 + trim 적용", () => {
      const result = ReviewInputSchema.safeParse({
        ...base,
        content: "  최고였어요  ",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toBe("최고였어요");
      }
    });
  });
});
