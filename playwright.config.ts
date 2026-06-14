import { defineConfig, devices } from "@playwright/test";
import { loadEnvFromDotenv } from "./tests/e2e/helpers/loadEnv";

// 테스트 러너 프로세스에 AUTH_SECRET을 공급(쿠키 서명용). .env는 읽기만 한다.
loadEnvFromDotenv();

// E2E 전용 포트 — 사용자가 띄워둘 수 있는 기본 dev(3000)와 충돌 회피.
const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * E2E 스모크 설정.
 *
 * 결제 격리(★ .env 무변경): `webServer.env`로 Mock 모드 변수만 next dev 프로세스에
 * 주입한다. Next는 process.env에 *이미 존재하는* 키를 .env로 덮어쓰지 않으므로,
 * 아래 PAYMENT_FORCE_REAL=0 / TOSS_API_BASE_URL=localhost:4242가 .env 값을 이긴다.
 *   → devFallback = (NODE_ENV!==production && !PAYMENT_FORCE_REAL) = true
 *   → 결제 confirm은 localhost:4242 Mock 토스로만 나간다(외부 부작용 0).
 */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1, // 좌석 CAS 차감 등 상태 변경 — 직렬 실행으로 결정성 확보
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],

  webServer: [
    {
      // Mock 토스 결제 서버 (:4242) — confirm/cancel을 로컬에서 200 처리.
      command: "npx tsx scripts/qa/mock-toss-server.ts",
      port: 4242,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
      env: { MOCK_TOSS_SCENARIO: "success" },
    },
    {
      // Mock 모드 env로 next dev 기동 (.env 미변경 — webServer.env가 우선).
      command: `npx next dev --port ${PORT}`,
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000, // Next 16 Turbopack 최초 컴파일 여유
      stdout: "pipe",
      stderr: "pipe",
      env: {
        PAYMENT_FORCE_REAL: "0",
        TOSS_API_BASE_URL: "http://localhost:4242",
      },
    },
  ],
});
