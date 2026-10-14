import { describe, expect, it } from "vitest";
import { parseGaClientId } from "../gaClientId";

describe("parseGaClientId", () => {
  it("_ga 쿠키(GA1.1.<rand>.<ts>) → client_id(<rand>.<ts>)", () => {
    expect(parseGaClientId("GA1.1.123456789.1700000000")).toBe("123456789.1700000000");
  });

  it("도메인 레벨이 다른 쿠키(GA1.2.*)도 파싱", () => {
    expect(parseGaClientId("GA1.2.987654321.1710000000")).toBe("987654321.1710000000");
  });

  it("형식이 깨졌거나 비어있으면 null", () => {
    expect(parseGaClientId(undefined)).toBeNull();
    expect(parseGaClientId("")).toBeNull();
    expect(parseGaClientId("garbage")).toBeNull();
    expect(parseGaClientId("GA1.1.abc.def")).toBeNull();
    expect(parseGaClientId("GA1.1.123456789")).toBeNull();
  });
});
