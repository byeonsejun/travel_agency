import { describe, it, expect } from "vitest";
import { webVitalSchema } from "../schema";

describe("webVitalSchema", () => {
  it("정상 payload 통과", () => {
    const r = webVitalSchema.safeParse({
      metric: "LCP",
      value: 2300,
      route: "/products/[id]",
      navType: "navigate",
    });
    expect(r.success).toBe(true);
  });

  it("navType 생략 허용", () => {
    const r = webVitalSchema.safeParse({ metric: "CLS", value: 0.05, route: "/" });
    expect(r.success).toBe(true);
  });

  it("미상 metric 거부", () => {
    const r = webVitalSchema.safeParse({ metric: "FOO", value: 1, route: "/" });
    expect(r.success).toBe(false);
  });

  it("음수/NaN/Infinity value 거부", () => {
    expect(webVitalSchema.safeParse({ metric: "LCP", value: -1, route: "/" }).success).toBe(false);
    expect(webVitalSchema.safeParse({ metric: "LCP", value: NaN, route: "/" }).success).toBe(false);
    expect(webVitalSchema.safeParse({ metric: "LCP", value: Infinity, route: "/" }).success).toBe(false);
  });

  it("과도한 value(상한 초과) 거부", () => {
    expect(webVitalSchema.safeParse({ metric: "LCP", value: 9_999_999, route: "/" }).success).toBe(false);
  });

  it("route 길이 초과 거부", () => {
    const long = "/" + "x".repeat(200);
    expect(webVitalSchema.safeParse({ metric: "LCP", value: 1, route: long }).success).toBe(false);
  });
});
