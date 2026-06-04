import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EmbeddingJobStatus, Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  db: {
    embeddingJob: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
  tx: {
    embeddingJob: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// db는 별도 mock으로 두고, "모든 DB 호출은 tx를 통한다"를 회귀 가드로 검증한다 (Case 6).
vi.mock("@/shared/lib/db", () => ({ db: mocks.db }));

import { enqueueProductEmbeddingJob } from "../enqueue";

// `as unknown as Prisma.TransactionClient`는 시그니처 변경 시 mock 타입과의 mismatch를
// 컴파일러가 드러낼 수 있어 `as never`보다 안전하다.
const tx = mocks.tx as unknown as Prisma.TransactionClient;

const PRODUCT_ID = "clprod00000000000000001";
const ACTOR = "admin:cluser0000000000001";

function makeJob(
  status: EmbeddingJobStatus,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "cljob000000000000000001",
    productId: PRODUCT_ID,
    status,
    attempts: 2,
    lastError: status === "FAILED" ? "OpenAI timeout" : null,
    nextRunAt: new Date("2026-01-01T00:00:00Z"),
    actor: "admin:prev",
    ...overrides,
  };
}

describe("enqueueProductEmbeddingJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tx.embeddingJob.create.mockResolvedValue({ id: "cljob_new" });
    mocks.tx.embeddingJob.update.mockResolvedValue({ id: "cljob_updated" });
  });

  it("기존 job 없음 → PENDING row를 신규 생성한다", async () => {
    mocks.tx.embeddingJob.findFirst.mockResolvedValue(null);

    await enqueueProductEmbeddingJob(tx, PRODUCT_ID, ACTOR);

    expect(mocks.tx.embeddingJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        productId: PRODUCT_ID,
        status: "PENDING",
        actor: ACTOR,
        attempts: 0,
      }),
    });
    expect(mocks.tx.embeddingJob.update).not.toHaveBeenCalled();
  });

  it("기존 PENDING job이 있으면 create/update 모두 호출하지 않는다 (멱등)", async () => {
    mocks.tx.embeddingJob.findFirst.mockResolvedValue(makeJob("PENDING"));

    await enqueueProductEmbeddingJob(tx, PRODUCT_ID, ACTOR);

    expect(mocks.tx.embeddingJob.create).not.toHaveBeenCalled();
    expect(mocks.tx.embeddingJob.update).not.toHaveBeenCalled();
  });

  it("기존 IN_PROGRESS job이 있으면 새 PENDING row를 생성하고 기존 row는 수정하지 않는다", async () => {
    mocks.tx.embeddingJob.findFirst.mockResolvedValue(makeJob("IN_PROGRESS"));

    await enqueueProductEmbeddingJob(tx, PRODUCT_ID, ACTOR);

    expect(mocks.tx.embeddingJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        productId: PRODUCT_ID,
        status: "PENDING",
        actor: ACTOR,
        attempts: 0,
      }),
    });
    expect(mocks.tx.embeddingJob.update).not.toHaveBeenCalled();
  });

  it("기존 FAILED job은 in-place로 PENDING 전환하고 attempts·lastError는 보존한다", async () => {
    const failedJob = makeJob("FAILED");
    mocks.tx.embeddingJob.findFirst.mockResolvedValue(failedJob);

    const before = new Date();
    await enqueueProductEmbeddingJob(tx, PRODUCT_ID, ACTOR);
    const after = new Date();

    expect(mocks.tx.embeddingJob.update).toHaveBeenCalledTimes(1);
    const updateCall = mocks.tx.embeddingJob.update.mock.calls[0][0];

    expect(updateCall.where).toEqual({ id: failedJob.id });
    expect(updateCall.data.status).toBe("PENDING");
    expect(updateCall.data.actor).toBe(ACTOR);

    const nextRunAt: Date = updateCall.data.nextRunAt;
    expect(nextRunAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 100);
    expect(nextRunAt.getTime()).toBeLessThanOrEqual(after.getTime() + 100);

    // attempts/lastError는 worker가 기록한 이력 — enqueue가 덮어쓰면 안 됨.
    expect(updateCall.data.attempts).toBeUndefined();
    expect(updateCall.data.lastError).toBeUndefined();

    expect(mocks.tx.embeddingJob.create).not.toHaveBeenCalled();
  });

  it("기존 SUCCEEDED job이 있으면 새 PENDING row를 생성하고 기존 row는 수정하지 않는다", async () => {
    mocks.tx.embeddingJob.findFirst.mockResolvedValue(makeJob("SUCCEEDED"));

    await enqueueProductEmbeddingJob(tx, PRODUCT_ID, ACTOR);

    expect(mocks.tx.embeddingJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        productId: PRODUCT_ID,
        status: "PENDING",
        actor: ACTOR,
        attempts: 0,
      }),
    });
    expect(mocks.tx.embeddingJob.update).not.toHaveBeenCalled();
  });

  it("모든 DB 호출은 tx를 통해 이루어지며 db.embeddingJob은 호출되지 않는다", async () => {
    mocks.tx.embeddingJob.findFirst.mockResolvedValue(null);

    await enqueueProductEmbeddingJob(tx, PRODUCT_ID, ACTOR);

    expect(mocks.db.embeddingJob.findFirst).not.toHaveBeenCalled();
    expect(mocks.db.embeddingJob.create).not.toHaveBeenCalled();
    expect(mocks.db.embeddingJob.update).not.toHaveBeenCalled();
  });
});
