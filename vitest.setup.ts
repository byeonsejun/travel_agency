import { vi } from "vitest";

// vitest 부팅 시 process.env에 최소 dummy 값을 주입한다.
// shared/lib/env.ts가 import 시점에 envSchema.parse(process.env)를 실행하므로,
// .env를 자동 로드하지 않는 vitest 환경에서 fail-fast가 발동하지 않도록 폴백 제공.
// 기존 값이 있으면 그대로 사용(??=) — CI에서 비밀 주입을 막지 않음.
// 다른 테스트들은 `vi.mock("@/shared/lib/env", ...)` 패턴으로 env 모듈 자체를 모킹하므로 무영향.
process.env.DATABASE_URL ??= "postgresql://localhost:5432/test";
process.env.DIRECT_URL ??= "postgresql://localhost:5432/test";
process.env.AUTH_SECRET ??= "x".repeat(32);
process.env.USE_REAL_EMBEDDING ??= "0";
process.env.PAYMENT_FORCE_REAL ??= "0";
// NODE_ENV=test에서 운영 토스 도메인 호출은 envSchema가 차단한다(ADR-0009).
// 모듈 부팅 시점에 default인 https://api.tosspayments.com이 발동하지 않도록
// 로컬 Mock 도메인으로 폴백 주입.
process.env.TOSS_API_BASE_URL ??= "http://localhost:4242";
// Phase 12 — AES-256 암호화 키 더미 주입.
// Buffer.from("x".repeat(32))는 정확히 32바이트 → envSchema 포맷 가드 통과.
// 실제 테스트에서 vi.mock 없이 real env 모듈을 사용하는 crypto 테스트를 위해 필요.
process.env.ENCRYPTION_KEY ??= Buffer.from("x".repeat(32)).toString("base64");

// [Phase 5-C / ADR-0053] next/cache 전역 모킹.
// 'use cache' 데이터레이어 함수가 호출하는 cacheTag/cacheLife는 use-cache 스코프
// (Next 빌드 변환) 밖에서 실행되면 throw한다. vitest는 그 변환이 없으므로 no-op으로
// 대체해, 데이터레이어 단위테스트가 함수를 직접 호출해도 안전하게 한다.
// unstable_cache는 fn 그대로 실행하는 pass-through(기존 동작 보존).
// revalidateTag/updateTag/revalidatePath도 no-op — 무효화는 단위테스트 관심사 아님.
// 개별 테스트가 자체 vi.mock("next/cache")로 오버라이드하면 그것이 우선(로컬 우선).
vi.mock("next/cache", () => ({
  unstable_cache:
    (fn: (...a: unknown[]) => unknown) =>
    (...a: unknown[]) =>
      fn(...a),
  cacheTag: () => {},
  cacheLife: () => {},
  revalidateTag: () => {},
  updateTag: () => {},
  revalidatePath: () => {},
}));
