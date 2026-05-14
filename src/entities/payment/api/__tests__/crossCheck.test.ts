import { describe, it, expect } from "vitest";
import { assertAmountMatches } from "../crossCheck";
import { PaymentError } from "../errors";

// ── 정상 케이스 ───────────────────────────────────────────────────────────────

describe("assertAmountMatches — 정상 통과", () => {
  it("정수가 일치하면 throw 없음 (request)", () => {
    expect(() => assertAmountMatches(10000, 10000, "request")).not.toThrow();
  });

  it("정수가 일치하면 throw 없음 (pg-response)", () => {
    expect(() => assertAmountMatches(10000, 10000, "pg-response")).not.toThrow();
  });

  it("10000.0은 10000과 동일 정수 → 통과 (JS 부동소수점 동등)", () => {
    // Number.isInteger(10000.0) === true in JS
    expect(() => assertAmountMatches(10000, 10000.0, "request")).not.toThrow();
  });

  it("큰 정수 금액도 통과", () => {
    expect(() => assertAmountMatches(9_900_000, 9_900_000, "pg-response")).not.toThrow();
  });
});

// ── AMOUNT_NOT_INTEGER: actual이 소수 ─────────────────────────────────────────

describe("assertAmountMatches — AMOUNT_NOT_INTEGER", () => {
  it("actual이 소수이면 AMOUNT_NOT_INTEGER throw (request)", () => {
    const err = (() => {
      try { assertAmountMatches(10000, 10000.5, "request"); }
      catch (e) { return e; }
    })();
    expect(err).toBeInstanceOf(PaymentError);
    expect((err as PaymentError).code).toBe("AMOUNT_NOT_INTEGER");
  });

  it("actual이 소수이면 AMOUNT_NOT_INTEGER throw (pg-response)", () => {
    const err = (() => {
      try { assertAmountMatches(10000, 9999.99, "pg-response"); }
      catch (e) { return e; }
    })();
    expect(err).toBeInstanceOf(PaymentError);
    expect((err as PaymentError).code).toBe("AMOUNT_NOT_INTEGER");
  });

  it("소수 throw 시 context에 actual과 source가 담긴다", () => {
    try {
      assertAmountMatches(10000, 10000.5, "request");
    } catch (e) {
      const err = e as PaymentError;
      expect(err.context?.actual).toBe(10000.5);
      expect(err.context?.source).toBe("request");
    }
  });
});

// ── AMOUNT_MISMATCH_REQUEST: source = "request" ───────────────────────────────

describe("assertAmountMatches — AMOUNT_MISMATCH_REQUEST", () => {
  it("정수끼리 불일치 → AMOUNT_MISMATCH_REQUEST", () => {
    const err = (() => {
      try { assertAmountMatches(10000, 9999, "request"); }
      catch (e) { return e; }
    })();
    expect(err).toBeInstanceOf(PaymentError);
    expect((err as PaymentError).code).toBe("AMOUNT_MISMATCH_REQUEST");
  });

  it("context에 expected·actual·source가 담긴다", () => {
    try {
      assertAmountMatches(10000, 9999, "request");
    } catch (e) {
      const err = e as PaymentError;
      expect(err.context?.expected).toBe(10000);
      expect(err.context?.actual).toBe(9999);
      expect(err.context?.source).toBe("request");
    }
  });

  it("actual이 expected보다 크면 (조작 시나리오)도 AMOUNT_MISMATCH_REQUEST", () => {
    const err = (() => {
      try { assertAmountMatches(10000, 10001, "request"); }
      catch (e) { return e; }
    })();
    expect((err as PaymentError).code).toBe("AMOUNT_MISMATCH_REQUEST");
  });
});

// ── AMOUNT_MISMATCH_PG_RESPONSE: source = "pg-response" ─────────────────────

describe("assertAmountMatches — AMOUNT_MISMATCH_PG_RESPONSE", () => {
  it("PG 응답 금액 불일치 → AMOUNT_MISMATCH_PG_RESPONSE", () => {
    const err = (() => {
      try { assertAmountMatches(10000, 9999, "pg-response"); }
      catch (e) { return e; }
    })();
    expect(err).toBeInstanceOf(PaymentError);
    expect((err as PaymentError).code).toBe("AMOUNT_MISMATCH_PG_RESPONSE");
  });

  it("amount-tamper 시나리오: PG가 +1 응답 → AMOUNT_MISMATCH_PG_RESPONSE", () => {
    // mock-toss-server의 amount-tamper 시나리오와 동일 조건
    const err = (() => {
      try { assertAmountMatches(10000, 10001, "pg-response"); }
      catch (e) { return e; }
    })();
    expect((err as PaymentError).code).toBe("AMOUNT_MISMATCH_PG_RESPONSE");
  });

  it("context에 expected·actual·source가 담긴다", () => {
    try {
      assertAmountMatches(10000, 9999, "pg-response");
    } catch (e) {
      const err = e as PaymentError;
      expect(err.context?.expected).toBe(10000);
      expect(err.context?.actual).toBe(9999);
      expect(err.context?.source).toBe("pg-response");
    }
  });
});
