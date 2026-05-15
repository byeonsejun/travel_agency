/**
 * errorTracker.test.ts — Error Tracker 어댑터 단위 테스트 (M-OBS Task 5)
 *
 * 검증 축:
 *  1. DSN 미설정 시 logger.error 1회 fanout
 *  2. ctx → data 인자 병합
 *  3. ALS getContext() 자동 결합 (traceId 전파)
 *  4. ctx + ALS 머지 우선순위 (ctx가 ALS 오버라이드)
 *  5. extras PII가 마스킹된 상태로 전달
 *  6. DSN 설정 시 logger.warn("errorTracker.sentry.not_wired") 1회 + logger.error 유지
 *  7. DSN 설정 시 warn은 여러 번 호출해도 1회만 발생
 *  8. ALS 바깥에서도 에러 없이 동작 (fail-safe)
 *  9. Error 아닌 값(string, number) 처리
 * 10. captureMessage — level별 라우팅
 * 11. 내부 실패는 swallow — 호출처 흐름 차단 금지
 *
 * 전략: logger.error / logger.warn에 vi.spyOn을 걸어 실제 console 출력 없이 호출 검증.
 *       NODE_ENV=test여도 spy가 logger 메서드 자체를 교체하므로 silent 체크를 우회한다.
 */

import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { captureException, captureMessage, _resetForTest } from "../errorTracker";
import { logger } from "../logger";
import { runWithContext } from "../context";

describe("captureException — DSN 미설정 (기본 logger fanout)", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetForTest();
    vi.unstubAllEnvs(); // SENTRY_DSN 없는 상태 보장
    errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("logger.error('error.captured', err, ...) 가 1회 호출된다", () => {
    const err = new Error("test error");
    captureException(err);

    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy.mock.calls[0][0]).toBe("error.captured");
    expect(errorSpy.mock.calls[0][1]).toBe(err);
  });

  it("ctx가 logger.error의 data 인자에 포함된다", () => {
    captureException(new Error("ctx test"), { bookingId: "bk-1", paymentId: "pay-2" });

    const data = errorSpy.mock.calls[0][2] as Record<string, unknown>;
    expect(data).toMatchObject({ bookingId: "bk-1", paymentId: "pay-2" });
  });

  it("ALS getContext()의 traceId가 자동 병합된다", async () => {
    await runWithContext({ traceId: "abc1def2abc1def2", routeName: "payments.confirm" }, async () => {
      captureException(new Error("als test"));
    });

    const data = errorSpy.mock.calls[0][2] as Record<string, unknown>;
    expect(data).toMatchObject({ traceId: "abc1def2abc1def2", routeName: "payments.confirm" });
  });

  it("ctx와 ALS 컨텍스트 병합 — ctx가 ALS 필드를 오버라이드", async () => {
    await runWithContext({ traceId: "als-trace", userId: "als-user" }, async () => {
      captureException(new Error("merge test"), {
        userId: "override-user",
        bookingId: "bk-99",
      });
    });

    const data = errorSpy.mock.calls[0][2] as Record<string, unknown>;
    expect(data).toMatchObject({
      traceId: "als-trace",    // ALS 값 유지
      userId: "override-user", // ctx가 ALS 오버라이드
      bookingId: "bk-99",
    });
  });

  it("extras 내부 PII가 마스킹된 상태로 전달된다", () => {
    captureException(new Error("pii test"), {
      extras: { tossPaymentKey: "tps_real_key", email: "user@example.com" },
    });

    const data = errorSpy.mock.calls[0][2] as Record<string, unknown>;
    const extras = data.extras as Record<string, unknown>;
    expect(extras.tossPaymentKey).toBe("[REDACTED]");
    expect(String(extras.email)).toMatch(/\*{3}/);
    expect(String(extras.email)).not.toContain("user@example.com");
  });

  it("ALS 바깥에서도 에러 없이 동작한다 (fail-safe)", () => {
    expect(() => captureException(new Error("outside als"))).not.toThrow();
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it("Error 아닌 값(문자열)도 처리한다", () => {
    captureException("plain string error");
    expect(errorSpy).toHaveBeenCalledWith("error.captured", "plain string error", expect.any(Object));
  });

  it("Error 아닌 값(숫자)도 처리한다", () => {
    captureException(42);
    expect(errorSpy).toHaveBeenCalledWith("error.captured", 42, expect.any(Object));
  });
});

describe("captureException — SENTRY_DSN 설정 시", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetForTest();
    vi.stubEnv("SENTRY_DSN", "https://test-key@sentry.io/12345");
    errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("logger.warn('errorTracker.sentry.not_wired')를 1회 발생시키고 logger.error fanout도 유지", () => {
    captureException(new Error("dsn test"));

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toBe("errorTracker.sentry.not_wired");
    expect(errorSpy).toHaveBeenCalledOnce(); // logger fanout 유지
  });

  it("여러 번 호출해도 warn은 1회만 발생한다 (중복 경고 방지)", () => {
    captureException(new Error("first"));
    captureException(new Error("second"));
    captureException(new Error("third"));

    expect(warnSpy).toHaveBeenCalledOnce(); // warn 1회만
    expect(errorSpy).toHaveBeenCalledTimes(3); // error fanout은 매 호출
  });
});

describe("captureMessage", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetForTest();
    vi.unstubAllEnvs();
    errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("level='error' → logger.error('message.captured', msg, ...) 호출", () => {
    captureMessage("critical issue occurred", "error");

    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy.mock.calls[0][0]).toBe("message.captured");
    expect(errorSpy.mock.calls[0][1]).toBe("critical issue occurred");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("level='warn' → logger.warn('message.captured', { message, ...ctx }) 호출", () => {
    captureMessage("suspicious activity", "warn");

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toBe("message.captured");
    const data = warnSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(data.message).toBe("suspicious activity");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("ctx가 병합된다", () => {
    captureMessage("test msg", "error", { bookingId: "bk-42" });

    const data = errorSpy.mock.calls[0][2] as Record<string, unknown>;
    expect(data).toMatchObject({ bookingId: "bk-42" });
  });

  it("ALS traceId가 captureMessage에도 자동 전파된다", async () => {
    await runWithContext({ traceId: "msg-trace-1234abcd" }, async () => {
      captureMessage("traced message", "warn");
    });

    const data = warnSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(data.traceId).toBe("msg-trace-1234abcd");
  });
});

describe("captureException — 내부 실패 격리", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("logger.error 내부 throw가 발생해도 호출처로 전파되지 않는다", () => {
    // logger.error 자체를 throw하도록 mock
    vi.spyOn(logger, "error").mockImplementation(() => {
      throw new Error("logger internal failure");
    });
    vi.spyOn(logger, "warn").mockImplementation(() => {});

    // 호출처에서 throw 없음 (swallow)
    expect(() => captureException(new Error("trigger"))).not.toThrow();
  });
});
