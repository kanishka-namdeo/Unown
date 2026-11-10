# Chaconne — DOX

## Purpose

Chaconne is the repo's third self-contained user product: a keyboard-first,
self-hosted **browser-recipe runner PWA** (`apps/chaconne/`). Compose a flow
once (goto / click / fill / select / wait / assert / extract / screenshot) —
it repeats on demand or on schedule against local fixture pages, capturing
sha256-pinned artifacts and honest run records. The Rondo round's DRIVE-track
vehicle (`docs/chaconne-prd.md`, `docs/rondo-round-session.md`).

## Ownership

- `src/domain/` — the pure core (recipes, invariants, the 7-lane error
  taxonomy). DOM-free by construction; enforced by `boundary.test.ts`.
- `src/ui/` — the PWA shell (keyboard-only, the palette).
- `runner/` — the execution lane: `page-adapter.ts` (the FakePageAdapter,
  deterministic) and `real-adapter.ts` (real Chromium via the repo-root
  playwright).
- `serve.mjs` (:4014), `scripts/verify-precache.ts`, `e2e/` — the lanes.

## Local Contracts

- **Zero-dep law**: no dependencies/devDependencies; CI asserts the
  lockfile stays byte-identical after a frozen install.
- **Runner dep ruling (PLAN §4)**: the runner imports the repo-ROOT
  playwright — an app-local dependency would break the zero-dep law.
- **`CHACONNE_E2E`** arms the Playwright e2e battery in
  `playwright.chaconne.config.ts` ONLY (specs self-skip under the root
  landing lane). `bun run chaconne:e2e` from the repo root.
- **`CHACONNE_REAL_SMOKE=1`** arms `runner/real-smoke.test.ts` (the one
  real-browser smoke; every other lane sees it self-skip with the arm hint —
  Lane A/B run before any browser exists in CI). CI runs it armed AFTER
  `playwright install chromium`.
- Honest scope: Chromium-desktop-only PWA; test lanes run against LOCAL
  fixture pages, never the live network.

## Work Guidance

- The plan queue, edge-case rows and receipts live in `PLAN.md` +
  `benchmarks/rondo-round/receipts/` — read before editing a lane.
- New step kinds extend `src/domain/` first (invariants + taxonomy), then
  the adapters, then the UI.

## Verification

- Lane A: `cd apps/chaconne && bun test` (DOM-free enforcement; 119 tests
  at v0.0.61 — includes the self-skipped real-smoke stubs).
- Lane B: `bun test apps/chaconne` from the repo root (preload active,
  masked by design).
- `bun apps/chaconne/scripts/verify-precache.ts` (21/0 at v0.0.61).
- `bun run chaconne:e2e` (Chromium installed); the armed smoke:
  `CHACONNE_REAL_SMOKE=1 bun test runner/real-smoke.test.ts`.

## Child DOX Index

- none (flat app; `PLAN.md` is the engineering record, not DOX)
