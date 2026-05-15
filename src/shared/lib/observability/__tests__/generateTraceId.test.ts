/**
 * generateTraceId.test.ts — Trace ID 발급기 단위 테스트 (M-OBS Task 4)
 *
 * 검증 축:
 *  1. 형식: 16자 소문자 hex
 *  2. 고유성 sanity (100회 연속 호출)
 *  3. isValidTraceId: 올바른 형식만 통과
 *  4. generateTraceId() 결과가 isValidTraceId를 통과
 */

import { describe, it, expect } from "vitest";
import { generateTraceId, isValidTraceId } from "../generateTraceId";

describe("generateTraceId", () => {
  it("16자 소문자 hex 문자열을 반환한다", () => {
    const id = generateTraceId();
    expect(id).toHaveLength(16);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("100회 연속 호출 시 모두 고유한 값을 반환한다 (sanity)", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateTraceId()));
    expect(ids.size).toBe(100);
  });

  it("생성된 ID에 하이픈이 포함되지 않는다", () => {
    const id = generateTraceId();
    expect(id).not.toContain("-");
  });
});

describe("isValidTraceId", () => {
  it("16자 소문자 hex는 valid", () => {
    expect(isValidTraceId("abcdef0123456789")).toBe(true);
    expect(isValidTraceId("0000000000000000")).toBe(true);
    expect(isValidTraceId("ffffffffffffffff")).toBe(true);
  });

  it("대문자 hex는 invalid", () => {
    expect(isValidTraceId("ABCDEF0123456789")).toBe(false);
    expect(isValidTraceId("Abcdef0123456789")).toBe(false);
  });

  it("15자는 invalid (너무 짧음)", () => {
    expect(isValidTraceId("abcdef012345678")).toBe(false);
  });

  it("17자는 invalid (너무 김)", () => {
    expect(isValidTraceId("abcdef01234567890")).toBe(false);
  });

  it("hex 외 문자(하이픈·공백)는 invalid", () => {
    expect(isValidTraceId("abcdef01-2345678")).toBe(false);
    expect(isValidTraceId("abcdef01 2345678")).toBe(false);
  });

  it("빈 문자열은 invalid", () => {
    expect(isValidTraceId("")).toBe(false);
  });

  it("generateTraceId() 결과는 isValidTraceId를 통과한다", () => {
    for (let i = 0; i < 10; i++) {
      expect(isValidTraceId(generateTraceId())).toBe(true);
    }
  });
});
