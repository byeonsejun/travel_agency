// src/entities/analytics/model/__tests__/presets.test.ts
import { describe, it, expect } from "vitest";
import { presetRange, PRESETS } from "../presets";

const NOW = new Date("2026-06-05T05:30:00.000Z");

describe("presetRange", () => {
  it("today: start=end=오늘", () => {
    expect(presetRange("today", NOW)).toEqual({
      start: "2026-06-05",
      end: "2026-06-05",
    });
  });
  it("7d: start=7일 전, end=오늘", () => {
    expect(presetRange("7d", NOW)).toEqual({
      start: "2026-05-29",
      end: "2026-06-05",
    });
  });
  it("30d", () => {
    expect(presetRange("30d", NOW).start).toBe("2026-05-06");
  });
  it("90d", () => {
    expect(presetRange("90d", NOW).start).toBe("2026-03-07");
  });
  it("all: start=2000-01-01", () => {
    expect(presetRange("all", NOW)).toEqual({
      start: "2000-01-01",
      end: "2026-06-05",
    });
  });
  it("PRESETS 는 5개 라벨", () => {
    expect(PRESETS.map((p) => p.key)).toEqual([
      "today",
      "7d",
      "30d",
      "90d",
      "all",
    ]);
  });
});
