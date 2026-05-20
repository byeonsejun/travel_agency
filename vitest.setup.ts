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
