import { describe, it, expect } from "vitest";
import { normalizeRoute, coerceRouteTemplate, ROUTE_TEMPLATES } from "../normalizeRoute";

describe("normalizeRoute", () => {
  it("PDP 동적 id를 템플릿으로 접는다", () => {
    expect(normalizeRoute("/products/abc123")).toBe("/products/[id]");
    expect(normalizeRoute("/products/xyz-789")).toBe("/products/[id]");
  });

  it("PDP 하위 checkout을 구분한다", () => {
    expect(normalizeRoute("/products/abc/checkout")).toBe("/products/[id]/checkout");
  });

  it("bookings 동적 id와 하위 경로를 구분한다", () => {
    expect(normalizeRoute("/bookings/bk1")).toBe("/bookings/[id]");
    expect(normalizeRoute("/bookings/bk1/success")).toBe("/bookings/[id]/success");
    expect(normalizeRoute("/bookings/bk1/failed")).toBe("/bookings/[id]/failed");
  });

  it("알려진 정적 경로는 그대로 둔다", () => {
    expect(normalizeRoute("/")).toBe("/");
    expect(normalizeRoute("/products")).toBe("/products");
    expect(normalizeRoute("/search")).toBe("/search");
  });

  it("trailing slash와 query string을 제거한다", () => {
    expect(normalizeRoute("/products/abc/")).toBe("/products/[id]");
    expect(normalizeRoute("/search?q=osaka")).toBe("/search");
  });

  it("미상 경로는 /(other) 버킷으로 수렴한다", () => {
    expect(normalizeRoute("/random/deep/path")).toBe("/(other)");
    expect(normalizeRoute("/admin/secret")).toBe("/(other)");
  });

  it("coerceRouteTemplate는 템플릿 화이트리스트만 통과, 임의 문자열은 /(other)", () => {
    expect(coerceRouteTemplate("/products/[id]")).toBe("/products/[id]");
    expect(coerceRouteTemplate("/evil-injected-string")).toBe("/(other)");
  });

  it("ROUTE_TEMPLATES는 /(other)를 포함한다", () => {
    expect(ROUTE_TEMPLATES).toContain("/(other)");
  });
});
