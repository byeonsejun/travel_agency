import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/shared/lib/db", () => ({
  db: { review: { findMany: mocks.findMany } },
}));

import { listReviewsByProduct } from "../queries";

beforeEach(() => vi.clearAllMocks());

const row = {
  id: "r1",
  rating: 5,
  content: "좋아요",
  createdAt: new Date(),
  userId: "author1",
  user: { name: "홍길동", email: "h@test.com", image: null },
  photos: [],
};

describe("listReviewsByProduct isOwn", () => {
  it("viewerId 가 작성자와 같으면 isOwn true", async () => {
    mocks.findMany.mockResolvedValue([row]);
    const page = await listReviewsByProduct("p1", { viewerId: "author1" });
    expect(page.items[0].isOwn).toBe(true);
  });

  it("viewerId 미전달이면 isOwn false", async () => {
    mocks.findMany.mockResolvedValue([row]);
    const page = await listReviewsByProduct("p1", {});
    expect(page.items[0].isOwn).toBe(false);
  });
});
