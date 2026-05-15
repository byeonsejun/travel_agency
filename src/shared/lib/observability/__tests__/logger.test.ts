/**
 * logger.test.ts — 구조화 로거 v2 단위 테스트 (M-OBS Task 4)
 *
 * 검증 축:
 *  1. JSON 한 줄(event/level/ts 필드 포함) 출력
 *  2. getContext() traceId가 자동으로 페이로드에 머지됨
 *  3. PII(email, tossPaymentKey) 마스킹 적용 확인
 *  4. OBSERVABILITY_LOG_LEVEL 미만 레벨은 silent
 *  5. NODE_ENV=test이면 전 레벨 silent
 *  6. error: errorMessage / errorStack 포함
 *  7. error: Error 아닌 값도 String() 변환
 *  8. warn → console.warn, error → console.error 라우팅
 *  9. 컨텍스트 없는 곳에서도 정상 동작 (fail-safe)
 */

import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { logger } from "../logger";
import { runWithContext } from "../context";

describe("logger v2 — 출력 형식", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // vitest 기본 NODE_ENV=test를 development로 교체하여 silent 모드 해제
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("OBSERVABILITY_LOG_LEVEL", "debug");
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("info — JSON 한 줄에 level/event/ts 포함", () => {
    logger.info("test.event", { userId: "u1" });
    expect(logSpy).toHaveBeenCalledOnce();
    const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(payload.level).toBe("info");
    expect(payload.event).toBe("test.event");
    expect(payload.userId).toBe("u1");
    expect(typeof payload.ts).toBe("string");
  });

  it("debug → console.log, warn → console.warn, error → console.error 라우팅", () => {
    logger.debug("d");
    logger.warn("w");
    logger.error("e", new Error("oops"));
    expect(logSpy).toHaveBeenCalledOnce(); // debug
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledOnce();
  });
});

describe("logger v2 — 컨텍스트 자동 머지", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("OBSERVABILITY_LOG_LEVEL", "debug");
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("runWithContext 내부에서 traceId / routeName이 자동 포함", async () => {
    await runWithContext(
      { traceId: "abc1def2abc1def2", routeName: "payments.confirm" },
      async () => {
        logger.info("payment.started");
      }
    );
    const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(payload.traceId).toBe("abc1def2abc1def2");
    expect(payload.routeName).toBe("payments.confirm");
  });

  it("ALS 바깥에서도 에러 없이 동작 (fail-safe)", () => {
    expect(() => logger.info("no.context.event", { x: 1 })).not.toThrow();
    const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(payload.event).toBe("no.context.event");
    expect(payload.traceId).toBeUndefined();
  });

  it("data 필드가 컨텍스트보다 우선 (override)", async () => {
    await runWithContext({ traceId: "ctx-trace", userId: "ctx-user" }, async () => {
      logger.info("override.event", { userId: "data-user" });
    });
    const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(payload.traceId).toBe("ctx-trace");
    expect(payload.userId).toBe("data-user"); // data가 ctx를 오버라이드
  });
});

describe("logger v2 — PII 마스킹", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("OBSERVABILITY_LOG_LEVEL", "debug");
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("이메일은 부분 마스킹, tossPaymentKey는 [REDACTED]", () => {
    logger.info("pii.event", {
      email: "user@example.com",
      tossPaymentKey: "tps_secret_key",
    });
    const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(payload.email).toMatch(/\*{3}/);
    expect(payload.email).not.toContain("user@example.com");
    expect(payload.tossPaymentKey).toBe("[REDACTED]");
  });

  it("중첩 객체의 PII도 마스킹", () => {
    logger.info("nested.pii", { user: { password: "secret123" } });
    const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(payload.user.password).toBe("[REDACTED]");
  });
});

describe("logger v2 — error 메서드", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("OBSERVABILITY_LOG_LEVEL", "debug");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("Error 인스턴스 → errorMessage / errorStack 포함", () => {
    const err = new Error("something went wrong");
    logger.error("error.occurred", err, { bookingId: "book-1" });
    const payload = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(payload.errorMessage).toBe("something went wrong");
    expect(payload.errorStack).toContain("Error: something went wrong");
    expect(payload.bookingId).toBe("book-1");
  });

  it("Error 아닌 값(문자열) → errorMessage만 포함, errorStack은 undefined", () => {
    logger.error("error.string", "plain string error");
    const payload = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(payload.errorMessage).toBe("plain string error");
    expect(payload.errorStack).toBeUndefined();
  });

  it("Error 아닌 값(숫자) → String() 변환", () => {
    logger.error("error.number", 42);
    const payload = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(payload.errorMessage).toBe("42");
  });
});

describe("logger v2 — 레벨 필터링", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("LOG_LEVEL=info 이면 debug는 silent, info는 출력", () => {
    vi.stubEnv("OBSERVABILITY_LOG_LEVEL", "info");
    logger.debug("debug.event");
    logger.info("info.event");
    expect(logSpy).toHaveBeenCalledOnce(); // info만
    const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(payload.event).toBe("info.event");
  });

  it("LOG_LEVEL=warn 이면 debug/info는 silent, warn/error는 출력", () => {
    vi.stubEnv("OBSERVABILITY_LOG_LEVEL", "warn");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it("LOG_LEVEL=error 이면 error만 출력", () => {
    vi.stubEnv("OBSERVABILITY_LOG_LEVEL", "error");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e", new Error("x"));
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledOnce();
  });
});

describe("logger v2 — NODE_ENV=test silent", () => {
  it("NODE_ENV=test 이면 모든 레벨이 silent (vitest 기본 환경 확인)", () => {
    // NODE_ENV가 test인 상태에서는 아무것도 출력되지 않아야 한다.
    // vitest 기본값이 test이므로 stubEnv 없이 검증.
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e", new Error("x"));

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });
});
