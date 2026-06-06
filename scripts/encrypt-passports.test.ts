import { describe, it, expect } from "vitest";
import { decrypt, encrypt, isEncrypted } from "@/shared/lib/crypto";
import { planEncryption } from "./encrypt-passports";

// 실제 crypto 모듈 사용 (vitest.setup의 ENCRYPTION_KEY 더미 키). DB는 띄우지 않고
// 순수 헬퍼 planEncryption의 멱등·null 처리·평문→암호화 전환만 검증한다.
describe("planEncryption (백필 순수 헬퍼)", () => {
  it("평문 row는 선택되고, 암호값이 원문으로 복호화된다", () => {
    const plan = planEncryption([{ id: "p1", passportNo: "M12345678" }]);

    expect(plan).toHaveLength(1);
    expect(plan[0].id).toBe("p1");
    expect(isEncrypted(plan[0].encrypted)).toBe(true);
    expect(decrypt(plan[0].encrypted)).toBe("M12345678");
  });

  it("이미 암호화된(enc:v1:) row는 스킵된다 (멱등 — 2회차 no-op)", () => {
    const already = encrypt("M12345678");
    const plan = planEncryption([{ id: "p1", passportNo: already }]);

    expect(plan).toHaveLength(0);
  });

  it("passportNo가 null인 row는 스킵된다", () => {
    const plan = planEncryption([{ id: "p1", passportNo: null }]);

    expect(plan).toHaveLength(0);
  });

  it("passportNo가 빈 문자열(손상 row)이면 스킵된다 (corrupt 값 launder 방지)", () => {
    const plan = planEncryption([
      { id: "p1", passportNo: "" },
      { id: "p2", passportNo: "   " },
    ]);

    expect(plan).toHaveLength(0);
  });

  it("혼합 배치 — 평문 row만 출력되고 개수가 정확하다", () => {
    const already = encrypt("E00000000");
    const plan = planEncryption([
      { id: "plain1", passportNo: "M11111111" },
      { id: "enc1", passportNo: already },
      { id: "null1", passportNo: null },
      { id: "plain2", passportNo: "M22222222" },
    ]);

    expect(plan.map((r) => r.id).sort()).toEqual(["plain1", "plain2"]);
    expect(plan.every((r) => isEncrypted(r.encrypted))).toBe(true);
    const byId = new Map(plan.map((r) => [r.id, r.encrypted]));
    expect(decrypt(byId.get("plain1")!)).toBe("M11111111");
    expect(decrypt(byId.get("plain2")!)).toBe("M22222222");
  });

  it("이미 백필된 배치를 다시 돌리면 0건 (전체 멱등)", () => {
    const rows = [
      { id: "p1", passportNo: "M11111111" },
      { id: "p2", passportNo: "M22222222" },
    ];
    const first = planEncryption(rows);
    expect(first).toHaveLength(2);

    // 1차 결과를 DB에 반영했다고 가정한 상태(암호값으로 교체)에서 재실행
    const afterFirst = rows.map((r) => {
      const enc = first.find((f) => f.id === r.id)!.encrypted;
      return { id: r.id, passportNo: enc };
    });
    const second = planEncryption(afterFirst);
    expect(second).toHaveLength(0);
  });
});
