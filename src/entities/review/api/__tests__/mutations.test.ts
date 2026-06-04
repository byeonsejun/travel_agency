import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/shared/lib/db", () => ({
  db: {
    review: {
      findUnique: mocks.findUnique,
      update: mocks.update,
    },
  },
}));

import { setReviewStatus } from "../mutations";
import { InvalidReviewTransitionError } from "../../model/transitions";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("setReviewStatus", () => {
  it("리뷰 부재 시 null 반환 + update 호출 안 함", async () => {
    mocks.findUnique.mockResolvedValue(null);

    const result = await setReviewStatus("nope", "HIDDEN");

    expect(result).toBeNull();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("잘못된 전이는 가드에서 throw + update 호출 안 함", async () => {
    // PUBLISHED → PUBLISHED 는 동일 상태 전이 (금지)
    mocks.findUnique.mockResolvedValue({
      status: "PUBLISHED",
      productId: "p1",
    });

    await expect(setReviewStatus("r1", "PUBLISHED")).rejects.toBeInstanceOf(
      InvalidReviewTransitionError,
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("유효 전이는 update 후 productId 반환", async () => {
    mocks.findUnique.mockResolvedValue({
      status: "PUBLISHED",
      productId: "p1",
    });
    mocks.update.mockResolvedValue({});

    const result = await setReviewStatus("r1", "HIDDEN");

    expect(result).toEqual({ productId: "p1" });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { status: "HIDDEN" },
    });
  });
});
