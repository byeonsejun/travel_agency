import { describe, it, expect, vi } from "vitest";

// "use server" 모듈이 next-auth → next/server를 연쇄 import하므로
// 테스트 컨텍스트에서 auth와 next/cache는 stub으로 차단.
vi.mock("@/features/auth/server/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/entities/payment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/payment")>();
  return { ...actual, refundDiscretionary: vi.fn() };
});
vi.mock("@/shared/lib/env", () => ({
  env: {
    NODE_ENV: "test",
    TOSS_API_BASE_URL: "http://localhost:4242",
    TOSS_SECRET_KEY: "test_sk_xxx",
    OBSERVABILITY_LOG_LEVEL: "error",
  },
}));

import { DiscretionaryRefundSchema } from "../actions";

describe("DiscretionaryRefundSchema", () => {
  it("양의 정수 금액만 허용", () => {
    expect(DiscretionaryRefundSchema.safeParse({ paymentId: "p1", bookingId: "b1", amount: 0, requestId: "r1" }).success).toBe(false);
    expect(DiscretionaryRefundSchema.safeParse({ paymentId: "p1", bookingId: "b1", amount: 500, requestId: "r1" }).success).toBe(true);
  });
  it("amount 비정수 거부", () => {
    expect(DiscretionaryRefundSchema.safeParse({ paymentId: "p1", bookingId: "b1", amount: 1.5, requestId: "r1" }).success).toBe(false);
  });
});
