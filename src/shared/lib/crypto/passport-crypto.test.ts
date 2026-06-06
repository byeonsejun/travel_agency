import { afterEach, describe, expect, it, vi } from "vitest";

// NOTE: passport-crypto는 server-only 모듈이다.
// vitest는 Node 환경이므로 server-only import가 허용된다.
// (브라우저 번들 차단은 Next.js 빌드 타임에 강제됨.)
import {
  decrypt,
  ENC_PREFIX,
  encrypt,
  isEncrypted,
  IV_LENGTH,
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
    it("auth-tag 영역의 바이트를 뒤집으면 GCM 인증 실패로 throw", () => {
      // 진짜 GCM auth-tag 검증 실패를 검증한다(잘못된 IV/포맷 에러가 아니라).
      // 유효한 payload를 디코드 → auth-tag 첫 바이트(offset = IV_LENGTH)를
      // XOR로 1바이트 변조 → re-base64 → IV는 멀쩡하므로 setAuthTag까진 통과,
      // final()에서 태그 불일치로 인증 에러가 발생해야 한다.
      const ciphertext = encrypt("TAMPER123");
      const buf = Buffer.from(ciphertext.slice(ENC_PREFIX.length), "base64");
      buf[IV_LENGTH] ^= 0xff; // auth-tag 첫 바이트 변조
      const tampered = ENC_PREFIX + buf.toString("base64");
      // Node crypto의 GCM 인증 실패 메시지: "Unsupported state or unable to
      // authenticate data".
      expect(() => decrypt(tampered)).toThrow(/authenticate/i);
    });

    it("ciphertext 본문 바이트를 변조하면 GCM 인증 실패로 throw", () => {
      // auth-tag 자체는 그대로 두고 암호문 본문을 변조해도, GCM은 본문까지
      // 태그로 보호하므로 동일하게 인증 실패해야 한다.
      const ciphertext = encrypt("MODIFY456");
      const buf = Buffer.from(ciphertext.slice(ENC_PREFIX.length), "base64");
      const lastIndex = buf.length - 1; // ciphertext 마지막 바이트
      buf[lastIndex] ^= 0xff;
      const tampered = ENC_PREFIX + buf.toString("base64");
      expect(() => decrypt(tampered)).toThrow(/authenticate/i);
    });

    it("(malformed payload) base64 전체를 뒤집으면 잘못된 IV로 throw", () => {
      // ⚠️ 이것은 GCM 변조 테스트가 *아니다*. 전체 base64 문자열을 뒤집으면
      // 디코드 결과 자체가 깨져(IV 길이/포맷 불량) "Invalid initialization
      // vector" 류의 포맷 에러가 난다. throw 한다는 사실만 검증하는 경계 케이스.
      const ciphertext = encrypt("TAMPER123");
      const payload = ciphertext.slice(ENC_PREFIX.length);
      const tampered = ENC_PREFIX + payload.split("").reverse().join("");
      expect(() => decrypt(tampered)).toThrow();
    });

    it("base64 페이로드의 마지막 몇 글자 변조도 throw (기존 케이스 유지)", () => {
      const ciphertext = encrypt("MODIFY456");
      const payload = ciphertext.slice(ENC_PREFIX.length);
      // 마지막 4글자를 변조
      const tampered = ENC_PREFIX + payload.slice(0, -4) + "AAAA";
      expect(() => decrypt(tampered)).toThrow();
    });
  });

  describe("encrypt 멱등성 — 이미 암호화된 값은 그대로 반환", () => {
    it("encrypt(alreadyEncrypted) === alreadyEncrypted (identity passthrough)", () => {
      const plaintext = "IDEM12345";
      const ciphertext = encrypt(plaintext);
      // 이미 enc:v1: 로 시작하는 값을 다시 encrypt 하면 동일 참조가 반환되어야 함
      expect(encrypt(ciphertext)).toBe(ciphertext);
    });

    it("double-encrypt가 방지되어 decrypt(encrypt(encrypt(x))) === x", () => {
      const plaintext = "DOUBLE789";
      const once = encrypt(plaintext);
      const twice = encrypt(once); // 멱등성 가드 → once 그대로
      // twice === once 이므로 한 번만 decrypt하면 원문 복원
      expect(decrypt(twice)).toBe(plaintext);
    });
  });

  describe("키 부재/무효 — 명확한 에러 경로", () => {
    // getKey()는 모듈 메모이즈되고 env도 import 시점에 1회 parse되므로,
    // ENCRYPTION_KEY 부재 시나리오는 vi.resetModules()로 모듈 그래프를 비우고
    // 빈 키를 stub한 뒤 동적 import로 crypto/env를 새로 로드해 격리한다.
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.resetModules();
    });

    it("ENCRYPTION_KEY가 빈 값이면 encrypt가 명확한 에러로 throw", async () => {
      vi.resetModules();
      vi.stubEnv("ENCRYPTION_KEY", "");
      const fresh = await import("@/shared/lib/crypto/passport-crypto");
      expect(() => fresh.encrypt("NEEDKEY01")).toThrow(/ENCRYPTION_KEY/);
    });

    it("ENCRYPTION_KEY가 빈 값이면 decrypt(암호문)도 명확한 에러로 throw", async () => {
      // 먼저 유효한 키로 암호문을 만들어 둔다(현재 모듈은 유효 키 보유).
      const validCiphertext = encrypt("NEEDKEY02");
      vi.resetModules();
      vi.stubEnv("ENCRYPTION_KEY", "");
      const fresh = await import("@/shared/lib/crypto/passport-crypto");
      // prefix가 있으므로 passthrough가 아니라 getKey()를 거쳐 throw해야 한다.
      expect(() => fresh.decrypt(validCiphertext)).toThrow(/ENCRYPTION_KEY/);
    });
  });
});
