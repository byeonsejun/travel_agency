import { describe, it, expect } from "vitest";
import { safeReturnTo } from "../safeReturnTo";

describe("safeReturnTo", () => {
  it("같은 출처의 절대 경로는 그대로 반환", () => {
    expect(safeReturnTo("/products/abc")).toBe("/products/abc");
  });

  it("쿼리스트링 포함 경로도 보존", () => {
    expect(safeReturnTo("/products?destination=JP&page=2")).toBe(
      "/products?destination=JP&page=2"
    );
  });

  it("protocol-relative URL(//evil.com)은 / 로 폴백 — open-redirect 차단", () => {
    expect(safeReturnTo("//evil.com")).toBe("/");
    expect(safeReturnTo("//evil.com/path")).toBe("/");
  });

  it("절대 URL(http://, https://)은 / 로 폴백", () => {
    expect(safeReturnTo("http://evil.com")).toBe("/");
    expect(safeReturnTo("https://evil.com/foo")).toBe("/");
  });

  it("빈 문자열·undefined·null 은 / 로 폴백", () => {
    expect(safeReturnTo("")).toBe("/");
    expect(safeReturnTo(undefined)).toBe("/");
    expect(safeReturnTo(null)).toBe("/");
  });

  it("/ 로 시작하지 않는 상대 경로도 / 로 폴백", () => {
    expect(safeReturnTo("products/abc")).toBe("/");
  });
});
