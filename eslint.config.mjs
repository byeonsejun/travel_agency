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
];

export default eslintConfig;
