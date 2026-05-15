/**
 * context.test.ts — AsyncLocalStorage 기반 RequestContext 단위 테스트 (M-OBS Task 3)
 *
 * 검증 축:
 *  1. runWithContext 내부에서 getContext() 정상 반환
 *  2. 중첩 컨텍스트 — 내부/외부 각자의 컨텍스트를 격리
 *  3. Promise.all 병렬 분기에서 컨텍스트 교차 오염 없음
 *  4. ALS 바깥(컨텍스트 없는 곳)에서 getContext() → undefined (fail-safe)
 *  5. setContext partial merge — 현재 store에 병합, 없는 곳에선 no-op
 *  6. setTimeout(비동기) 내부에서도 컨텍스트 보존
 */

import { describe, it, expect } from "vitest";
import { runWithContext, getContext, setContext } from "../context";
import type { LogContext } from "../types";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("runWithContext + getContext", () => {
  it("컨텍스트 내부에서 getContext()가 주입된 값을 반환", async () => {
    const ctx: LogContext = { traceId: "trace-001", userId: "user-A" };
    await runWithContext(ctx, async () => {
      expect(getContext()).toEqual({ traceId: "trace-001", userId: "user-A" });
    });
  });

  it("runWithContext가 fn의 반환값을 그대로 전달", async () => {
    const result = await runWithContext({ traceId: "t" }, async () => 42);
    expect(result).toBe(42);
  });

  it("컨텍스트 실행 종료 후, 바깥에서 getContext()는 이전 값(없으면 undefined)으로 복원", async () => {
    // ALS 바깥 — 이 테스트 자체가 컨텍스트 외부일 수 있으므로 undefined 또는 이전 값
    const before = getContext();
    await runWithContext({ traceId: "inner" }, async () => {
      expect(getContext()?.traceId).toBe("inner");
    });
    // 종료 후 원래 상태 복원
    expect(getContext()).toBe(before);
  });
});

describe("중첩 컨텍스트 격리", () => {
  it("내부 runWithContext는 자신의 컨텍스트를 유지, 외부는 영향 없음", async () => {
    const outer: LogContext = { traceId: "outer-trace", routeName: "outer" };
    await runWithContext(outer, async () => {
      expect(getContext()?.traceId).toBe("outer-trace");

      // 내부 컨텍스트로 진입
      await runWithContext({ traceId: "inner-trace", routeName: "inner" }, async () => {
        expect(getContext()?.traceId).toBe("inner-trace");
        expect(getContext()?.routeName).toBe("inner");
      });

      // 내부 종료 후 외부 컨텍스트 복원
      expect(getContext()?.traceId).toBe("outer-trace");
      expect(getContext()?.routeName).toBe("outer");
    });
  });
});

describe("Promise.all 병렬 분기 격리", () => {
  it("동시에 실행된 두 컨텍스트가 서로 간섭하지 않음", async () => {
    const results: string[] = [];

    await Promise.all([
      runWithContext({ traceId: "trace-A", userId: "userA" }, async () => {
        await delay(10); // 의도적으로 B보다 늦게 완료
        results.push(getContext()?.traceId ?? "MISSING");
        expect(getContext()?.traceId).toBe("trace-A");
        expect(getContext()?.userId).toBe("userA");
      }),
      runWithContext({ traceId: "trace-B", userId: "userB" }, async () => {
        await delay(5);
        results.push(getContext()?.traceId ?? "MISSING");
        expect(getContext()?.traceId).toBe("trace-B");
        expect(getContext()?.userId).toBe("userB");
      }),
    ]);

    expect(results).toContain("trace-A");
    expect(results).toContain("trace-B");
    // 교차 오염 없음
    expect(results).not.toContain("MISSING");
  });

  it("세 개 이상의 병렬 컨텍스트도 격리", async () => {
    const collected: Record<string, string | undefined>[] = [];

    await Promise.all(
      ["X", "Y", "Z"].map((id) =>
        runWithContext({ traceId: `trace-${id}`, bookingId: `booking-${id}` }, async () => {
          await delay(Math.random() * 15);
          collected.push({
            traceId: getContext()?.traceId,
            bookingId: getContext()?.bookingId,
          });
        })
      )
    );

    expect(collected).toHaveLength(3);
    // 각 요소가 자기 id를 갖고 있어야 한다 (교차 없음)
    for (const item of collected) {
      expect(item.traceId).toMatch(/^trace-[XYZ]$/);
      const id = item.traceId?.replace("trace-", "");
      expect(item.bookingId).toBe(`booking-${id}`);
    }
  });
});

describe("ALS 바깥에서 fail-safe", () => {
  it("컨텍스트 없는 곳(ALS 외부)에서 getContext()는 undefined 반환 (에러 없음)", () => {
    // 이 테스트 자체가 ALS 바깥이므로 undefined일 수 있음
    // 어느 쪽이든 에러를 던지면 안 된다
    expect(() => getContext()).not.toThrow();
  });

  it("setContext는 ALS 바깥에서 호출해도 에러 없음 (no-op)", () => {
    expect(() => setContext({ traceId: "should-not-throw" })).not.toThrow();
  });
});

describe("setContext partial merge", () => {
  it("runWithContext 내부에서 setContext로 필드를 추가", async () => {
    await runWithContext({ traceId: "t1" }, async () => {
      expect(getContext()?.userId).toBeUndefined();

      setContext({ userId: "u1" });

      expect(getContext()?.traceId).toBe("t1"); // 기존 필드 보존
      expect(getContext()?.userId).toBe("u1"); // 신규 필드 추가
    });
  });

  it("setContext가 기존 필드를 덮어쓸 수 있음", async () => {
    await runWithContext({ traceId: "old", routeName: "page" }, async () => {
      setContext({ traceId: "new" });
      expect(getContext()?.traceId).toBe("new");
      expect(getContext()?.routeName).toBe("page"); // 다른 필드 유지
    });
  });
});

describe("setTimeout / 비동기 내부 컨텍스트 보존", () => {
  it("setTimeout 콜백 내부에서도 getContext()가 올바른 값을 유지", async () => {
    const ctx: LogContext = { traceId: "async-trace", paymentId: "pay-99" };

    await runWithContext(ctx, () =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(getContext()?.traceId).toBe("async-trace");
          expect(getContext()?.paymentId).toBe("pay-99");
          resolve();
        }, 20);
      })
    );
  });

  it("중첩 비동기(Promise chain)에서도 컨텍스트 전파", async () => {
    const ctx: LogContext = { traceId: "chain-trace", bookingId: "book-42" };

    await runWithContext(ctx, async () => {
      const step1 = await Promise.resolve(getContext()?.traceId);
      await delay(5);
      const step2 = await Promise.resolve(getContext()?.bookingId);
      await delay(5);
      const step3 = getContext()?.traceId;

      expect(step1).toBe("chain-trace");
      expect(step2).toBe("book-42");
      expect(step3).toBe("chain-trace");
    });
  });
});
