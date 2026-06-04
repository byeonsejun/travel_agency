import { describe, it, expect } from "vitest";
import {
  assertDepartureTransition,
  requiresEmptySeats,
  allowedNextStatuses,
  InvalidDepartureTransitionError,
} from "../transitions";

describe("assertDepartureTransition — 허용 전이", () => {
  it("SCHEDULED → CONFIRMED 허용", () => {
    expect(() => assertDepartureTransition("SCHEDULED", "CONFIRMED")).not.toThrow();
  });
  it("SCHEDULED → CLOSED 허용", () => {
    expect(() => assertDepartureTransition("SCHEDULED", "CLOSED")).not.toThrow();
  });
  it("SCHEDULED → CANCELED 허용", () => {
    expect(() => assertDepartureTransition("SCHEDULED", "CANCELED")).not.toThrow();
  });
  it("CONFIRMED → CLOSED 허용", () => {
    expect(() => assertDepartureTransition("CONFIRMED", "CLOSED")).not.toThrow();
  });
  it("CONFIRMED → CANCELED 허용", () => {
    expect(() => assertDepartureTransition("CONFIRMED", "CANCELED")).not.toThrow();
  });
  it("CLOSED → SCHEDULED 허용 (reopen, D5)", () => {
    expect(() => assertDepartureTransition("CLOSED", "SCHEDULED")).not.toThrow();
  });
  it("CLOSED → CANCELED 허용", () => {
    expect(() => assertDepartureTransition("CLOSED", "CANCELED")).not.toThrow();
  });
});

describe("assertDepartureTransition — 금지 전이", () => {
  it("CANCELED → * 전부 금지 (terminal)", () => {
    expect(() => assertDepartureTransition("CANCELED", "SCHEDULED")).toThrow(
      InvalidDepartureTransitionError,
    );
    expect(() => assertDepartureTransition("CANCELED", "CLOSED")).toThrow(
      InvalidDepartureTransitionError,
    );
  });
  it("CONFIRMED → SCHEDULED 금지 (역행 불가)", () => {
    expect(() => assertDepartureTransition("CONFIRMED", "SCHEDULED")).toThrow(
      InvalidDepartureTransitionError,
    );
  });
  it("SCHEDULED → SCHEDULED 자기전이 금지", () => {
    expect(() => assertDepartureTransition("SCHEDULED", "SCHEDULED")).toThrow(
      InvalidDepartureTransitionError,
    );
  });
  it("CLOSED → CONFIRMED 금지 (reopen은 SCHEDULED 경유만)", () => {
    expect(() => assertDepartureTransition("CLOSED", "CONFIRMED")).toThrow(
      InvalidDepartureTransitionError,
    );
  });
});

describe("requiresEmptySeats — 취소만 좌석 비움 요구 (D1)", () => {
  it("CANCELED는 true", () => {
    expect(requiresEmptySeats("CANCELED")).toBe(true);
  });
  it("CLOSED/CONFIRMED/SCHEDULED는 false", () => {
    expect(requiresEmptySeats("CLOSED")).toBe(false);
    expect(requiresEmptySeats("CONFIRMED")).toBe(false);
    expect(requiresEmptySeats("SCHEDULED")).toBe(false);
  });
});

describe("allowedNextStatuses — UI 전이 게이트 (SSOT 위임)", () => {
  it("SCHEDULED → 3개 전이 가능", () => {
    expect(allowedNextStatuses("SCHEDULED")).toEqual([
      "CONFIRMED",
      "CLOSED",
      "CANCELED",
    ]);
  });
  it("CANCELED → terminal (빈 배열)", () => {
    expect(allowedNextStatuses("CANCELED")).toEqual([]);
  });
});
