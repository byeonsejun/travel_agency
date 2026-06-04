import { describe, it, expect } from "vitest";
import { computeRefundedFromJobs } from "../backfill-phase8";

describe("computeRefundedFromJobs", () => {
  it("PENDING/IN_PROGRESS/SUCCEEDED amount 합산, FAILED 제외", () => {
    const sum = computeRefundedFromJobs([
      { amount: 300, status: "SUCCEEDED" },
      { amount: 200, status: "PENDING" },
      { amount: 100, status: "IN_PROGRESS" },
      { amount: 999, status: "FAILED" },
    ]);
    expect(sum).toBe(600);
  });
});
