import { describe, it, expect } from "vitest";
import { computeRemainingSeats } from "../remainingSeats";

describe("computeRemainingSeats", () => {
  it("should return 7 when capacity is 10 and bookedSeats is 3", () => {
    expect(computeRemainingSeats(10, 3)).toBe(7);
  });

  it("should return 0 when bookedSeats exceeds capacity", () => {
    expect(computeRemainingSeats(10, 15)).toBe(0);
  });

  it("should return 0 when both capacity and bookedSeats are 0", () => {
    expect(computeRemainingSeats(0, 0)).toBe(0);
  });

  it("should return 10 when bookedSeats is 0", () => {
    expect(computeRemainingSeats(10, 0)).toBe(10);
  });
});
