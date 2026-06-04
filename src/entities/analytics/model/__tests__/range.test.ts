import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseRange } from "../range";

describe("parseRange", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 고정 기준 시각: 2026-06-04T09:00:00+09:00 (UTC 00:00)
    vi.setSystemTime(new Date("2026-06-04T00:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("기본값: 미지정이면 30d", () => {
    const r = parseRange(undefined);
    expect(r.key).toBe("30d");
    expect(r.bucket).toBe("day");
  });

  it("오타/미지원 값이면 30d 폴백", () => {
    expect(parseRange("garbage").key).toBe("30d");
    expect(parseRange("").key).toBe("30d");
  });

  it("7d: from 은 to 보다 7일 전", () => {
    const r = parseRange("7d");
    expect(r.key).toBe("7d");
    const diffDays = (r.to.getTime() - r.from.getTime()) / 86_400_000;
    expect(Math.round(diffDays)).toBe(7);
  });

  it("today: from 은 오늘 00:00(UTC 기준 자정)", () => {
    const r = parseRange("today");
    expect(r.key).toBe("today");
    expect(r.from.getTime()).toBeLessThan(r.to.getTime());
  });

  it("all: from 은 epoch, bucket 은 month", () => {
    const r = parseRange("all");
    expect(r.from.getTime()).toBe(0);
    expect(r.bucket).toBe("month");
  });

  it("배열(중복 쿼리파라미터) 입력도 안전하게 폴백", () => {
    // Next searchParams 는 string | string[] | undefined
    expect(parseRange(["7d", "30d"] as unknown as string).key).toBe("30d");
  });
});
