import { describe, it, expect } from "vitest";
import { buildOrderId, parseBookingIdFromOrderId } from "../orderId";

// 실제 cuid 형태의 bookingId 픽스처
const BK = "clx7abc123def456ghi789jkl";

// ── buildOrderId ──────────────────────────────────────────────────────────────

describe("buildOrderId", () => {
  it("bookingId + __ + seq 형식으로 생성된다", () => {
    expect(buildOrderId(BK, 1)).toBe(`${BK}__1`);
  });

  it("seq가 1보다 큰 경우도 올바르게 생성된다", () => {
    expect(buildOrderId(BK, 7)).toBe(`${BK}__7`);
  });

  it("seq가 두 자리여도 올바르게 생성된다", () => {
    expect(buildOrderId(BK, 12)).toBe(`${BK}__12`);
  });

  it("생성된 orderId가 64자 이내다", () => {
    const orderId = buildOrderId(BK, 1);
    expect(orderId.length).toBeLessThanOrEqual(64);
  });

  it("bookingId가 60자일 때 seq 1자리면 64자 이내 통과", () => {
    const longId = "a".repeat(60);
    expect(() => buildOrderId(longId, 1)).not.toThrow();
    expect(buildOrderId(longId, 1).length).toBeLessThanOrEqual(64);
  });

  it("결과가 64자를 초과하면 throw", () => {
    const tooLong = "a".repeat(62); // 62 + 2("__") + 1("1") = 65
    expect(() => buildOrderId(tooLong, 1)).toThrow();
  });

  it("seq가 0이면 throw", () => {
    expect(() => buildOrderId(BK, 0)).toThrow();
  });

  it("seq가 음수이면 throw", () => {
    expect(() => buildOrderId(BK, -1)).toThrow();
  });

  it("seq가 소수이면 throw", () => {
    expect(() => buildOrderId(BK, 1.5)).toThrow();
  });
});

// ── parseBookingIdFromOrderId ─────────────────────────────────────────────────

describe("parseBookingIdFromOrderId", () => {
  it("__1 suffix → bookingId 반환", () => {
    expect(parseBookingIdFromOrderId(`${BK}__1`)).toBe(BK);
  });

  it("__7 suffix → 동일 bookingId 반환 (seq 무관)", () => {
    expect(parseBookingIdFromOrderId(`${BK}__7`)).toBe(BK);
  });

  it("__12 suffix → 동일 bookingId 반환", () => {
    expect(parseBookingIdFromOrderId(`${BK}__12`)).toBe(BK);
  });

  // ── 라운드트립 ───────────────────────────────────────────────────────────────

  it("encode → decode 라운드트립이 원본과 일치한다", () => {
    for (const seq of [1, 3, 7, 10]) {
      const orderId = buildOrderId(BK, seq);
      expect(parseBookingIdFromOrderId(orderId)).toBe(BK);
    }
  });

  // ── 잘못된 형식 거부 ──────────────────────────────────────────────────────────

  it('"xxx" → throw (구분자 없음)', () => {
    expect(() => parseBookingIdFromOrderId("xxx")).toThrow();
  });

  it('"xxx__" → throw (seq 없음)', () => {
    expect(() => parseBookingIdFromOrderId("xxx__")).toThrow();
  });

  it('"xxx__0" → throw (seq는 1 이상)', () => {
    expect(() => parseBookingIdFromOrderId("xxx__0")).toThrow();
  });

  it('"xxx__abc" → throw (seq가 숫자 아님)', () => {
    expect(() => parseBookingIdFromOrderId("xxx__abc")).toThrow();
  });

  it('"xxx__-1" → throw (음수 seq)', () => {
    expect(() => parseBookingIdFromOrderId("xxx__-1")).toThrow();
  });
});
