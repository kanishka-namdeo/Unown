# Bolero — DOX

## Purpose

Bolero is the repo's status-board product: a keyboard-first **watch runner
UI + API** (`apps/bolero/`) — registered watches run their recipes against
fixture pages, the server records runs + artifacts, the PWA board renders
history, screenshots and failure states honestly.

## Ownership

- `src/domain/` — the pure core (watch specs, run reports, invariants,
  `assertWatch`/`assertReport`).
- `src/runner/` — execution (the Playwright adapter + executor + the
  sha256 content-addressed artifact lane).
- `src/server/` — the API (`boot.ts` :4050; `/health` answers the
  `{phase, pid, version, queue}` shape; `/api/watches` the registry).
- `src/ui/` + the static shell (:4051), `e2e/` — the lanes.

## Local Contracts

- **Zero-dep law by construction**: no `package.json` at all (the only app
  of the six without one — nothing to install; adding one must carry a
  zero-dep justification or a recorded root dep).
- **`BOLERO_E2E=1`** arms the e2e battery (`bun run bolero:e2e`); the specs
  self-skip in the unit lane (`runner-smoke.test.ts`, `dashboard-flow.test.ts`).
- The runner imports the repo-ROOT playwright (same ruling as Chaconne).
- Honest scope: Chromium-desktop-only; fixtures only in every test lane.

## Work Guidance

- `PLAN.md` is the engineering record (the E-04 duplicate-name reject,
  §5's health shape); read before editing the API surface.
- The keyboard-only usage-capture lane is the UI contract — pointer paths
  are not the product surface.

## Verification

- `bun run bolero:test` from the repo root (44 tests / 9 files at v0.0.61).
- `bun run bolero:e2e` with `BOLERO_E2E=1` (Chromium installed).
- `bun run bolero:server` + `curl :4050/health` for the API smoke;
  `bun apps/bolero/scripts/verify-precache.ts` (6/0).

## Child DOX Index

- none (flat app)
