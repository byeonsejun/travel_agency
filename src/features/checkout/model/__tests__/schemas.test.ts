import { describe, it, expect } from "vitest";
import { CheckoutFormSchema } from "../schemas";

// ── 공통 픽스처 ────────────────────────────────────────────────
const validTraveler = {
  lastNameEn: "KIM",
  firstNameEn: "CHULSOO",
  gender: "MALE" as const,
  birthDate: new Date("1990-01-01"),
  role: "BOOKER" as const,
};

const validBase = {
  departureId: "clxxxxxxxxxxxxxxxxxxxxxxx",
  adultCount: 1,
  travelers: [validTraveler],
  termKeys: ["standard_overseas_v1"],
};

describe("CheckoutFormSchema", () => {
  it("최소 유효 입력(성인 1명) → success", () => {
    const result = CheckoutFormSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });

  it("adultCount=0 → fail (min 1)", () => {
    const result = CheckoutFormSchema.safeParse({ ...validBase, adultCount: 0, travelers: [] });
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((i) => i.path[0]);
    expect(paths).toContain("adultCount");
  });

  it("총 인원(adult+child+infant) > 9 → fail", () => {
    const travelers = Array.from({ length: 6 }, () => validTraveler);
    const result = CheckoutFormSchema.safeParse({
      ...validBase,
      adultCount: 6,
      childCount: 4,
      travelers,
    });
    expect(result.success).toBe(false);
  });

  it("infantCount > adultCount → fail", () => {
    const result = CheckoutFormSchema.safeParse({
      ...validBase,
      adultCount: 1,
      infantCount: 2,
    });
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((i) => i.path[0]);
    expect(paths).toContain("infantCount");
  });

  it("travelers.length ≠ adultCount + childCount → fail", () => {
    // adult=2 지만 traveler 1명
    const result = CheckoutFormSchema.safeParse({
      ...validBase,
      adultCount: 2,
      travelers: [validTraveler],
    });
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((i) => i.path[0]);
    expect(paths).toContain("travelers");
  });

  it("termKeys 빈 배열 → fail", () => {
    const result = CheckoutFormSchema.safeParse({ ...validBase, termKeys: [] });
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((i) => i.path[0]);
    expect(paths).toContain("termKeys");
  });

  it("성인 2 + 아동 1, travelers 3명 → success", () => {
    const result = CheckoutFormSchema.safeParse({
      ...validBase,
      adultCount: 2,
      childCount: 1,
      travelers: [validTraveler, validTraveler, validTraveler],
    });
    expect(result.success).toBe(true);
  });

  it("notes 생략 → success (optional)", () => {
    const { notes: _, ...noNotes } = { ...validBase, notes: undefined };
    const result = CheckoutFormSchema.safeParse(noNotes);
    expect(result.success).toBe(true);
  });
});
