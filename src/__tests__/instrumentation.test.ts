import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

describe("instrumentation.register — NEXT_RUNTIME 분기", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("../sentry.server.config");
    vi.doUnmock("../sentry.edge.config");
  });

  it("NEXT_RUNTIME=nodejs 일 때 sentry.server.config만 import", async () => {
    const serverInit = vi.fn();
    const edgeInit = vi.fn();
    vi.doMock("../sentry.server.config", () => ({ default: serverInit() }));
    vi.doMock("../sentry.edge.config", () => ({ default: edgeInit() }));

    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const { register } = await import("../instrumentation");
    await register();

    expect(serverInit).toHaveBeenCalledTimes(1);
    expect(edgeInit).not.toHaveBeenCalled();
  });

  it("NEXT_RUNTIME=edge 일 때 sentry.edge.config만 import", async () => {
    const serverInit = vi.fn();
    const edgeInit = vi.fn();
    vi.doMock("../sentry.server.config", () => ({ default: serverInit() }));
    vi.doMock("../sentry.edge.config", () => ({ default: edgeInit() }));

    vi.stubEnv("NEXT_RUNTIME", "edge");
    const { register } = await import("../instrumentation");
    await register();

    expect(edgeInit).toHaveBeenCalledTimes(1);
    expect(serverInit).not.toHaveBeenCalled();
  });

  it("NEXT_RUNTIME 미정의 — 어느 config도 import하지 않음", async () => {
    const serverInit = vi.fn();
    const edgeInit = vi.fn();
    vi.doMock("../sentry.server.config", () => ({ default: serverInit() }));
    vi.doMock("../sentry.edge.config", () => ({ default: edgeInit() }));

    vi.stubEnv("NEXT_RUNTIME", "");
    const { register } = await import("../instrumentation");
    await register();

    expect(serverInit).not.toHaveBeenCalled();
    expect(edgeInit).not.toHaveBeenCalled();
  });
});
