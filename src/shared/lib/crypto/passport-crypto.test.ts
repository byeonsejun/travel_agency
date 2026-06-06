import { describe, expect, it } from "vitest";

// NOTE: passport-crypto는 server-only 모듈이다.
// vitest는 Node 환경이므로 server-only import가 허용된다.
// (브라우저 번들 차단은 Next.js 빌드 타임에 강제됨.)
import {
  decrypt,
  ENC_PREFIX,
  encrypt,
  isEncrypted,
} from "@/shared/lib/crypto/passport-crypto";

describe("passport-crypto — AES-256-GCM 유틸", () => {
  // vitest.setup.ts에 32바이트 유효 더미 키가 주입되어 있어
  // 실제 env 모듈을 그대로 사용한다(vi.mock 불필요).

  describe("encrypt / decrypt 라운드트립", () => {
    it("encrypt → decrypt 원문 복원", () => {
      const plaintext = "AB1234567";
      const ciphertext = encrypt(plaintext);
      expect(decrypt(ciphertext)).toBe(plaintext);
    });

    it("encrypt 출력은 enc:v1: 으로 시작하고 원문과 다름", () => {
      const plaintext = "M98765432";
      const ciphertext = encrypt(plaintext);
      expect(ciphertext.startsWith(ENC_PREFIX)).toBe(true);
      expect(ciphertext).not.toBe(plaintext);
    });

    it("같은 입력을 두 번 암호화하면 서로 다른 ciphertext (랜덤 IV)", () => {
      const plaintext = "XY1111111";
      const first = encrypt(plaintext);
      const second = encrypt(plaintext);
      // 둘 다 enc:v1: prefix는 있어야 하지만
      expect(first.startsWith(ENC_PREFIX)).toBe(true);
      expect(second.startsWith(ENC_PREFIX)).toBe(true);
      // 랜덤 IV 덕분에 두 암호문은 달라야 한다
      expect(first).not.toBe(second);
    });
  });

  describe("하위 호환 — 평문 passthrough", () => {
    it("decrypt에 enc:v1: prefix 없는 평문 전달 시 그대로 반환", () => {
      const legacy = "AB9999999";
      expect(decrypt(legacy)).toBe(legacy);
    });

    it("빈 문자열도 그대로 반환 (prefix 없으면 passthrough)", () => {
      expect(decrypt("")).toBe("");
    });
  });

  describe("isEncrypted 판별", () => {
    it("enc:v1: 로 시작하는 문자열에 대해 true 반환", () => {
      const ciphertext = encrypt("TEST12345");
      expect(isEncrypted(ciphertext)).toBe(true);
    });

    it("평문에 대해 false 반환", () => {
      expect(isEncrypted("AB1234567")).toBe(false);
    });

    it("enc:v1: prefix가 정확히 맞아야 true (대소문자 등 불일치는 false)", () => {
      expect(isEncrypted("ENC:V1:abc")).toBe(false);
      expect(isEncrypted("enc:v2:abc")).toBe(false);
    });
  });

  describe("GCM 무결성 — 변조 ciphertext는 throw", () => {
    it("base64 페이로드를 변조하면 decrypt가 에러를 던짐", () => {
      const ciphertext = encrypt("TAMPER123");
      // enc:v1: 이후 base64 부분을 뒤집어서 변조
      const payload = ciphertext.slice(ENC_PREFIX.length);
      const tampered = ENC_PREFIX + payload.split("").reverse().join("");
      expect(() => decrypt(tampered)).toThrow();
    });

    it("base64 페이로드의 마지막 몇 바이트 변조도 throw", () => {
      const ciphertext = encrypt("MODIFY456");
      const payload = ciphertext.slice(ENC_PREFIX.length);
      // 마지막 4글자를 변조
      const tampered = ENC_PREFIX + payload.slice(0, -4) + "AAAA";
      expect(() => decrypt(tampered)).toThrow();
    });
  });
});
