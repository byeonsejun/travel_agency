import { describe, it, expect } from "vitest";
import { formatEventActor } from "../eventActor";

describe("formatEventActor", () => {
  it("admin:* → 여행사(관리자), 내부 ID 노출 안 함", () => {
    expect(formatEventActor("admin:cseedadmin00000000000000001")).toBe("여행사(관리자)");
  });
  it("user:* → 고객", () => {
    expect(formatEventActor("user:cseedcustomer0000000000001")).toBe("고객");
  });
  it("system:* → 시스템", () => {
    expect(formatEventActor("system:cron")).toBe("시스템");
    expect(formatEventActor("system:webhook")).toBe("시스템");
  });
  it("알 수 없는 형식은 원문 유지(폴백)", () => {
    expect(formatEventActor("unknown")).toBe("unknown");
    expect(formatEventActor("")).toBe("");
  });
});
