// src/entities/analytics/model/__tests__/filter.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { parseFilter } from "../filter";

describe("parseFilter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-05T05:30:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("미지정이면 최근 30일, bucket=day", () => {
    const f = parseFilter({});
    expect(f.cacheKey.endDay).toBe("2026-06-05");
    expect(f.cacheKey.startDay).toBe("2026-05-06"); // 30일 전
    expect(f.bucket).toBe("day");
    expect(f.productId).toBeNull();
    expect(f.cacheKey.product).toBe("all");
  });

  it("start/end 일 경계로 양자화 (ms 정밀도 제거)", () => {
    const f = parseFilter({ start: "2026-05-01", end: "2026-05-15" });
    expect(f.cacheKey.startDay).toBe("2026-05-01");
    expect(f.cacheKey.endDay).toBe("2026-05-15");
    // to = endDay + 1일 (미포함 상한)
    expect(f.to.toISOString()).toBe("2026-05-16T00:00:00.000Z");
    expect(f.from.toISOString()).toBe("2026-05-01T00:00:00.000Z");
  });

  it("미래 end 는 오늘로 클램프", () => {
    const f = parseFilter({ start: "2026-06-01", end: "2099-01-01" });
    expect(f.cacheKey.endDay).toBe("2026-06-05");
  });

  it("start > end 면 스왑", () => {
    const f = parseFilter({ start: "2026-05-20", end: "2026-05-10" });
    expect(f.cacheKey.startDay).toBe("2026-05-10");
    expect(f.cacheKey.endDay).toBe("2026-05-20");
  });

  it("오타/빈 날짜는 폴백(30일)", () => {
    const f = parseFilter({ start: "garbage", end: "" });
    expect(f.cacheKey.startDay).toBe("2026-05-06");
    expect(f.cacheKey.endDay).toBe("2026-06-05");
  });

  it("배열 입력은 첫 값 사용", () => {
    const f = parseFilter({ start: ["2026-05-01", "x"], end: ["2026-05-03"] });
    expect(f.cacheKey.startDay).toBe("2026-05-01");
    expect(f.cacheKey.endDay).toBe("2026-05-03");
  });

  it("긴 범위(>92일)는 bucket=month", () => {
    const f = parseFilter({ start: "2026-01-01", end: "2026-06-05" });
    expect(f.bucket).toBe("month");
  });

  it("productId 형식 통과 / 불량은 null", () => {
    expect(parseFilter({ productId: "clabc123xyz" }).productId).toBe("clabc123xyz");
    expect(parseFilter({ productId: "clabc123xyz" }).cacheKey.product).toBe("clabc123xyz");
    expect(parseFilter({ productId: "bad id!" }).productId).toBeNull();
    expect(parseFilter({ productId: "bad id!" }).cacheKey.product).toBe("all");
  });

  it("레거시 ?range= 는 start 미지정 시에만 일수로 매핑", () => {
    const f = parseFilter({ range: "7d" });
    expect(f.cacheKey.startDay).toBe("2026-05-29"); // 7일 전
    expect(f.cacheKey.endDay).toBe("2026-06-05");
    // start 명시되면 레거시 무시
    const f2 = parseFilter({ range: "7d", start: "2026-01-01", end: "2026-01-10" });
    expect(f2.cacheKey.startDay).toBe("2026-01-01");
  });
});
