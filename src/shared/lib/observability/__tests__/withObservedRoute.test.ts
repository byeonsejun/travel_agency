/**
 * withObservedRoute.test.ts — 관측 래퍼 단위 테스트 (M-OBS Task 7)
 *
 * 검증:
 *  1. 정상 200 → route.start/end 로그 쌍 + x-trace-id 응답 헤더
 *  2. 핸들러 throw → captureException 호출 + 에러 재throw
 *  3. 요청에 x-trace-id 있으면 그대로 전파
 *  4. 요청에 x-trace-id 없으면 신규 16자 hex 발급
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// ── vi.hoisted: vi.mock factory 실행 전에 mocks 객체 확보 ──────────
const mocks = vi.hoisted(() => ({
  captureException: vi.fn(),
}));

// captureException만 교체 — logger/metrics/context/generateTraceId는 실제 구현 사용
vi.mock("@/shared/lib/observability/errorTracker", () => ({
  captureException: mocks.captureException,
  captureMessage: vi.fn(),
  _resetForTest: vi.fn(),
}));

import { withObservedRoute } from "../withObservedRoute";
import { logger } from "@/shared/lib/observability";

describe("withObservedRoute", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mocks.captureException.mockReset();
    // logger.info를 스파이로 인터셉트 — NODE_ENV=test 무음 우회
    infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── 1. 정상 응답 ──────────────────────────────────────────────────
  it("정상 200 → x-trace-id 응답 헤더 + route.start/end 로그 쌍", async () => {
    const req = new NextRequest("http://localhost:3000/api/test", { method: "GET" });
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));

    const wrapped = withObservedRoute("test.route", handler);
    const response = await wrapped(req);

    // x-trace-id 헤더: 16자 소문자 hex
    expect(response.headers.get("x-trace-id")).toMatch(/^[0-9a-f]{16}$/);

    // route.start 로그
    expect(infoSpy).toHaveBeenCalledWith(
      "route.start",
      expect.objectContaining({ method: "GET", url: "/api/test" })
    );

    // route.end 로그 (durationMs 포함)
    expect(infoSpy).toHaveBeenCalledWith(
      "route.end",
      expect.objectContaining({ durationMs: expect.any(Number), status: 200 })
    );

    // captureException 미호출
    expect(mocks.captureException).not.toHaveBeenCalled();
  });

  // ── 2. 핸들러 throw ───────────────────────────────────────────────
  it("핸들러 throw → captureException 호출 + 에러 재throw", async () => {
    const req = new NextRequest("http://localhost:3000/api/test", { method: "POST" });
    const boom = new Error("handler boom");
    const handler = vi.fn().mockRejectedValue(boom);

    const wrapped = withObservedRoute("test.throw", handler);

    await expect(wrapped(req)).rejects.toThrow("handler boom");

    expect(mocks.captureException).toHaveBeenCalledWith(
      boom,
      expect.objectContaining({ routeName: "test.throw" })
    );

    // route.end는 error:true 로 기록됨
    expect(infoSpy).toHaveBeenCalledWith(
      "route.end",
      expect.objectContaining({ error: true })
    );
  });

  // ── 3. 요청 traceId 전파 ──────────────────────────────────────────
  it("요청에 x-trace-id 있으면 응답 헤더에 동일 값 전파", async () => {
    const existingId = "abcdef1234567890";
    const req = new NextRequest("http://localhost:3000/api/test", {
      method: "GET",
      headers: { "x-trace-id": existingId },
    });
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));

    const response = await withObservedRoute("test.propagate", handler)(req);

    expect(response.headers.get("x-trace-id")).toBe(existingId);
  });

  // ── 4. 신규 traceId 발급 ─────────────────────────────────────────
  it("요청에 x-trace-id 없으면 신규 16자 hex 발급", async () => {
    const req = new NextRequest("http://localhost:3000/api/test", { method: "GET" });
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));

    const response = await withObservedRoute("test.new-id", handler)(req);
    const traceId = response.headers.get("x-trace-id");

    expect(traceId).toMatch(/^[0-9a-f]{16}$/);
    expect(traceId).not.toBeNull();
  });
});
