import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// vi.hoisted: vi.mock factory보다 먼저 실행됨을 보장
const mocks = vi.hoisted(() => ({
  processEmbeddingJobBatch: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn() },
}));

vi.mock("@/shared/lib/embedding-job/worker", () => ({
  processEmbeddingJobBatch: mocks.processEmbeddingJobBatch,
}));
vi.mock("@/shared/lib/observability", () => ({
  logger: mocks.logger,
  metrics: { incr: vi.fn() },
}));
vi.mock("@/shared/lib/env", () => ({
  env: { CRON_SECRET: "a".repeat(32) },
}));

import { GET } from "../route";

const VALID_SECRET = "a".repeat(32);

function makeRequest(authHeader?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (authHeader !== undefined) {
    headers.authorization = authHeader;
  }
  return new NextRequest("http://localhost/api/cron/embedding-job", { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/cron/embedding-job", () => {
  describe("인증 실패 — 401", () => {
    it("Authorization 헤더 없으면 401 반환", async () => {
      const res = await GET(makeRequest());
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ error: "Unauthorized" });
    });

    it("잘못된 토큰이면 401 반환", async () => {
      const res = await GET(makeRequest("Bearer wrong-token"));
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ error: "Unauthorized" });
    });
  });

  describe("정상 처리 — 200", () => {
    it("유효한 토큰이면 processEmbeddingJobBatch를 호출하고 결과를 반환한다", async () => {
      const batchResult = { processed: 3, succeeded: 2, failed: 0, skipped: 1 };
      mocks.processEmbeddingJobBatch.mockResolvedValue(batchResult);

      const res = await GET(makeRequest(`Bearer ${VALID_SECRET}`));
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toEqual(batchResult);

      expect(mocks.processEmbeddingJobBatch).toHaveBeenCalledWith({ limit: 5 });
      expect(mocks.logger.info).toHaveBeenCalledWith("cron.embedding-job.run", {
        processed: 3,
        succeeded: 2,
        failed: 0,
        skipped: 1,
      });
    });
  });

  describe("예상 밖 오류 — 500", () => {
    it("processEmbeddingJobBatch가 throw하면 500 반환 + error 로그", async () => {
      const boom = new Error("DB connection refused");
      mocks.processEmbeddingJobBatch.mockRejectedValue(boom);

      const res = await GET(makeRequest(`Bearer ${VALID_SECRET}`));
      expect(res.status).toBe(500);

      const body = await res.json();
      expect(body).toEqual({ error: "Internal Server Error" });

      expect(mocks.logger.error).toHaveBeenCalledWith(
        "cron.embedding-job.unexpected_error",
        boom,
      );
    });
  });
});
