import { describe, expect, it } from "vitest";
import {
  RATE_LIMIT_TIERS,
  RATE_LIMIT_BYPASS,
  isBypassPath,
} from "../tiers";

describe("RATE_LIMIT_TIERS catalogue", () => {
  it("contains exactly 5 tiers (mutation 추가)", () => {
    expect(Object.keys(RATE_LIMIT_TIERS).sort()).toEqual([
      "ai-search",
      "auth",
      "global",
      "mutation",
      "payment",
    ]);
  });

  it("each tier has positive limit + valid window + idStrategy", () => {
    const validStrategies = ["userFirst", "ipOnly", "userOnly"];
    for (const cfg of Object.values(RATE_LIMIT_TIERS)) {
      expect(cfg.limit).toBeGreaterThan(0);
      expect(cfg.window).toMatch(/^\d+ [smhd]$/);
      expect(validStrategies).toContain(cfg.idStrategy);
    }
  });

  it("payment uses userOnly (authenticated only)", () => {
    expect(RATE_LIMIT_TIERS.payment.idStrategy).toBe("userOnly");
  });

  it("auth uses ipOnly (pre-authentication)", () => {
    expect(RATE_LIMIT_TIERS.auth.idStrategy).toBe("ipOnly");
  });

  it("limits match design spec §3", () => {
    expect(RATE_LIMIT_TIERS.global).toMatchObject({ limit: 100, window: "10 s" });
    expect(RATE_LIMIT_TIERS.auth).toMatchObject({ limit: 5, window: "1 m" });
    expect(RATE_LIMIT_TIERS.payment).toMatchObject({ limit: 10, window: "1 m" });
    expect(RATE_LIMIT_TIERS["ai-search"]).toMatchObject({ limit: 20, window: "1 m" });
  });

  it("mutation tier: limit=20, window='1 m', idStrategy='userFirst'", () => {
    expect(RATE_LIMIT_TIERS.mutation).toMatchObject({
      limit: 20,
      window: "1 m",
      idStrategy: "userFirst",
    });
  });
});

describe("RATE_LIMIT_BYPASS list", () => {
  it("contains critical no-limit paths (spec §3.1)", () => {
    expect(RATE_LIMIT_BYPASS).toContain("/api/payments/webhook/toss");
    expect(RATE_LIMIT_BYPASS).toContain("/api/cron/");
    expect(RATE_LIMIT_BYPASS).toContain("/api/csp-report");
    expect(RATE_LIMIT_BYPASS).toContain("/api/health");
  });
});

describe("isBypassPath", () => {
  it("matches exact bypass paths", () => {
    expect(isBypassPath("/api/health")).toBe(true);
    expect(isBypassPath("/api/csp-report")).toBe(true);
  });
  it("matches bypass prefixes (cron 등)", () => {
    expect(isBypassPath("/api/cron/process-refunds")).toBe(true);
    expect(isBypassPath("/api/payments/webhook/toss")).toBe(true);
  });
  it("does NOT match non-bypass paths", () => {
    expect(isBypassPath("/api/payments/confirm")).toBe(false);
    expect(isBypassPath("/api/wishlist/check")).toBe(false);
    expect(isBypassPath("/")).toBe(false);
  });
});
