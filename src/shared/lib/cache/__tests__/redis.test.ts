/**
 * redis.test.ts — Upstash Redis 분산 캐시 graceful wrapper (M-CACHE).
 *
 * 검증 축:
 *  1. 미설정(url/token 없음) → no-op: get=null, set 무동작, 클라이언트 미생성
 *  2. 설정됨 + hit → 역직렬화된 값 반환
 *  3. 설정됨 + miss → null
 *  4. get 예외(Redis 장애) → null로 흡수 (graceful, throw 안 함)
 *  5. set 예외 → 조용히 흡수 (요청 흐름 깨지 않음)
 *  6. set은 TTL(ex) 옵션과 함께 직렬화 저장
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const redisInstance = { get: vi.fn(), set: vi.fn() };
  const RedisCtor = vi.fn(() => redisInstance);
  return {
    redisInstance,
    RedisCtor,
    env: {
      UPSTASH_REDIS_REST_URL: undefined as string | undefined,
      UPSTASH_REDIS_REST_TOKEN: undefined as string | undefined,
    },
  };
});

vi.mock("@upstash/redis", () => ({ Redis: mocks.RedisCtor }));
vi.mock("@/shared/lib/env", () => ({ env: mocks.env }));
vi.mock("@/shared/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import {
  cacheGet,
  cacheSet,
  __resetRedisClientForTest,
} from "../redis";

function configure() {
  mocks.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
  mocks.env.UPSTASH_REDIS_REST_TOKEN = "tok_test";
}
function unconfigure() {
  mocks.env.UPSTASH_REDIS_REST_URL = undefined;
  mocks.env.UPSTASH_REDIS_REST_TOKEN = undefined;
}

beforeEach(() => {
  __resetRedisClientForTest();
  mocks.redisInstance.get.mockReset();
  mocks.redisInstance.set.mockReset();
  mocks.RedisCtor.mockClear();
  unconfigure();
});

describe("미설정 시 no-op 강등", () => {
  it("cacheGet은 null, 클라이언트를 만들지 않는다", async () => {
    expect(await cacheGet("k")).toBeNull();
    expect(mocks.RedisCtor).not.toHaveBeenCalled();
  });

  it("cacheSet은 무동작(throw 없음)", async () => {
    await expect(cacheSet("k", { a: 1 }, 3600)).resolves.toBeUndefined();
    expect(mocks.RedisCtor).not.toHaveBeenCalled();
  });
});

describe("설정 시 hit / miss", () => {
  it("hit — 직렬화 값 역직렬화 반환", async () => {
    configure();
    mocks.redisInstance.get.mockResolvedValueOnce(
      JSON.stringify([{ id: "p1", score: 0.9 }])
    );
    const v = await cacheGet<{ id: string; score: number }[]>("search:v1:q");
    expect(v).toEqual([{ id: "p1", score: 0.9 }]);
  });

  it("miss — null 반환", async () => {
    configure();
    mocks.redisInstance.get.mockResolvedValueOnce(null);
    expect(await cacheGet("search:v1:none")).toBeNull();
  });

  it("set — JSON 직렬화 + TTL(ex) 전달", async () => {
    configure();
    mocks.redisInstance.set.mockResolvedValueOnce("OK");
    await cacheSet("search:v1:q", [{ id: "p1" }], 3600);
    expect(mocks.redisInstance.set).toHaveBeenCalledWith(
      "search:v1:q",
      JSON.stringify([{ id: "p1" }]),
      { ex: 3600 }
    );
  });
});

describe("graceful degradation — Redis 장애 흡수", () => {
  it("get 예외 → null (throw 안 함)", async () => {
    configure();
    mocks.redisInstance.get.mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(cacheGet("k")).resolves.toBeNull();
  });

  it("set 예외 → 조용히 흡수 (throw 안 함)", async () => {
    configure();
    mocks.redisInstance.set.mockRejectedValueOnce(new Error("timeout"));
    await expect(cacheSet("k", { a: 1 }, 3600)).resolves.toBeUndefined();
  });
});
