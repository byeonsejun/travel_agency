import { createHmac } from "node:crypto";
import { describe, it, expect } from "vitest";
import { verifyTossSignature } from "../signature";

function makeSignature(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
}

const SECRET = "test-webhook-secret-32-bytes-ok!";
const RAW_BODY = JSON.stringify({ eventId: "abc123", orderId: "oid_001", type: "PAYMENT_DONE" });

describe("verifyTossSignature", () => {
  it("동일 secret + rawBody로 생성한 서명 → true", () => {
    const sig = makeSignature(RAW_BODY, SECRET);
    expect(verifyTossSignature(RAW_BODY, sig, SECRET)).toBe(true);
  });

  it("다른 secret으로 생성한 서명 → false", () => {
    const sig = makeSignature(RAW_BODY, "wrong-secret");
    expect(verifyTossSignature(RAW_BODY, sig, SECRET)).toBe(false);
  });

  it("rawBody 1바이트 변조 → false", () => {
    const sig = makeSignature(RAW_BODY, SECRET);
    const tampered = RAW_BODY.slice(0, -1) + "X";
    expect(verifyTossSignature(tampered, sig, SECRET)).toBe(false);
  });

  it("signature가 빈 문자열 → false", () => {
    expect(verifyTossSignature(RAW_BODY, "", SECRET)).toBe(false);
  });

  it("signature가 null → false", () => {
    expect(verifyTossSignature(RAW_BODY, null as unknown as string, SECRET)).toBe(false);
  });

  it("secret이 undefined → throw (운영 사고 방지)", () => {
    expect(() =>
      verifyTossSignature(RAW_BODY, "any-sig", undefined as unknown as string)
    ).toThrow();
  });
});
