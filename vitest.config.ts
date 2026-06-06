import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "happy-dom",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/**/*.test.ts", "scripts/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
  // tsconfig.json의 jsx="preserve"는 Next 컴파일러용. Vitest는 esbuild로 변환하므로
  // React 17+ 자동 JSX runtime을 명시해 컴포넌트 테스트에서 React import 없이도 동작.
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      // server-only는 Next.js 런타임에서 클라이언트 번들 침투를 막는 guard다.
      // vitest(Node.js 환경)에서는 의미가 없으므로 no-op 빈 모듈로 대체.
      // 이 aliasing은 "server-only 경계를 우회"하는 것이 아니라,
      // "guard가 테스트 툴체인과 호환되게 하는" 표준 패턴이다.
      "server-only": resolve(__dirname, "./src/shared/lib/__tests__/__mocks__/server-only.ts"),
    },
  },
});
