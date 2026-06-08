import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createReviewReport: vi.fn(),
}));

vi.mock("@/features/auth/server/auth", () => ({ auth: mocks.auth }));
vi.mock("@/entities/review", () => ({
  createReviewReport: mocks.createReviewReport,
}));
// rate-limit 래퍼는 통과(impl 직접 호출)로 stub
vi.mock("@/shared/lib/rate-limit", () => ({
  withRateLimitAction: (
    _opts: unknown,
    impl: (...args: unknown[]) => unknown,
  ) => impl,
}));

import { reportReviewAction } from "../reportReview";

const VALID_ID = "clxreview0000000000000000";

beforeEach(() => vi.clearAllMocks());

describe("reportReviewAction", () => {
  it("비로그인은 UNAUTHENTICATED", async () => {
    mocks.auth.mockResolvedValue(null);
    const r = await reportReviewAction({ reviewId: VALID_ID, reason: "SPAM" });
    expect(r).toEqual({ ok: false, error: "UNAUTHENTICATED" });
    expect(mocks.createReviewReport).not.toHaveBeenCalled();
  });

  it("잘못된 입력은 INVALID", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    const r = await reportReviewAction({ reviewId: "bad", reason: "SPAM" });
    expect(r).toEqual({ ok: false, error: "INVALID" });
  });

  it("created → ok created", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    mocks.createReviewReport.mockResolvedValue("created");
    const r = await reportReviewAction({ reviewId: VALID_ID, reason: "ABUSIVE" });
    expect(r).toEqual({ ok: true, status: "created" });
  });

  it("duplicate → ok duplicate (멱등)", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    mocks.createReviewReport.mockResolvedValue("duplicate");
    const r = await reportReviewAction({ reviewId: VALID_ID, reason: "SPAM" });
    expect(r).toEqual({ ok: true, status: "duplicate" });
  });

  it("self → error SELF", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    mocks.createReviewReport.mockResolvedValue("self");
    const r = await reportReviewAction({ reviewId: VALID_ID, reason: "SPAM" });
    expect(r).toEqual({ ok: false, error: "SELF" });
  });

  it("not_found → error NOT_FOUND", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    mocks.createReviewReport.mockResolvedValue("not_found");
    const r = await reportReviewAction({ reviewId: VALID_ID, reason: "SPAM" });
    expect(r).toEqual({ ok: false, error: "NOT_FOUND" });
  });
});
