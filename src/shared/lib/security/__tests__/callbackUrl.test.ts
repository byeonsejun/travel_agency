import { describe, it, expect } from "vitest";
import { safeCallbackPath } from "../callbackUrl";

describe("safeCallbackPath", () => {
  it("안전한 내부 절대경로는 그대로 보존 (쿼리스트링 포함)", () => {
    expect(safeCallbackPath("/mypage")).toBe("/mypage");
    expect(safeCallbackPath("/mypage?page=2")).toBe("/mypage?page=2");
    expect(safeCallbackPath("/bookings/abc123")).toBe("/bookings/abc123");
  });

  it("누락/빈 값은 fallback", () => {
    expect(safeCallbackPath(null)).toBe("/");
    expect(safeCallbackPath(undefined)).toBe("/");
    expect(safeCallbackPath("")).toBe("/");
  });

  it("외부 URL 은 fallback (open redirect 차단)", () => {
    expect(safeCallbackPath("https://evil.com")).toBe("/");
    expect(safeCallbackPath("http://evil.com/path")).toBe("/");
  });

  it("프로토콜-상대 경로(//)는 fallback", () => {
    expect(safeCallbackPath("//evil.com")).toBe("/");
    expect(safeCallbackPath("//evil.com/mypage")).toBe("/");
  });

  it("백슬래시 우회(/\\)는 fallback", () => {
    expect(safeCallbackPath("/\\evil.com")).toBe("/");
  });

  it("제어문자/개행 포함 경로는 fallback (인젝션 방어)", () => {
    expect(safeCallbackPath("/mypage\nSet-Cookie: x")).toBe("/");
    expect(safeCallbackPath("/mypage\r\nLocation: http://evil")).toBe("/");
  });

  it("커스텀 fallback 을 존중", () => {
    expect(safeCallbackPath("https://evil.com", "/login")).toBe("/login");
    expect(safeCallbackPath(null, "/home")).toBe("/home");
  });
});
