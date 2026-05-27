import { describe, it, expect, vi, beforeEach } from "vitest";

const captureMessageMock = vi.fn();
vi.mock("@/shared/lib/observability", () => ({
  captureMessage: (...args: unknown[]) => captureMessageMock(...args),
}));

const loggerMock = {
  debug: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
};
vi.mock("@/shared/lib/observability/logger", () => ({
  logger: loggerMock,
}));

async function postReport(body: unknown, contentType = "application/csp-report") {
  const { POST } = await import("../route");
  const req = new Request("http://localhost:3000/api/csp-report", {
    method: "POST",
    headers: { "content-type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return POST(req);
}

describe("/api/csp-report", () => {
  beforeEach(() => {
    captureMessageMock.mockReset();
    loggerMock.debug.mockReset();
    loggerMock.warn.mockReset();
  });

  it("정상 페이로드 → 200 + captureMessage 1회 호출", async () => {
    const res = await postReport({
      "csp-report": {
        "violated-directive": "script-src-elem",
        "blocked-uri": "https://evil.com/inject.js",
        "document-uri": "http://localhost:3000/products/abc",
      },
    });
    expect(res.status).toBe(200);
    expect(captureMessageMock).toHaveBeenCalledTimes(1);
    expect(captureMessageMock.mock.calls[0][0]).toContain("CSP violation");
  });

  it("Zod 실패 (csp-report 누락) → 200 silent + captureMessage 0회 + logger.warn 1회", async () => {
    const res = await postReport({ malformed: true });
    expect(res.status).toBe(200);
    expect(captureMessageMock).not.toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      "csp.report.invalid_payload",
      expect.any(Object),
    );
  });

  it("chrome-extension blocked-uri → 200 + captureMessage 0회 (노이즈 필터)", async () => {
    const res = await postReport({
      "csp-report": {
        "violated-directive": "script-src",
        "blocked-uri": "chrome-extension://abcdefg/inject.js",
      },
    });
    expect(res.status).toBe(200);
    expect(captureMessageMock).not.toHaveBeenCalled();
    expect(loggerMock.debug).toHaveBeenCalledWith(
      "csp.report.noise_filtered",
      expect.any(Object),
    );
  });

  it("Content-Type 누락 → 415", async () => {
    const res = await postReport({ "csp-report": {} }, "text/plain");
    expect(res.status).toBe(415);
    expect(captureMessageMock).not.toHaveBeenCalled();
  });

  it("잘못된 JSON → 200 silent (브라우저 재시도 방지)", async () => {
    const res = await postReport("not-a-json{{{", "application/csp-report");
    expect(res.status).toBe(200);
    expect(captureMessageMock).not.toHaveBeenCalled();
  });

  it("moz-extension source-file → 노이즈 필터", async () => {
    const res = await postReport({
      "csp-report": {
        "violated-directive": "script-src",
        "blocked-uri": "https://evil.com/x.js",
        "source-file": "moz-extension://uuid/content.js",
      },
    });
    expect(res.status).toBe(200);
    expect(captureMessageMock).not.toHaveBeenCalled();
  });
});
