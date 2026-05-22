import { describe, it, expect } from "vitest";
import { maskAuthorDisplayName } from "../displayName";

describe("maskAuthorDisplayName", () => {
  describe("email 우선 마스킹 — 로컬파트 앞 3자 + ***", () => {
    it("긴 로컬파트: 'frontend@gmail.com' → 'fro***'", () => {
      expect(
        maskAuthorDisplayName({ email: "frontend@gmail.com", name: null }),
      ).toBe("fro***");
    });

    it("정확히 3자 로컬: 'abc@x.com' → 'abc***'", () => {
      expect(
        maskAuthorDisplayName({ email: "abc@x.com", name: null }),
      ).toBe("abc***");
    });

    it("2자 로컬: 'ab@x.com' → 'ab***'", () => {
      expect(
        maskAuthorDisplayName({ email: "ab@x.com", name: null }),
      ).toBe("ab***");
    });

    it("1자 로컬: 'a@x.com' → 'a***'", () => {
      expect(
        maskAuthorDisplayName({ email: "a@x.com", name: null }),
      ).toBe("a***");
    });

    it("email 이 있으면 name 은 무시 — email 우선", () => {
      expect(
        maskAuthorDisplayName({ email: "kimjihoon@x.com", name: "홍길동" }),
      ).toBe("kim***");
    });
  });

  describe("email 없음 → name 폴백", () => {
    it("일반 name: '홍길동' → '홍**'", () => {
      expect(
        maskAuthorDisplayName({ email: null, name: "홍길동" }),
      ).toBe("홍**");
    });

    it("빈 문자열 email + name 존재 → name 으로 폴백", () => {
      expect(
        maskAuthorDisplayName({ email: "", name: "Jihoon" }),
      ).toBe("J**");
    });
  });

  describe("둘 다 없음 → '익명'", () => {
    it("email null, name null → 익명", () => {
      expect(
        maskAuthorDisplayName({ email: null, name: null }),
      ).toBe("익명");
    });

    it("email 빈, name 빈 → 익명", () => {
      expect(
        maskAuthorDisplayName({ email: "", name: "" }),
      ).toBe("익명");
    });
  });
});
