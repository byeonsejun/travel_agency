import { describe, expect, it } from "vitest";
import { computeShiftDays } from "../ops/shift-departures";

const NOW = new Date("2026-10-14T06:00:00Z");

describe("computeShiftDays — 가장 이른 출발일을 (오늘 + leadDays) 로 맞추는 이동 일수", () => {
  it("최소 출발일이 과거면 내일(lead 1)이 되도록 양의 일수", () => {
    expect(computeShiftDays(new Date("2026-05-08T00:00:00Z"), NOW, 1)).toBe(160);
  });

  it("이미 최소 출발일이 목표일 이후면 0 (이동 안 함 — 재실행 멱등)", () => {
    expect(computeShiftDays(new Date("2026-10-15T00:00:00Z"), NOW, 1)).toBe(0);
    expect(computeShiftDays(new Date("2026-12-01T00:00:00Z"), NOW, 1)).toBe(0);
  });

  it("leadDays 를 늘리면 그만큼 더 뒤로", () => {
    expect(computeShiftDays(new Date("2026-05-08T00:00:00Z"), NOW, 7)).toBe(166);
  });

  it("음수 leadDays 는 거부", () => {
    expect(() => computeShiftDays(new Date("2026-05-08T00:00:00Z"), NOW, -1)).toThrow(RangeError);
  });
});
