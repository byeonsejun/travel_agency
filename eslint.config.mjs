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
 * for parity; 13 rules re-enabled in Phase 5-C Tasks 1–2.
 *
 * Rules still off (violation sites to be fixed in Tasks 3–5):
 *   set-state-in-effect (7 sites)
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
    rules: {
      // react-hooks@7: set-state-in-effect만 위반 사이트 리팩터 전까지 임시 off.
      // refs 포함 13규칙은 위반 0으로 활성화됨. classic rules-of-hooks/exhaustive-deps도 활성.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    ignores: [".next/**", "node_modules/**", "prisma/**"],
  },
];

export default eslintConfig;
