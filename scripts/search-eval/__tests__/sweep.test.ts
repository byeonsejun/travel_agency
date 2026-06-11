import { describe, it, expect } from "vitest";
import { simplexGrid } from "../run-eval";

describe("simplexGrid", () => {
  it("step 0.1 → 합 1.0인 4-tuple 286개", () => {
    const grid = [...simplexGrid(0.1)];
    expect(grid).toHaveLength(286); // C(13,3)
  });

  it("모든 조합의 가중치 합은 1.0", () => {
    for (const w of simplexGrid(0.1)) {
      const sum = w.vector + w.keyword + w.geo + w.theme;
      expect(sum).toBeCloseTo(1.0, 9);
    }
  });

  it("운영 가중치(0.5/0.2/0.2/0.1)를 포함한다", () => {
    const grid = [...simplexGrid(0.1)];
    const has = grid.some(
      (w) => w.vector === 0.5 && w.keyword === 0.2 && w.geo === 0.2 && w.theme === 0.1,
    );
    expect(has).toBe(true);
  });
});
