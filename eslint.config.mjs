import nextConfig from "eslint-config-next/core-web-vitals";
import nextTsConfig from "eslint-config-next/typescript";

/**
 * ESLint 9 flat config.
 *
 * Scope: `src/` only — matches the old `next lint` default behaviour
 * (scans pages/, app/, src/ whichever exists; this project has src/).
 *
 * react-hooks@7 ships many new rules that were absent in v4 (the version
 * bundled with eslint-config-next@15). They are turned off here to preserve
 * behaviour parity with the pre-upgrade baseline; they can be re-enabled
 * deliberately in a follow-up once the codebase is ready.
 *
 * Rules kept off (new in react-hooks@7, not in v4 recommended):
 *   set-state-in-effect, refs, static-components, use-memo,
 *   preserve-manual-memoization, incompatible-library, immutability,
 *   globals, error-boundaries, purity, set-state-in-render,
 *   unsupported-syntax, config, gating
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
      // ── react-hooks@7 new rules (not in v4 recommended) ──────────────────
      // Disable to restore parity with eslint-config-next@15 + react-hooks@4.
      // Re-enable these in a dedicated cleanup pass.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/static-components": "off",
      "react-hooks/use-memo": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/incompatible-library": "off",
      "react-hooks/immutability": "off",
      "react-hooks/globals": "off",
      "react-hooks/error-boundaries": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-render": "off",
      "react-hooks/unsupported-syntax": "off",
      "react-hooks/config": "off",
      "react-hooks/gating": "off",
    },
  },
  {
    ignores: [".next/**", "node_modules/**", "prisma/**"],
  },
];

export default eslintConfig;
