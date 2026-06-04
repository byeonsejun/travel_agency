/**
 * worker.test.ts — processEmbeddingJobBatch TDD (B3 Task 4)
 *
 * 3-layer 멱등성 보장:
 *  L1: CAS claim (updateMany with status check) — TOCTOU 차단
 *  L2: contentHash 비교 — 불필요한 OpenAI 호출 skip
 *  L3: ON CONFLICT upsert — 중복 ProductEmbedding 행 차단
 *
 * 외부 IO(provider.embed)는 반드시 DB Tx 바깥 (ADR-0003).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Prisma } from "@prisma/client";

// ── vi.hoisted: mock factory보다 먼저 실행 보장 ──────────────────────────────
const mocks = vi.hoisted(() => {
  const embeddingJobMock = {
    findMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
  };
  const productMock = {
    findUnique: vi.fn(),
  };
  const productEmbeddingMock = {
    findUnique: vi.fn(),
    update: vi.fn(),
  };

  return {
    embeddingJob: embeddingJobMock,
    product: productMock,
    productEmbedding: productEmbeddingMock,
    // $transaction: CAS claim에 사용
    $transaction: vi.fn(),
    // $executeRaw: pgvector upsert에 사용
    $executeRaw: vi.fn(),
    // 내부 tx client (claim 전용)
    txEmbeddingJob: {
      updateMany: vi.fn(),
    },
    // provider
    provider: {
      modelVersion: "openai:text-embedding-3-small:1536",
      embed: vi.fn(),
    },
  };
});

// db mock
vi.mock("@/shared/lib/db", () => ({
  db: {
    embeddingJob: mocks.embeddingJob,
    product: mocks.product,
    productEmbedding: mocks.productEmbedding,
    $transaction: mocks.$transaction,
    $executeRaw: mocks.$executeRaw,
  },
}));

// Prisma mock — sql tagged template은 그냥 통과
vi.mock("@prisma/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@prisma/client")>();
  return {
    ...actual,
    Prisma: {
      ...actual.Prisma,
      sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    },
  };
});

// embedding provider mock
vi.mock("@/shared/lib/embedding", () => ({
  getEmbeddingProvider: vi.fn(() => mocks.provider),
  EMBEDDING_DIM: 1536,
}));

// entities/product buildEmbeddingText mock
vi.mock("@/entities/product", () => ({
  buildEmbeddingText: vi.fn(() => ({
    text: "제주도 3박4일 힐링 패키지",
    contentHash: "abc123def456",
  })),
}));

// ── 모듈 import (mock 설정 후) ────────────────────────────────────────────────
import { processEmbeddingJobBatch } from "../worker";

// ── 픽스처 ────────────────────────────────────────────────────────────────────
const JOB_ID = "cljob000000000000000001";
const JOB_ID_2 = "cljob000000000000000002";
const PRODUCT_ID = "clprod00000000000000001";
const PRODUCT_ID_2 = "clprod00000000000000002";
const MODEL_VERSION = "openai:text-embedding-3-small:1536";
const CONTENT_HASH = "abc123def456";
const CONTENT_HASH_OLD = "oldHash0000000000000001";
const FAKE_VEC = Array.from({ length: 1536 }, (_, i) => i * 0.001);

function makeJob(
  id = JOB_ID,
  productId = PRODUCT_ID,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    productId,
    status: "PENDING" as const,
    attempts: 0,
    lastError: null,
    nextRunAt: new Date("2026-01-01T00:00:00Z"),
    actor: "system:cron",
    contentHash: null,
    version: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeProduct(id = PRODUCT_ID) {
  return {
    id,
    title: "제주도 3박4일 힐링 패키지",
    summary: "에메랄드 바다와 한라산의 조화",
    destination: "제주도",
    status: "PUBLISHED" as const,
    tags: [{ tag: "힐링" }, { tag: "자연" }],
    inclusions: [],
    itineraryDays: [],
    heroImageUrl: null,
    basePriceAdult: 590000,
    destinationCode: "KR-JEJ",
    durationNights: 3,
    durationDays: 4,
    aiSummary: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function makeProductEmbedding(
  overrides: Record<string, unknown> = {},
) {
  return {
    productId: PRODUCT_ID,
    modelVersion: MODEL_VERSION,
    contentHash: CONTENT_HASH,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

// CAS claim 헬퍼: $transaction이 claimEmbeddingJob을 호출할 때 tx를 주입
function setupClaimSuccess() {
  mocks.$transaction.mockImplementation(
    async (fn: (tx: Prisma.TransactionClient) => Promise<boolean>) => {
      const txClient = {
        embeddingJob: { updateMany: mocks.txEmbeddingJob.updateMany },
      } as unknown as Prisma.TransactionClient;
      mocks.txEmbeddingJob.updateMany.mockResolvedValue({ count: 1 });
      return fn(txClient);
    },
  );
}

function setupClaimFail() {
  mocks.$transaction.mockImplementation(
    async (fn: (tx: Prisma.TransactionClient) => Promise<boolean>) => {
      const txClient = {
        embeddingJob: { updateMany: mocks.txEmbeddingJob.updateMany },
      } as unknown as Prisma.TransactionClient;
      mocks.txEmbeddingJob.updateMany.mockResolvedValue({ count: 0 });
      return fn(txClient);
    },
  );
}

// ── 테스트 ────────────────────────────────────────────────────────────────────
describe("processEmbeddingJobBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // $executeRaw는 기본 성공
    mocks.$executeRaw.mockResolvedValue(1);
    // embeddingJob.update 기본 성공
    mocks.embeddingJob.update.mockResolvedValue({});
    // embeddingJob.findUniqueOrThrow 기본값 — 개별 테스트에서 overrides
    mocks.embeddingJob.findUniqueOrThrow.mockResolvedValue({
      attempts: 0,
      productId: PRODUCT_ID,
    });
    // productEmbedding.update 기본 성공
    mocks.productEmbedding.update.mockResolvedValue({});
    // provider.embed 기본 성공 (1536-dim 벡터)
    mocks.provider.embed.mockResolvedValue(FAKE_VEC);
  });

  // ── Case 1: due jobs 없음 ──────────────────────────────────────────────────
  it("due jobs가 없으면 즉시 0,0,0,0을 반환하고 provider를 호출하지 않는다", async () => {
    mocks.embeddingJob.findMany.mockResolvedValue([]);

    const result = await processEmbeddingJobBatch({ limit: 5 });

    expect(result).toEqual({ processed: 0, succeeded: 0, failed: 0, skipped: 0 });
    expect(mocks.provider.embed).not.toHaveBeenCalled();
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  // ── Case 2: limit 전달 검증 ────────────────────────────────────────────────
  it("limit 인수를 listDueEmbeddingJobs에 그대로 전달한다", async () => {
    mocks.embeddingJob.findMany.mockResolvedValue([]);

    await processEmbeddingJobBatch({ limit: 7 });

    expect(mocks.embeddingJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 7 }),
    );
  });

  // ── Case 3: CAS claim 경합 (not_claimable) ────────────────────────────────
  it("CAS claim에서 count=0이면 skipped 카운트를 올리고 provider를 호출하지 않는다", async () => {
    mocks.embeddingJob.findMany.mockResolvedValue([makeJob()]);
    setupClaimFail();

    const result = await processEmbeddingJobBatch({ limit: 5 });

    // processed=1 (시도했음), skipped=1 (claim 실패)
    expect(result).toEqual({ processed: 1, succeeded: 0, failed: 0, skipped: 1 });
    expect(mocks.provider.embed).not.toHaveBeenCalled();
  });

  // ── Case 4: contentHash 일치 → provider skip ──────────────────────────────
  it("contentHash 일치 시 provider.embed를 호출하지 않고 SUCCEEDED + skipped++", async () => {
    mocks.embeddingJob.findMany.mockResolvedValue([makeJob()]);
    setupClaimSuccess();
    mocks.product.findUnique.mockResolvedValue(makeProduct());
    // ProductEmbedding: modelVersion 일치 + contentHash 일치
    mocks.productEmbedding.findUnique.mockResolvedValue(
      makeProductEmbedding({ modelVersion: MODEL_VERSION, contentHash: CONTENT_HASH }),
    );

    const result = await processEmbeddingJobBatch({ limit: 5 });

    expect(result).toEqual({ processed: 1, succeeded: 0, failed: 0, skipped: 1 });
    expect(mocks.provider.embed).not.toHaveBeenCalled();
    // ProductEmbedding.updatedAt만 갱신
    expect(mocks.productEmbedding.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productId: PRODUCT_ID },
        data: expect.objectContaining({ updatedAt: expect.any(Date) }),
      }),
    );
    // job SUCCEEDED
    expect(mocks.embeddingJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: JOB_ID },
        data: expect.objectContaining({ status: "SUCCEEDED" }),
      }),
    );
  });

  // ── Case 5: contentHash 변경 → provider 호출 + upsert ────────────────────
  it("contentHash 변경 시 provider.embed를 호출하고 upsert 후 SUCCEEDED + succeeded++", async () => {
    mocks.embeddingJob.findMany.mockResolvedValue([makeJob()]);
    setupClaimSuccess();
    mocks.product.findUnique.mockResolvedValue(makeProduct());
    // contentHash가 다름
    mocks.productEmbedding.findUnique.mockResolvedValue(
      makeProductEmbedding({ modelVersion: MODEL_VERSION, contentHash: CONTENT_HASH_OLD }),
    );

    const result = await processEmbeddingJobBatch({ limit: 5 });

    expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0, skipped: 0 });
    expect(mocks.provider.embed).toHaveBeenCalledOnce();
    expect(mocks.$executeRaw).toHaveBeenCalledOnce(); // pgvector upsert
    expect(mocks.embeddingJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: JOB_ID },
        data: expect.objectContaining({ status: "SUCCEEDED" }),
      }),
    );
  });

  // ── Case 6: modelVersion 불일치 → 강제 재호출 ────────────────────────────
  it("modelVersion 불일치 시 contentHash 무관하게 provider.embed를 호출한다", async () => {
    mocks.embeddingJob.findMany.mockResolvedValue([makeJob()]);
    setupClaimSuccess();
    mocks.product.findUnique.mockResolvedValue(makeProduct());
    // modelVersion이 다름 (구 모델), contentHash는 동일
    mocks.productEmbedding.findUnique.mockResolvedValue(
      makeProductEmbedding({ modelVersion: "openai:text-embedding-ada-002:1536", contentHash: CONTENT_HASH }),
    );

    const result = await processEmbeddingJobBatch({ limit: 5 });

    expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0, skipped: 0 });
    expect(mocks.provider.embed).toHaveBeenCalledOnce();
    expect(mocks.$executeRaw).toHaveBeenCalledOnce();
  });

  // ── Case 7: ProductEmbedding row 없음 → 최초 임베딩 ────────────────────────
  it("ProductEmbedding row가 없으면 provider를 호출하고 upsert한다", async () => {
    mocks.embeddingJob.findMany.mockResolvedValue([makeJob()]);
    setupClaimSuccess();
    mocks.product.findUnique.mockResolvedValue(makeProduct());
    mocks.productEmbedding.findUnique.mockResolvedValue(null);

    const result = await processEmbeddingJobBatch({ limit: 5 });

    expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0, skipped: 0 });
    expect(mocks.provider.embed).toHaveBeenCalledOnce();
    expect(mocks.$executeRaw).toHaveBeenCalledOnce();
  });

  // ── Case 8: provider 실패 (transient, attempts < 5) ──────────────────────
  it("provider 실패 + attempts < 5 → PENDING + attempts++ + nextRunAt = backoff + failed++", async () => {
    const job = makeJob(JOB_ID, PRODUCT_ID, { attempts: 1 });
    mocks.embeddingJob.findMany.mockResolvedValue([job]);
    setupClaimSuccess();
    // findUniqueOrThrow는 DB의 실제 값(claim 후 로드)을 반영
    mocks.embeddingJob.findUniqueOrThrow.mockResolvedValue({ attempts: 1, productId: PRODUCT_ID });
    mocks.product.findUnique.mockResolvedValue(makeProduct());
    mocks.productEmbedding.findUnique.mockResolvedValue(null); // 강제 embed 시도
    mocks.provider.embed.mockRejectedValue(new Error("OpenAI timeout"));

    const before = Date.now();
    const result = await processEmbeddingJobBatch({ limit: 5 });
    const after = Date.now();

    expect(result).toEqual({ processed: 1, succeeded: 0, failed: 1, skipped: 0 });

    const updateCall = mocks.embeddingJob.update.mock.calls[0][0];
    expect(updateCall.where).toEqual({ id: JOB_ID });
    expect(updateCall.data.status).toBe("PENDING");
    expect(updateCall.data.attempts).toEqual({ increment: 1 });
    expect(updateCall.data.lastError).toContain("OpenAI timeout");

    // backoff: 2^(1+1) * 60_000 = 240_000 ms
    const expectedMs = Math.min(2 ** 2 * 60_000, 3_600_000);
    const nextRunAt: Date = updateCall.data.nextRunAt;
    expect(nextRunAt.getTime()).toBeGreaterThanOrEqual(before + expectedMs - 200);
    expect(nextRunAt.getTime()).toBeLessThanOrEqual(after + expectedMs + 200);
  });

  // ── Case 9: provider 실패 (attempts >= 5) → 영구 FAILED ──────────────────
  it("attempts >= 5면 영구 FAILED로 마킹하고 PENDING으로 돌리지 않는다", async () => {
    const job = makeJob(JOB_ID, PRODUCT_ID, { attempts: 5 });
    mocks.embeddingJob.findMany.mockResolvedValue([job]);
    setupClaimSuccess();
    mocks.embeddingJob.findUniqueOrThrow.mockResolvedValue({ attempts: 5, productId: PRODUCT_ID });
    mocks.product.findUnique.mockResolvedValue(makeProduct());
    mocks.productEmbedding.findUnique.mockResolvedValue(null);
    mocks.provider.embed.mockRejectedValue(new Error("rate limit exceeded"));

    const result = await processEmbeddingJobBatch({ limit: 5 });

    expect(result).toEqual({ processed: 1, succeeded: 0, failed: 1, skipped: 0 });

    const updateCall = mocks.embeddingJob.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe("FAILED");
    // PENDING으로 돌리지 않아야 함
    expect(updateCall.data.status).not.toBe("PENDING");
    // nextRunAt 갱신 안 함 (혹은 null — 선택 사항이지만 status=FAILED면 PENDING revert 없음)
    expect(updateCall.data.attempts).toEqual({ increment: 1 });
  });

  // ── Case 10: 차원 불일치 (vec.length !== 1536) ────────────────────────────
  it("벡터 차원 불일치 시 provider 실패와 동일한 경로 (PENDING + backoff)", async () => {
    const job = makeJob(JOB_ID, PRODUCT_ID, { attempts: 0 });
    mocks.embeddingJob.findMany.mockResolvedValue([job]);
    setupClaimSuccess();
    mocks.product.findUnique.mockResolvedValue(makeProduct());
    mocks.productEmbedding.findUnique.mockResolvedValue(null);
    // 차원이 잘못된 벡터
    mocks.provider.embed.mockResolvedValue(Array.from({ length: 512 }, () => 0.1));

    const result = await processEmbeddingJobBatch({ limit: 5 });

    expect(result).toEqual({ processed: 1, succeeded: 0, failed: 1, skipped: 0 });

    const updateCall = mocks.embeddingJob.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe("PENDING");
    expect(updateCall.data.lastError).toContain("차원");
    // $executeRaw (upsert) 호출 없어야 함
    expect(mocks.$executeRaw).not.toHaveBeenCalled();
  });

  // ── Case 11: Product 없음 (orphan job) → 영구 FAILED ─────────────────────
  it("product가 없으면 영구 FAILED + 'product not found' + failed++", async () => {
    mocks.embeddingJob.findMany.mockResolvedValue([makeJob()]);
    setupClaimSuccess();
    mocks.product.findUnique.mockResolvedValue(null);

    const result = await processEmbeddingJobBatch({ limit: 5 });

    expect(result).toEqual({ processed: 1, succeeded: 0, failed: 1, skipped: 0 });

    const updateCall = mocks.embeddingJob.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe("FAILED");
    expect(updateCall.data.lastError).toContain("product not found");
    expect(mocks.provider.embed).not.toHaveBeenCalled();
  });

  // ── Case 12: 배치 격리 — 첫 job 실패가 두 번째 job에 영향 안 줌 ───────────
  it("배치 내 첫 job 실패가 두 번째 job 처리에 영향을 주지 않는다", async () => {
    const job1 = makeJob(JOB_ID, PRODUCT_ID);
    const job2 = makeJob(JOB_ID_2, PRODUCT_ID_2);
    mocks.embeddingJob.findMany.mockResolvedValue([job1, job2]);

    // $transaction: 두 job 모두 claim 성공
    mocks.$transaction.mockImplementation(
      async (fn: (tx: Prisma.TransactionClient) => Promise<boolean>) => {
        const txClient = {
          embeddingJob: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        } as unknown as Prisma.TransactionClient;
        return fn(txClient);
      },
    );

    // findUniqueOrThrow: job1, job2 순서로 attempts=0 반환
    mocks.embeddingJob.findUniqueOrThrow
      .mockResolvedValueOnce({ attempts: 0, productId: PRODUCT_ID })
      .mockResolvedValueOnce({ attempts: 0, productId: PRODUCT_ID_2 });

    // job1: 상품은 있지만 provider 실패
    // job2: 정상 성공 (신규 row 없음 → embed)
    mocks.product.findUnique
      .mockResolvedValueOnce(makeProduct(PRODUCT_ID))
      .mockResolvedValueOnce(makeProduct(PRODUCT_ID_2));
    mocks.productEmbedding.findUnique
      .mockResolvedValueOnce(null) // job1 → embed 시도
      .mockResolvedValueOnce(null); // job2 → embed
    mocks.provider.embed
      .mockRejectedValueOnce(new Error("OpenAI 500"))
      .mockResolvedValueOnce(FAKE_VEC);

    const result = await processEmbeddingJobBatch({ limit: 5 });

    expect(result).toEqual({ processed: 2, succeeded: 1, failed: 1, skipped: 0 });
    // job2의 upsert는 호출되어야 함
    expect(mocks.$executeRaw).toHaveBeenCalledOnce();
  });

  // ── Case 13: provider는 배치 당 한 번만 초기화 ───────────────────────────
  it("getEmbeddingProvider는 배치 당 한 번만 호출된다", async () => {
    const { getEmbeddingProvider } = await import("@/shared/lib/embedding");
    const getProviderMock = vi.mocked(getEmbeddingProvider);

    mocks.embeddingJob.findMany.mockResolvedValue([makeJob()]);
    setupClaimSuccess();
    mocks.product.findUnique.mockResolvedValue(makeProduct());
    mocks.productEmbedding.findUnique.mockResolvedValue(null);

    await processEmbeddingJobBatch({ limit: 5 });

    expect(getProviderMock).toHaveBeenCalledOnce();
  });
});
