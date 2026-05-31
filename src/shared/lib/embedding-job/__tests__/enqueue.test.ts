import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EmbeddingJobStatus } from "@prisma/client";

// ── Prisma TransactionClient mock ──────────────────────────────────────────
// enqueueProductEmbeddingJob은 tx 인자를 직접 받으므로, db.$transaction 래핑 없이
// mocks.tx를 직접 주입한다 (checkout actions.test.ts 패턴 동일).
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

// db mock: Task 6에서 "모든 DB 호출은 tx를 통해야 한다"를 검증하기 위해 분리.
vi.mock("@/shared/lib/db", () => ({ db: mocks.db }));

import { enqueueProductEmbeddingJob } from "../enqueue";

// ── 픽스처 ─────────────────────────────────────────────────────────────────
const PRODUCT_ID = "clprod00000000000000001";
const ACTOR = "admin:cluser0000000000001";

// 상태별 기존 job 픽스처 팩토리
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
    // create / update 기본 반환값 (void 함수에서 사용하지 않지만 mock 완성도)
    mocks.tx.embeddingJob.create.mockResolvedValue({ id: "cljob_new" });
    mocks.tx.embeddingJob.update.mockResolvedValue({ id: "cljob_updated" });
  });

  // ── Case 1: 기존 job 없음 → PENDING 신규 생성 ──────────────────────────
  it("기존 job 없음 → PENDING row를 신규 생성한다", async () => {
    mocks.tx.embeddingJob.findFirst.mockResolvedValue(null);

    await enqueueProductEmbeddingJob(
      mocks.tx as never,
      PRODUCT_ID,
      ACTOR,
    );

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

  // ── Case 2: 기존 PENDING → no-op ───────────────────────────────────────
  it("기존 PENDING job이 있으면 create/update 모두 호출하지 않는다 (멱등)", async () => {
    mocks.tx.embeddingJob.findFirst.mockResolvedValue(makeJob("PENDING"));

    await enqueueProductEmbeddingJob(
      mocks.tx as never,
      PRODUCT_ID,
      ACTOR,
    );

    expect(mocks.tx.embeddingJob.create).not.toHaveBeenCalled();
    expect(mocks.tx.embeddingJob.update).not.toHaveBeenCalled();
  });

  // ── Case 3: 기존 IN_PROGRESS → 새 PENDING 생성 (진행 중인 row 불변) ────
  it("기존 IN_PROGRESS job이 있으면 새 PENDING row를 생성하고 기존 row는 수정하지 않는다", async () => {
    mocks.tx.embeddingJob.findFirst.mockResolvedValue(makeJob("IN_PROGRESS"));

    await enqueueProductEmbeddingJob(
      mocks.tx as never,
      PRODUCT_ID,
      ACTOR,
    );

    expect(mocks.tx.embeddingJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        productId: PRODUCT_ID,
        status: "PENDING",
        actor: ACTOR,
        attempts: 0,
      }),
    });
    // IN_PROGRESS 행은 건드리지 않는다
    expect(mocks.tx.embeddingJob.update).not.toHaveBeenCalled();
  });

  // ── Case 4: 기존 FAILED → in-place PENDING 전환 (attempts/lastError 보존) ─
  it("기존 FAILED job은 in-place로 PENDING 전환하고 attempts·lastError는 보존한다", async () => {
    const failedJob = makeJob("FAILED");
    mocks.tx.embeddingJob.findFirst.mockResolvedValue(failedJob);

    const before = new Date();
    await enqueueProductEmbeddingJob(
      mocks.tx as never,
      PRODUCT_ID,
      ACTOR,
    );
    const after = new Date();

    // update 호출 — status, nextRunAt, actor만 갱신
    expect(mocks.tx.embeddingJob.update).toHaveBeenCalledTimes(1);
    const updateCall = mocks.tx.embeddingJob.update.mock.calls[0][0];

    expect(updateCall.where).toEqual({ id: failedJob.id });
    expect(updateCall.data.status).toBe("PENDING");
    expect(updateCall.data.actor).toBe(ACTOR);

    // nextRunAt이 현재 시각 근방 (±2s 허용)
    const nextRunAt: Date = updateCall.data.nextRunAt;
    expect(nextRunAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 100);
    expect(nextRunAt.getTime()).toBeLessThanOrEqual(after.getTime() + 100);

    // attempts와 lastError는 갱신하지 않는다 (이력 보존)
    expect(updateCall.data.attempts).toBeUndefined();
    expect(updateCall.data.lastError).toBeUndefined();

    // create는 호출하지 않는다
    expect(mocks.tx.embeddingJob.create).not.toHaveBeenCalled();
  });

  // ── Case 5: 기존 SUCCEEDED → 새 PENDING 생성 (완료 row 불변) ──────────
  it("기존 SUCCEEDED job이 있으면 새 PENDING row를 생성하고 기존 row는 수정하지 않는다", async () => {
    mocks.tx.embeddingJob.findFirst.mockResolvedValue(makeJob("SUCCEEDED"));

    await enqueueProductEmbeddingJob(
      mocks.tx as never,
      PRODUCT_ID,
      ACTOR,
    );

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

  // ── Case 6: tx 인자 사용 검증 — db.embeddingJob은 절대 호출되지 않는다 ──
  it("모든 DB 호출은 tx를 통해 이루어지며 db.embeddingJob은 호출되지 않는다", async () => {
    mocks.tx.embeddingJob.findFirst.mockResolvedValue(null);

    await enqueueProductEmbeddingJob(
      mocks.tx as never,
      PRODUCT_ID,
      ACTOR,
    );

    expect(mocks.db.embeddingJob.findFirst).not.toHaveBeenCalled();
    expect(mocks.db.embeddingJob.create).not.toHaveBeenCalled();
    expect(mocks.db.embeddingJob.update).not.toHaveBeenCalled();
  });
});
