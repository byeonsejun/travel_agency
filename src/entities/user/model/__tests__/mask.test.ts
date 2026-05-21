import { describe, it, expect } from "vitest";
import { maskPassportNo } from "../mask";

describe("maskPassportNo", () => {
  it("표준 여권번호: 앞 2자 + **** + 뒤 2자", () => {
    expect(maskPassportNo("M12345678")).toBe("M1****78");
  });

  it("영문 2자 접두사 여권번호", () => {
    expect(maskPassportNo("AB1234567")).toBe("AB****67");
  });

  it("4자 미만 입력 → 전체 마스킹", () => {
    expect(maskPassportNo("M1")).toBe("****");
  });

  it("빈 문자열 → 전체 마스킹", () => {
    expect(maskPassportNo("")).toBe("****");
  });

  it("정확히 4자 → 앞 2 + **** + 뒤 2 (중간 0자)", () => {
    expect(maskPassportNo("AB12")).toBe("AB****12");
  });

  it("긴 번호도 앞 2 + **** + 뒤 2 고정", () => {
    expect(maskPassportNo("M123456789")).toBe("M1****89");
  });
});
