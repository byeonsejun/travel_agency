import { describe, it, expect } from "vitest";
import { applyRerankOrder } from "../rerankOrder";

const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
const keyOf = (x: { id: string }) => x.id;

describe("applyRerankOrder", () => {
  it("주어진 순서대로 재배열한다", () => {
    const r = applyRerankOrder(items, keyOf, ["c", "a", "b"]);
    expect(r.map(keyOf)).toEqual(["c", "a", "b"]);
  });

  it("환각 key(입력에 없는)는 폐기한다", () => {
    const r = applyRerankOrder(items, keyOf, ["c", "zzz", "a", "b"]);
    expect(r.map(keyOf)).toEqual(["c", "a", "b"]);
  });

  it("누락된 key는 원래 순서로 뒤에 append한다", () => {
    const r = applyRerankOrder(items, keyOf, ["c"]);
    expect(r.map(keyOf)).toEqual(["c", "a", "b"]);
  });

  it("중복 key는 한 번만 사용한다", () => {
    const r = applyRerankOrder(items, keyOf, ["a", "a", "b"]);
    expect(r.map(keyOf)).toEqual(["a", "b", "c"]);
  });

  it("항상 입력과 동일한 길이를 유지한다(보존성)", () => {
    expect(applyRerankOrder(items, keyOf, []).length).toBe(3);
    expect(applyRerankOrder(items, keyOf, ["x", "y"]).length).toBe(3);
  });
});
