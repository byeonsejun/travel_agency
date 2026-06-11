/**
 * errorTracker.test.ts — Error Tracker 어댑터 단위 테스트 (M-OBS Task 5)
 *
 * 검증 축:
 *  1. DSN 미설정 시 logger.error 1회 fanout
 *  2. ctx → data 인자 병합
 *  3. ALS getContext() 자동 결합 (traceId 전파)
 *  4. ctx + ALS 머지 우선순위 (ctx가 ALS 오버라이드)
 *  5. extras PII가 마스킹된 상태로 전달
 *  8. ALS 바깥에서도 에러 없이 동작 (fail-safe)
 *  9. Error 아닌 값(string, number) 처리
 * 10. captureMessage — level별 라우팅
 * 11. 내부 실패는 swallow — 호출처 흐름 차단 금지
 *
 * 전략: logger.error / logger.warn에 vi.spyOn을 걸어 실제 console 출력 없이 호출 검증.
 *       NODE_ENV=test여도 spy가 logger 메서드 자체를 교체하므로 silent 체크를 우회한다.
 *
 * [Sentry 10 호환성 노트]
 * Sentry 10은 ESM namespace로 배포된다. ESM namespace 객체는 sealed(Object.isSealed)라
 * vi.spyOn(Sentry, "captureException")이 "Cannot redefine property" TypeError를 발생시킨다.
 * 해결책: vi.mock("@sentry/nextjs", factory)로 모듈 전체를 hoisted mock으로 대체하고
 * vi.mocked()로 mock 인스턴스를 참조한다. DSN-미설정 테스트는 Sentry를 호출하지 않으므로
 * mock factory가 있어도 동작에 영향 없다.
 */

import { beforeEach, afterEach, describe, it, expect, vi, type MockInstance } from "vitest";

// Sentry 10 ESM namespace가 sealed라 vi.spyOn 불가 → module-level vi.mock으로 대체.
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  withScope: vi.fn((cb: (scope: { setTag: ReturnType<typeof vi.fn>; setExtra: ReturnType<typeof vi.fn> }) => void) => {
    cb({ setTag: vi.fn(), setExtra: vi.fn() });
    return "test-event-id";
  }),
}));
import { captureException, captureMessage } from "../errorTracker";
import { logger } from "../logger";
import { runWithContext } from "../context";

describe("captureException — DSN 미설정 (기본 logger fanout)", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
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

  // warnSpy 사용 방지 lint 경고 억제
  it("DSN 미설정 시 warn이 호출되지 않는다", () => {
    captureException(new Error("no warn"));
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("captureMessage", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
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

describe("captureException — DSN 설정 시 Sentry SDK fanout (B2-A)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type SpyMock = MockInstance<(...args: any[]) => unknown>;
  let errorSpy: SpyMock;
  // Sentry 10 ESM: vi.mock factory로 생성된 mock fn을 vi.mocked()로 참조한다.
  // (vi.spyOn은 sealed ESM namespace에서 "Cannot redefine property" 발생 — 모듈 상단 주석 참조)
  let sentryCaptureSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("SENTRY_DSN", "https://test-key@sentry.io/12345");
    errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {}) as SpyMock;

    // vi.mock factory에서 생성된 mock fn을 vi.mocked()로 참조.
    const Sentry = await import("@sentry/nextjs");
    sentryCaptureSpy = vi.mocked(Sentry.captureException);
    sentryCaptureSpy.mockClear();
    vi.mocked(Sentry.withScope).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("Sentry.captureException이 1회 호출되고 logger.error도 fanout 유지", () => {
    const err = new Error("boom");
    captureException(err, { routeName: "/api/test" });

    expect(sentryCaptureSpy).toHaveBeenCalledTimes(1);
    expect(sentryCaptureSpy).toHaveBeenCalledWith(err);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toBe("error.captured");
  });

  it("Error 아닌 값은 new Error(String(...))로 wrap되어 캡처", () => {
    captureException("string-error", { routeName: "/api/test" });

    expect(sentryCaptureSpy).toHaveBeenCalledTimes(1);
    const captured = sentryCaptureSpy.mock.calls[0][0] as unknown;
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toBe("string-error");
  });

  it("not_wired warn은 더 이상 발생하지 않음 (SDK가 wired된 Phase)", () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {}) as SpyMock;
    captureException(new Error("boom"));

    const notWiredCalls = (warnSpy.mock.calls as unknown[][]).filter(
      (c) => c[0] === "errorTracker.sentry.not_wired",
    );
    expect(notWiredCalls).toHaveLength(0);
  });
});
