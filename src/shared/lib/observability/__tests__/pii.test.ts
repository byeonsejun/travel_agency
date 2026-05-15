/**
 * pii.test.ts — `maskPii` 순수 함수 단위 테스트 (M-OBS Task 2)
 *
 * 검증 축:
 *  1. 민감 키 마스킹 (대소문자 무시)
 *  2. 이메일/전화/카드번호 패턴 마스킹 (문자열 값)
 *  3. 순수 함수 — 원본 mutate 금지
 *  4. 깊이 제한 + 순환 참조 안전
 *  5. primitive·null·undefined 보존
 */

import { describe, it, expect } from "vitest";
import { maskPii } from "../pii";

describe("maskPii — 민감 키 마스킹", () => {
  it("password / token / authorization / cookie 키 값을 [REDACTED]로 치환", () => {
    const out = maskPii({
      password: "p@ssw0rd",
      token: "abc.def.ghi",
      authorization: "Bearer xyz",
      cookie: "session=secret",
    });
    expect(out).toEqual({
      password: "[REDACTED]",
      token: "[REDACTED]",
      authorization: "[REDACTED]",
      cookie: "[REDACTED]",
    });
  });

  it("결제 도메인 민감 키 (tossPaymentKey / paymentKey / secret) 마스킹", () => {
    const out = maskPii({
      tossPaymentKey: "tps_xxxxxxxxxxxx",
      paymentKey: "pk_yyy",
      secret: "shh",
      TOSS_WEBHOOK_SECRET: "whsec",
    });
    expect(out).toEqual({
      tossPaymentKey: "[REDACTED]",
      paymentKey: "[REDACTED]",
      secret: "[REDACTED]",
      TOSS_WEBHOOK_SECRET: "[REDACTED]",
    });
  });

  it("키 매칭은 대소문자 무시", () => {
    const out = maskPii({
      Password: "x",
      AUTHORIZATION: "y",
      AccessToken: "z",
      refreshToken: "r",
    });
    expect(out).toEqual({
      Password: "[REDACTED]",
      AUTHORIZATION: "[REDACTED]",
      AccessToken: "[REDACTED]",
      refreshToken: "[REDACTED]",
    });
  });

  it("민감 키가 아니면 그대로 통과", () => {
    const out = maskPii({ name: "Alice", age: 30, role: "USER" });
    expect(out).toEqual({ name: "Alice", age: 30, role: "USER" });
  });
});

describe("maskPii — 문자열 값 패턴 마스킹", () => {
  it("이메일 형식 값 → 부분 마스킹", () => {
    const out = maskPii({ contact: "alice@example.com" });
    // 안전 마스킹 정책: 로컬·도메인 첫 글자만 노출
    expect(out.contact).toMatch(/^a\*+@e\*+$/);
  });

  it("한국 휴대전화(010-1234-5678 / 01012345678) → 010-****-****", () => {
    expect(maskPii({ phone: "010-1234-5678" }).phone).toBe("010-****-****");
    expect(maskPii({ phone: "01012345678" }).phone).toBe("010-****-****");
  });

  it("카드번호(16~19 연속 숫자) → [REDACTED:CARD]", () => {
    expect(maskPii({ pan: "1234567812345678" }).pan).toBe("[REDACTED:CARD]");
    expect(maskPii({ pan: "1234-5678-1234-5678" }).pan).toBe("[REDACTED:CARD]");
  });

  it("이메일을 포함한 자유 문자열도 안전 치환 — 부분 마스킹", () => {
    const out = maskPii({ note: "문의: user@nextour.test 까지 회신 바람" });
    expect(out.note).not.toContain("user@nextour.test");
    expect(out.note).toMatch(/u\*+@n\*+/);
  });

  it("일반 문자열은 변경 없음", () => {
    expect(maskPii({ msg: "hello world" })).toEqual({ msg: "hello world" });
  });
});

describe("maskPii — 중첩 객체와 배열", () => {
  it("중첩 객체 내부도 재귀 마스킹", () => {
    const out = maskPii({
      user: { id: "u1", password: "x", email: "a@b.co" },
      meta: { authorization: "Bearer t" },
    });
    expect(out.user.password).toBe("[REDACTED]");
    expect(out.user.email).toMatch(/^a\*+@b\*+$/);
    expect(out.meta.authorization).toBe("[REDACTED]");
    expect(out.user.id).toBe("u1");
  });

  it("배열 안 객체도 마스킹", () => {
    const out = maskPii({
      tokens: [{ token: "a" }, { token: "b" }],
    });
    expect(out.tokens).toEqual([
      { token: "[REDACTED]" },
      { token: "[REDACTED]" },
    ]);
  });
});

describe("maskPii — 순수 함수 (Pure Function)", () => {
  it("원본 객체를 mutate하지 않는다", () => {
    const original = {
      password: "p1",
      nested: { email: "a@b.co", arr: ["x", "y"] },
    };
    const frozen = JSON.parse(JSON.stringify(original));
    const out = maskPii(original);
    expect(original).toEqual(frozen);
    expect(out).not.toBe(original);
    expect(out.nested).not.toBe(original.nested);
    expect(out.nested.arr).not.toBe(original.nested.arr);
  });

  it("원본 배열도 mutate하지 않는다", () => {
    const arr = [{ token: "t1" }, { token: "t2" }];
    const frozen = JSON.parse(JSON.stringify(arr));
    maskPii(arr);
    expect(arr).toEqual(frozen);
  });
});

describe("maskPii — 깊이 제한 + 순환 참조", () => {
  it("maxDepth 초과 시 [MAX_DEPTH] 마커로 치환", () => {
    const deep: Record<string, unknown> = {};
    let cursor: Record<string, unknown> = deep;
    for (let i = 0; i < 10; i++) {
      cursor.next = {};
      cursor = cursor.next as Record<string, unknown>;
    }
    cursor.password = "leak";

    const out = maskPii(deep, { maxDepth: 3 }) as Record<string, unknown>;
    // 깊이 3 이내는 객체 유지, 그 너머는 [MAX_DEPTH] 마커
    const stringified = JSON.stringify(out);
    expect(stringified).toContain("[MAX_DEPTH]");
    // 누설 방지: 깊은 곳의 password 원문이 출력에 절대 포함되지 않아야 함
    expect(stringified).not.toContain("leak");
  });

  it("순환 참조 입력에서 무한 재귀 없이 [CIRCULAR] 마커 반환", () => {
    type Cyclic = { name: string; self?: Cyclic };
    const a: Cyclic = { name: "A" };
    a.self = a;

    expect(() => maskPii(a)).not.toThrow();
    const out = maskPii(a) as { name: string; self: unknown };
    expect(out.name).toBe("A");
    expect(out.self).toBe("[CIRCULAR]");
  });
});

describe("maskPii — primitive·null·undefined", () => {
  it("primitive 입력은 그대로 반환 (단, 패턴 매칭은 적용)", () => {
    expect(maskPii(42)).toBe(42);
    expect(maskPii(true)).toBe(true);
    expect(maskPii(null)).toBe(null);
    expect(maskPii(undefined)).toBe(undefined);
    expect(maskPii("hello")).toBe("hello");
    // 단독 문자열도 이메일 패턴이면 마스킹
    expect(maskPii("a@b.co")).toMatch(/^a\*+@b\*+$/);
  });

  it("빈 객체·빈 배열은 동일 형태로 반환", () => {
    expect(maskPii({})).toEqual({});
    expect(maskPii([])).toEqual([]);
  });
});
