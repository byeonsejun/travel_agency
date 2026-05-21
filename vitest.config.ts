import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "happy-dom",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/**/*.test.ts"],
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
    },
  },
});
