import { describe, it, expect } from "vitest";
import {
  assertReviewTransition,
  InvalidReviewTransitionError,
} from "../transitions";

describe("assertReviewTransition", () => {
  it("PUBLISHED ↔ HIDDEN 양방향 허용", () => {
    expect(() => assertReviewTransition("PUBLISHED", "HIDDEN")).not.toThrow();
    expect(() => assertReviewTransition("HIDDEN", "PUBLISHED")).not.toThrow();
  });

  it("REPORTED → PUBLISHED/HIDDEN 허용", () => {
    expect(() => assertReviewTransition("REPORTED", "PUBLISHED")).not.toThrow();
    expect(() => assertReviewTransition("REPORTED", "HIDDEN")).not.toThrow();
  });

  it("동일 상태로의 전이는 거부", () => {
    expect(() => assertReviewTransition("PUBLISHED", "PUBLISHED")).toThrow(
      InvalidReviewTransitionError,
    );
  });

  it("PUBLISHED/HIDDEN → REPORTED 는 거부 (모더레이터가 신고 상태를 만들지 않음)", () => {
    expect(() => assertReviewTransition("PUBLISHED", "REPORTED")).toThrow(
      InvalidReviewTransitionError,
    );
  });
});
