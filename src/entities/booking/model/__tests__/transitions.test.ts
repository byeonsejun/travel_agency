import { describe, it, expect } from "vitest";
import {
  assertTransition,
  shouldReturnSeats,
  InvalidTransitionError,
} from "../transitions";

describe("assertTransition — 허용 전이", () => {
  it("RECEIVED → AWAITING_GROUP 허용", () => {
    expect(() => assertTransition("RECEIVED", "AWAITING_GROUP")).not.toThrow();
  });
  it("RECEIVED → DEPARTURE_CONFIRMED 허용", () => {
    expect(() =>
      assertTransition("RECEIVED", "DEPARTURE_CONFIRMED")
    ).not.toThrow();
  });
  it("RECEIVED → CANCELED_BY_USER 허용", () => {
    expect(() =>
      assertTransition("RECEIVED", "CANCELED_BY_USER")
    ).not.toThrow();
  });
  it("RECEIVED → CANCELED_BY_AGENCY 허용", () => {
    expect(() =>
      assertTransition("RECEIVED", "CANCELED_BY_AGENCY")
    ).not.toThrow();
  });
  it("AWAITING_GROUP → DEPARTURE_CONFIRMED 허용", () => {
    expect(() =>
      assertTransition("AWAITING_GROUP", "DEPARTURE_CONFIRMED")
    ).not.toThrow();
  });
  it("DEPARTURE_CONFIRMED → PAID 허용", () => {
    expect(() =>
      assertTransition("DEPARTURE_CONFIRMED", "PAID")
    ).not.toThrow();
  });
  it("PAID → READY 허용", () => {
    expect(() => assertTransition("PAID", "READY")).not.toThrow();
  });
  it("READY → COMPLETED 허용", () => {
    expect(() => assertTransition("READY", "COMPLETED")).not.toThrow();
  });
});

describe("assertTransition — 거부 전이 (InvalidTransitionError)", () => {
  it("COMPLETED → CANCELED_BY_USER 거부 (terminal)", () => {
    expect(() =>
      assertTransition("COMPLETED", "CANCELED_BY_USER")
    ).toThrow(InvalidTransitionError);
  });
  it("CANCELED_BY_USER → RECEIVED 거부 (terminal)", () => {
    expect(() =>
      assertTransition("CANCELED_BY_USER", "RECEIVED")
    ).toThrow(InvalidTransitionError);
  });
  it("CANCELED_BY_AGENCY → PAID 거부 (terminal)", () => {
    expect(() =>
      assertTransition("CANCELED_BY_AGENCY", "PAID")
    ).toThrow(InvalidTransitionError);
  });
  it("RECEIVED → PAID 거부 (2단계 건너뜀)", () => {
    expect(() => assertTransition("RECEIVED", "PAID")).toThrow(
      InvalidTransitionError
    );
  });
  it("PAID → RECEIVED 거부 (역방향)", () => {
    expect(() => assertTransition("PAID", "RECEIVED")).toThrow(
      InvalidTransitionError
    );
  });
  it("InvalidTransitionError에 from → to 메시지 포함", () => {
    try {
      assertTransition("RECEIVED", "PAID");
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidTransitionError);
      expect((e as Error).name).toBe("InvalidTransitionError");
      expect((e as Error).message).toContain("RECEIVED");
      expect((e as Error).message).toContain("PAID");
    }
  });
});

describe("shouldReturnSeats — 좌석 환원 정책", () => {
  it("RECEIVED → CANCELED_BY_USER: 환원 true", () => {
    expect(shouldReturnSeats("RECEIVED", "CANCELED_BY_USER")).toBe(true);
  });
  it("RECEIVED → CANCELED_BY_AGENCY: 환원 true", () => {
    expect(shouldReturnSeats("RECEIVED", "CANCELED_BY_AGENCY")).toBe(true);
  });
  it("AWAITING_GROUP → CANCELED_BY_USER: 환원 true", () => {
    expect(shouldReturnSeats("AWAITING_GROUP", "CANCELED_BY_USER")).toBe(true);
  });
  it("DEPARTURE_CONFIRMED → CANCELED_BY_USER: 환원 true", () => {
    expect(
      shouldReturnSeats("DEPARTURE_CONFIRMED", "CANCELED_BY_USER")
    ).toBe(true);
  });
  it("PAID → CANCELED_BY_USER: 환원 true", () => {
    expect(shouldReturnSeats("PAID", "CANCELED_BY_USER")).toBe(true);
  });
  it("READY → CANCELED_BY_USER: 환원 true", () => {
    expect(shouldReturnSeats("READY", "CANCELED_BY_USER")).toBe(true);
  });
  it("PAID → READY: 환원 false (정방향 전이)", () => {
    expect(shouldReturnSeats("PAID", "READY")).toBe(false);
  });
  it("COMPLETED → CANCELED_BY_USER: 환원 false (terminal, 좌석 없음)", () => {
    expect(shouldReturnSeats("COMPLETED", "CANCELED_BY_USER")).toBe(false);
  });
  it("RECEIVED → DEPARTURE_CONFIRMED: 환원 false (정방향)", () => {
    expect(shouldReturnSeats("RECEIVED", "DEPARTURE_CONFIRMED")).toBe(false);
  });
});
