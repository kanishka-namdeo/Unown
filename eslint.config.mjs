import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Coda domain-purity gate (ticket C5, plan step 7a): scope DOM/Node global
// restrictions onto apps/coda/src/domain/**. The design doc's P1 fix —
// "grep-only purity is bypassable" — is enforced here with
// `no-restricted-globals` so a `document.` / `window.` / `indexedDB` /
// `localStorage` reference in a domain module is a lint finding, not a
// missed grep. The IMPORT side of the boundary is the runtime check in
// apps/coda/src/domain/boundary.test.ts (both bun lanes); this config is
// the global-reference half of the pair.
//
// Two files-scoped configs, in precedence order after the broad landing
// configs:
//   1. codaDomainTestConfig (*.test.ts) — the co-located domain tests are
//      allowed to reference DOM globals (they are the unit-under-test mock
//      surface in Lane B) but NOT Node globals (the domain must stay
//      Node-free so the boundary holds on both lanes).
//   2. codaDomainConfig (*.ts, catches the non-test modules) — the strict
//      rule: no DOM globals, no Node globals. boundary.test.ts is excluded
//      from its own scope by the test glob above: it is the scanner itself
//      and legitimately imports node:fs/promises + bun:test.
const CODA_DOMAIN = "apps/coda/src/domain/*.ts"
const CODA_DOMAIN_TESTS = "apps/coda/src/domain/*.test.ts"

// Chaconne domain-purity gate (C-1, PLAN §3/§4 — the Ostinato/Coda
// precedent extended to the fourth app): the domain is DOM-free AND
// Node-free; the runner (C-2+) lives at apps/chaconne/runner/ which is
// deliberately OUTSIDE this scope (the named exception, PLAN §4
// ruling (a) — it imports the repo-root playwright and fs on purpose).
//   1. chaconneDomainTestConfig (*.test.ts) — co-located tests may mock
//      DOM globals (Lane B surface) but NOT Node globals.
//   2. chaconneDomainConfig (*.ts) — the strict rule; boundary.test.ts
//      is excluded by the test glob: it is the scanner itself and
//      legitimately imports node:fs/promises + bun:test.
const CHACONNE_DOMAIN = "apps/chaconne/src/domain/*.ts"
const CHACONNE_DOMAIN_TESTS = "apps/chaconne/src/domain/*.test.ts"

const DOM_GLOBALS = [
  "document", "window", "location", "navigator", "history",
  "indexedDB", "localStorage", "sessionStorage", "caches",
  "fetch", "alert", "confirm", "prompt",
  "requestAnimationFrame", "requestIdleCallback", "postMessage",
]
const NODE_GLOBALS = [
  "process", "require", "module", "exports", "__dirname", "__filename",
]
const restricted = (names, message) =>
  names.map((g) => ({ name: g, message }))

const codaDomainTestConfig = {
  files: [CODA_DOMAIN_TESTS],
  rules: {
    "no-restricted-globals": [
      "error",
      ...restricted(
        [...DOM_GLOBALS, ...NODE_GLOBALS],
        "apps/coda/src/domain/*.test.ts may mock DOM globals (the unit-under-test surface) but must not reference Node globals (the domain stays Node-free on both bun lanes)",
      ),
    ],
  },
}

const codaDomainConfig = {
  files: [CODA_DOMAIN],
  rules: {
    "no-restricted-globals": [
      "error",
      ...restricted(
        [...DOM_GLOBALS, ...NODE_GLOBALS],
        "apps/coda/src/domain/** must stay DOM/Node-free; the import side of the boundary is enforced by boundary.test.ts",
      ),
    ],
  },
}

const chaconneDomainTestConfig = {
  files: [CHACONNE_DOMAIN_TESTS],
  rules: {
    "no-restricted-globals": [
      "error",
      ...restricted(
        [...DOM_GLOBALS, ...NODE_GLOBALS],
        "apps/chaconne/src/domain/*.test.ts may mock DOM globals (the unit-under-test surface) but must not reference Node globals (the domain stays Node-free on both bun lanes)",
      ),
    ],
  },
}

const chaconneDomainConfig = {
  files: [CHACONNE_DOMAIN],
  rules: {
    "no-restricted-globals": [
      "error",
      ...restricted(
        [...DOM_GLOBALS, ...NODE_GLOBALS],
        "apps/chaconne/src/domain/** must stay DOM/Node-free; the import side of the boundary is enforced by boundary.test.ts (the runner at apps/chaconne/runner/ is the PLAN §4 named exception and stays out of scope)",
      ),
    ],
  },
}

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // TypeScript rules
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/prefer-as-const": "off",
      "@typescript-eslint/no-unused-disable-directive": "off",

      // React rules
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
      "react/no-unescaped-entities": "off",
      "react/display-name": "off",
      "react/prop-types": "off",
      "react-compiler/react-compiler": "off",

      // Next.js rules
      "@next/next/no-img-element": "off",
      "@next/next/no-html-link-for-pages": "off",

      // General JavaScript rules
      "prefer-const": "off",
      "no-unused-vars": "off",
      "no-console": "off",
      "no-debugger": "off",
      "no-empty": "off",
      "no-irregular-whitespace": "off",
      "no-case-declarations": "off",
      "no-fallthrough": "off",
      "no-mixed-spaces-and-tabs": "off",
      "no-redeclare": "off",
      "no-undef": "off",
      "no-unreachable": "off",
      "no-useless-escape": "off",
    },
  },
  codaDomainConfig,
  codaDomainTestConfig,
  chaconneDomainConfig,
  chaconneDomainTestConfig,
  {
    ignores: ["node_modules/**", ".next/**", ".vercel/**", "out/**", "build/**", "next-env.d.ts", "examples/**", "skills", "pi-repo/**", "mini-services/**", "data/**", "download/**", "upload/**", "tests/**", ".zscripts/**", "src/generated/**", "benchmarks/**", "scripts/vendor/**", "scripts/tui-capture/**"],
  },
]

export default eslintConfig;
