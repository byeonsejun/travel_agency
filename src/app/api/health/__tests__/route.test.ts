/**
 * route.test.ts — /api/health 단위 테스트 (M-OBS Task 10)
 *
 * 검증:
 *  1. DB ok → 200 + status:"ok" + health.ok counter + traceId
 *  2. DB fail (rejection) → 503 + status:"degraded" + health.db.fail counter
 *  3. APP_VERSION 설정 시 응답 version 필드에 반영
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// ── vi.hoisted: vi.mock factory 실행 전에 mocks 객체 확보 ─────────
const mocks = vi.hoisted(() => ({
  db: { $queryRaw: vi.fn() },
  env: {
    APP_VERSION: undefined as string | undefined,
    NODE_ENV: "test" as "development" | "test" | "production",
    TOSS_CLIENT_KEY: "test_ck",
    TOSS_SECRET_KEY: "test_sk",
    TOSS_WEBHOOK_SECRET: undefined as string | undefined,
    OBSERVABILITY_LOG_LEVEL: "info" as const,
  },
}));

vi.mock("@/shared/lib/db", () => ({ db: mocks.db }));
vi.mock("@/shared/lib/env", () => ({ env: mocks.env }));

import { GET } from "../route";
import { metrics, logger } from "@/shared/lib/observability";

describe("GET /api/health", () => {
  beforeEach(() => {
    metrics.resetForTest();
    vi.spyOn(logger, "info").mockImplementation(() => {});
    mocks.db.$queryRaw.mockReset();
    mocks.env.APP_VERSION = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── 1. DB 정상 ────────────────────────────────────────────────────
  it("DB ok → 200 + status:ok + traceId + health.ok counter", async () => {
    mocks.db.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);

    const req = new NextRequest("http://localhost:3000/api/health");
    const res = await GET(req);
    const body = (await res.json()) as {
      status: string;
      checks: { db: string };
      version: string;
      traceId: string;
    };

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.checks.db).toBe("ok");
    expect(body.traceId).toMatch(/^[0-9a-f]{16}$/);
    expect(body.version).toBe("dev");
    expect(metrics.snapshot().counters["health.ok"]).toBe(1);
    expect(metrics.snapshot().counters["health.db.fail"]).toBeUndefined();
  });

  // ── 2. DB 장애 ────────────────────────────────────────────────────
  it("DB fail → 503 + status:degraded + health.db.fail counter", async () => {
    mocks.db.$queryRaw.mockRejectedValue(new Error("connection refused"));

    const req = new NextRequest("http://localhost:3000/api/health");
    const res = await GET(req);
    const body = (await res.json()) as {
      status: string;
      checks: { db: string };
      traceId: string;
    };

    expect(res.status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.checks.db).toBe("fail");
    expect(body.traceId).toMatch(/^[0-9a-f]{16}$/);
    expect(metrics.snapshot().counters["health.db.fail"]).toBe(1);
    expect(metrics.snapshot().counters["health.ok"]).toBeUndefined();
  });

  // ── 3. APP_VERSION 반영 ───────────────────────────────────────────
  it("APP_VERSION 설정 시 응답 version 필드에 반영", async () => {
    mocks.db.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    mocks.env.APP_VERSION = "v1.2.3-abc1234";

    const req = new NextRequest("http://localhost:3000/api/health");
    const res = await GET(req);
    const body = (await res.json()) as { version: string };

    expect(body.version).toBe("v1.2.3-abc1234");
  });
});
