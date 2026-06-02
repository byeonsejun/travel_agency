import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  setReviewStatus: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/features/auth/server/auth", () => ({ auth: mocks.auth }));
vi.mock("@/entities/review", () => ({
  setReviewStatus: mocks.setReviewStatus,
  InvalidReviewTransitionError: class extends Error {},
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { setReviewStatusAction } from "../actions";

const VALID_ID = "clxreview0000000000000000";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("setReviewStatusAction", () => {
  it("비-admin 은 거부", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1", role: "USER" } });
    const res = await setReviewStatusAction(null, {
      reviewId: VALID_ID,
      next: "HIDDEN",
    });
    expect(res.type).toBe("error");
    expect(mocks.setReviewStatus).not.toHaveBeenCalled();
  });

  it("성공 시 productId PDP + admin 경로 무효화", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    mocks.setReviewStatus.mockResolvedValue({ productId: "prod123" });
    const res = await setReviewStatusAction(null, {
      reviewId: VALID_ID,
      next: "HIDDEN",
    });
    expect(res).toEqual({ type: "success", status: "HIDDEN" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/products/prod123");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/reviews");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      `/admin/reviews/${VALID_ID}`,
    );
  });

  it("리뷰 부재(null) 시 error", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    mocks.setReviewStatus.mockResolvedValue(null);
    const res = await setReviewStatusAction(null, {
      reviewId: VALID_ID,
      next: "HIDDEN",
    });
    expect(res.type).toBe("error");
  });
});
