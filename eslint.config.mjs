import nextConfig from "eslint-config-next/core-web-vitals";
import nextTsConfig from "eslint-config-next/typescript";

/**
 * ESLint 9 flat config.
 *
 * Scope: `src/` only — matches the old `next lint` default behaviour
 * (scans pages/, app/, src/ whichever exists; this project has src/).
 *
 * react-hooks@7 ships many new rules that were absent in v4 (the version
 * bundled with eslint-config-next@15). 14 rules were originally turned off
 * for parity; Phase 5-C re-enabled all of them as `error`, refactoring the
 * 8 violation sites (7×set-state-in-effect, 1×refs) to React 19
 * compiler-friendly patterns. No react-hooks@7 rule remains disabled.
 */
const eslintConfig = [
  // Only lint src/ — mirrors old `next lint` default scope
  {
    ignores: [
      "**/*",
      "!src/**",
    ],
  },
  ...nextConfig,
  ...nextTsConfig,
  {
    ignores: [".next/**", "node_modules/**", "prisma/**"],
  },
  // FSD R2 (docs/superpowers/skills/architect.md) — 슬라이스는 배럴로만 소비한다.
  // 문서에만 있던 규칙을 기계적으로 강제하는 곳. 깊은 경로 import를 error로 막는다.
  //
  // 예외는 "정식 2번째 공개 API"로 선언된 서브배럴 두 종류뿐이다:
  //   @/entities/*/client — client 코드가 server 그래프를 끌어오지 않게 하는 엔트리
  //   @/features/*/server — server 코드가 client 그래프를 끌어오지 않게 하는 엔트리
  // 새 심볼이 필요하면 예외를 늘리지 말고 해당 슬라이스 index.ts에 명시적
  // named export를 추가할 것(R2: export * 금지).
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/entities/*/*",
                "@/features/*/*",
                "@/widgets/*/*",
                "!@/entities/*/client",
                "!@/features/*/server",
              ],
              message:
                "FSD R2: 슬라이스 배럴(@/{layer}/{slice})로 import하세요. " +
                "필요한 심볼이 없으면 해당 슬라이스의 index.ts에 명시적 named export를 추가할 것.",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
