import { describe, expect, it } from "vitest";
import { getClientIp, hashIdForLog, identify } from "../identifier";

function mockReq(headers: Record<string, string>): Request {
  return new Request("http://localhost/", { headers });
}

describe("getClientIp", () => {
  it("prefers x-vercel-forwarded-for first hop", () => {
    const req = mockReq({
      "x-vercel-forwarded-for": "203.0.113.10, 198.51.100.1",
      "x-forwarded-for": "spoofed",
    });
    expect(getClientIp(req)).toBe("203.0.113.10");
  });

  it("falls back to x-forwarded-for first hop", () => {
    const req = mockReq({ "x-forwarded-for": "203.0.113.10, 1.1.1.1" });
    expect(getClientIp(req)).toBe("203.0.113.10");
  });

  it("falls back to x-real-ip", () => {
    const req = mockReq({ "x-real-ip": "203.0.113.10" });
    expect(getClientIp(req)).toBe("203.0.113.10");
  });

  it("returns 'unknown' when no header present", () => {
    expect(getClientIp(mockReq({}))).toBe("unknown");
  });

  it("trims whitespace from header values", () => {
    expect(getClientIp(mockReq({ "x-real-ip": "  1.2.3.4  " }))).toBe("1.2.3.4");
  });
});

describe("identify", () => {
  const req = mockReq({ "x-real-ip": "1.2.3.4" });

  it("userFirst returns user:<id> when authenticated", () => {
    expect(identify(req, "userFirst", "u_1")).toBe("user:u_1");
  });

  it("userFirst falls back to ip when no userId", () => {
    expect(identify(req, "userFirst", null)).toBe("ip:1.2.3.4");
  });

  it("userFirst falls back to ip when userId is undefined", () => {
    expect(identify(req, "userFirst", undefined)).toBe("ip:1.2.3.4");
  });

  it("ipOnly ignores userId entirely", () => {
    expect(identify(req, "ipOnly", "u_1")).toBe("ip:1.2.3.4");
  });

  it("userOnly returns user:<id>", () => {
    expect(identify(req, "userOnly", "u_1")).toBe("user:u_1");
  });

  it("userOnly throws UNAUTHENTICATED when no userId", () => {
    expect(() => identify(req, "userOnly", null)).toThrow("UNAUTHENTICATED");
  });
});

describe("hashIdForLog", () => {
  it("masks middle of identifier value", () => {
    expect(hashIdForLog("ip:203.0.113.10")).toMatch(/^ip:\d+\.0?.*\.\.\..+$/);
  });
  it("preserves scope prefix", () => {
    expect(hashIdForLog("user:abc123def456")).toMatch(/^user:abc1\.\.\.56$/);
  });
  it("returns scope only when value missing", () => {
    expect(hashIdForLog("anon")).toBe("anon");
  });
});
