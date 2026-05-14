import { describe, it, expect } from "vitest";
import { CreateBookingSchema, TravelerSchema } from "../schemas";

describe("TravelerSchema", () => {
  const validTraveler = {
    lastNameEn: "KIM",
    firstNameEn: "JIHOON",
    gender: "MALE" as const,
    birthDate: "1990-01-01",
    passportNo: "M12345678",
  };

  it("유효한 여행자 정보 통과", () => {
    expect(() => TravelerSchema.parse(validTraveler)).not.toThrow();
  });

  it("lastNameEn 소문자 포함 → 거부", () => {
    const result = TravelerSchema.safeParse({ ...validTraveler, lastNameEn: "kim" });
    expect(result.success).toBe(false);
  });

  it("firstNameEn 빈 문자열 → 거부", () => {
    const result = TravelerSchema.safeParse({ ...validTraveler, firstNameEn: "" });
    expect(result.success).toBe(false);
  });

  it("gender 잘못된 값 → 거부", () => {
    const result = TravelerSchema.safeParse({ ...validTraveler, gender: "OTHER" });
    expect(result.success).toBe(false);
  });

  it("birthDate 미래 날짜 → 거부", () => {
    const result = TravelerSchema.safeParse({ ...validTraveler, birthDate: "2999-01-01" });
    expect(result.success).toBe(false);
  });

  it("passportNo 형식 위반 → 거부 (너무 짧음)", () => {
    const result = TravelerSchema.safeParse({ ...validTraveler, passportNo: "M123" });
    expect(result.success).toBe(false);
  });

  it("passportNo 옵셔널 — 미입력 시 통과", () => {
    const { passportNo: _, ...withoutPassport } = validTraveler;
    expect(() => TravelerSchema.parse(withoutPassport)).not.toThrow();
  });
});

describe("CreateBookingSchema", () => {
  const validTraveler = {
    lastNameEn: "KIM",
    firstNameEn: "JIHOON",
    gender: "MALE" as const,
    birthDate: "1990-01-01",
  };

  const validInput = {
    departureId: "claaaaaaaaaaaaaaaaaaaaaaa",
    userId: "clbbbbbbbbbbbbbbbbbbbbbb",
    adultCount: 2,
    childCount: 1,
    infantCount: 1,
    expectedTotalPrice: 270_000,
    travelers: [validTraveler, validTraveler, validTraveler],
    termKeys: ["standard_overseas_v1"],
  };

  it("유효한 입력 통과", () => {
    expect(() => CreateBookingSchema.parse(validInput)).not.toThrow();
  });

  it("adultCount 0 → 거부 (성인 최소 1)", () => {
    const result = CreateBookingSchema.safeParse({ ...validInput, adultCount: 0, travelers: [] });
    expect(result.success).toBe(false);
  });

  it("infantCount > adultCount → 거부", () => {
    const result = CreateBookingSchema.safeParse({
      ...validInput,
      adultCount: 1,
      infantCount: 2,
      travelers: [validTraveler],
    });
    expect(result.success).toBe(false);
  });

  it("총 인원 10명 초과 → 거부", () => {
    const result = CreateBookingSchema.safeParse({
      ...validInput,
      adultCount: 5,
      childCount: 5,
      infantCount: 1,
      travelers: Array(10).fill(validTraveler),
    });
    expect(result.success).toBe(false);
  });

  it("travelers 길이 != adultCount + childCount → 거부", () => {
    const result = CreateBookingSchema.safeParse({
      ...validInput,
      adultCount: 2,
      childCount: 0,
      travelers: [validTraveler],
    });
    expect(result.success).toBe(false);
  });

  it("expectedTotalPrice 음수 → 거부", () => {
    const result = CreateBookingSchema.safeParse({ ...validInput, expectedTotalPrice: -1 });
    expect(result.success).toBe(false);
  });

  it("expectedTotalPrice 정수가 아닌 값 → 거부", () => {
    const result = CreateBookingSchema.safeParse({ ...validInput, expectedTotalPrice: 1.5 });
    expect(result.success).toBe(false);
  });

  it("termKeys 빈 배열 → 거부", () => {
    const result = CreateBookingSchema.safeParse({ ...validInput, termKeys: [] });
    expect(result.success).toBe(false);
  });
});
