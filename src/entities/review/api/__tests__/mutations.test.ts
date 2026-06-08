import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  reportCreate: vi.fn(),
  reportUpdateMany: vi.fn(),
  txn: vi.fn(),
}));

vi.mock("@/shared/lib/db", () => ({
  db: {
    review: {
      findUnique: mocks.findUnique,
      update: mocks.update,
    },
    reviewReport: {
      create: mocks.reportCreate,
      updateMany: mocks.reportUpdateMany,
    },
    $transaction: mocks.txn,
  },
}));

import {
  setReviewStatus,
  createReviewReport,
  resolveReportsByHiding,
  dismissReports,
} from "../mutations";
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

describe("createReviewReport", () => {
  it("리뷰 부재 시 not_found", async () => {
    mocks.findUnique.mockResolvedValue(null);
    const r = await createReviewReport({
      reviewId: "nope",
      reporterId: "u1",
      reason: "SPAM",
    });
    expect(r).toBe("not_found");
    expect(mocks.reportCreate).not.toHaveBeenCalled();
  });

  it("본인 리뷰 신고는 self (create 안 함)", async () => {
    mocks.findUnique.mockResolvedValue({ userId: "u1" });
    const r = await createReviewReport({
      reviewId: "r1",
      reporterId: "u1",
      reason: "SPAM",
    });
    expect(r).toBe("self");
    expect(mocks.reportCreate).not.toHaveBeenCalled();
  });

  it("정상 신고는 created", async () => {
    mocks.findUnique.mockResolvedValue({ userId: "author" });
    mocks.reportCreate.mockResolvedValue({});
    const r = await createReviewReport({
      reviewId: "r1",
      reporterId: "u2",
      reason: "ABUSIVE",
      note: "욕설",
    });
    expect(r).toBe("created");
    expect(mocks.reportCreate).toHaveBeenCalledWith({
      data: {
        reviewId: "r1",
        reporterId: "u2",
        reason: "ABUSIVE",
        note: "욕설",
      },
    });
  });

  it("중복 신고(P2002)는 duplicate 로 흡수", async () => {
    mocks.findUnique.mockResolvedValue({ userId: "author" });
    const err = new Prisma.PrismaClientKnownRequestError("dup", {
      code: "P2002",
      clientVersion: "5",
    });
    mocks.reportCreate.mockRejectedValue(err);
    const r = await createReviewReport({
      reviewId: "r1",
      reporterId: "u2",
      reason: "SPAM",
    });
    expect(r).toBe("duplicate");
  });
});

describe("resolveReportsByHiding", () => {
  it("리뷰 부재 시 null", async () => {
    mocks.findUnique.mockResolvedValue(null);
    expect(await resolveReportsByHiding("nope")).toBeNull();
  });

  it("PUBLISHED 면 HIDDEN 전이 + OPEN 신고 RESOLVED 일괄 (단일 tx)", async () => {
    mocks.findUnique.mockResolvedValue({
      status: "PUBLISHED",
      productId: "p1",
    });
    mocks.txn.mockResolvedValue([]);
    const r = await resolveReportsByHiding("r1");
    expect(r).toEqual({ productId: "p1" });
    expect(mocks.txn).toHaveBeenCalledTimes(1);
  });

  it("이미 HIDDEN 이면 전이 가드 throw", async () => {
    mocks.findUnique.mockResolvedValue({ status: "HIDDEN", productId: "p1" });
    await expect(resolveReportsByHiding("r1")).rejects.toBeInstanceOf(
      InvalidReviewTransitionError,
    );
    expect(mocks.txn).not.toHaveBeenCalled();
  });
});

describe("dismissReports", () => {
  it("리뷰 부재 시 null", async () => {
    mocks.findUnique.mockResolvedValue(null);
    expect(await dismissReports("nope")).toBeNull();
  });

  it("OPEN 신고를 DISMISSED 로 일괄 변경 + status 불변", async () => {
    mocks.findUnique.mockResolvedValue({ productId: "p1" });
    mocks.reportUpdateMany.mockResolvedValue({ count: 2 });
    const r = await dismissReports("r1");
    expect(r).toEqual({ productId: "p1" });
    expect(mocks.reportUpdateMany).toHaveBeenCalledWith({
      where: { reviewId: "r1", status: "OPEN" },
      data: { status: "DISMISSED", resolvedAt: expect.any(Date) },
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
