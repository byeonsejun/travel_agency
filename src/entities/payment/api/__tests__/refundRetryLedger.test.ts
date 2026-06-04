import { describe, it, expect } from "vitest";
import { isPermanentFailure } from "../refundRetry";

describe("isPermanentFailure", () => {
  it("최대 attempts 도달 시 영구 실패(예약 해제 대상)", () => {
    expect(isPermanentFailure(10)).toBe(true);
    expect(isPermanentFailure(0)).toBe(false);
  });
});
