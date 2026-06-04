import { describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => ({ env: { CRON_SECRET: "x".repeat(32) } }));
vi.mock("@/shared/lib/env", () => ({ env: mocks.env }));

import { isCronAuthorized } from "../authorize";

function req(auth?: string) {
  return {
    headers: {
      get: (k: string) =>
        k.toLowerCase() === "authorization" && auth ? auth : null,
    },
  } as unknown as import("next/server").NextRequest;
}

describe("isCronAuthorized", () => {
  it("올바른 Bearer → true", () => {
    expect(isCronAuthorized(req(`Bearer ${"x".repeat(32)}`))).toBe(true);
  });
  it("틀린 토큰 → false", () => {
    expect(isCronAuthorized(req("Bearer wrong"))).toBe(false);
  });
  it("authorization 헤더 없음 → false", () => {
    expect(isCronAuthorized(req())).toBe(false);
  });
});
