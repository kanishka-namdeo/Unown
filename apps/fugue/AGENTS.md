# Fugue — DOX

## Purpose

Fugue is the repo's fourth self-contained user product: a keyboard-first,
offline-capable **PWA console for the engine's own automation + learning
loop** (`apps/fugue/`) — author, pause, resume, skip, snooze and run-now the
engine's scheduled agent jobs; watch runs back with honest status and tokens;
curate the AutoDream journal, the tiered memory and the staged-skills queue.
The Sonata round's DRIVE-track vehicle (`docs/fugue-prd.md`, `docs/fugue.md`).

## Ownership

- `src/domain/` — the pure core (job state machines, run records, invariants).
- `src/ui/` — the PWA shell (palette, lists, detail panes).
- `src/adapter/` — the engine boundary (fixtures-live lane: the app test
  surface against the fixture engine's canned contract-pinned JSON, never
  the live network; the boundary pin is `boundary-adapter.test.ts`).
- `serve.mjs` (:4015), `e2e/` — the lanes. The fixture engine rides :4130.

## Local Contracts

- **Zero-dep law**: nothing vendored, nothing installed.
- **`FUGUE_E2E`** arms the Playwright e2e battery (specs self-skip without
  it); `bun run fugue:e2e` from the repo root.
- `/health` answers `{ok, port}` on :4015 — the serve-lane contract.
- The live network is the OFF-PEAK proof lane, operator-witnessed, never a
  capture lane; every CI lane runs against fixtures.
- Honest scope: Chromium-desktop-only.

## Work Guidance

- The round records: `PLAN.md` + `NOTES-F*.md` + the Sonata round's
  validation log — read before editing the adapter or the flows.
- The off-peak live probe is receipted (`FUGUE_LIVE_OK` notes); do not turn
  it into a capture lane.

## Verification

- `bun run fugue:test` from the repo root (300 tests / 32 files at
  v0.0.61, includes the self-skip-guarded e2e stubs).
- `bun run fugue:e2e` (Chromium installed).
- Manual: `sw.js`'s PRECACHE_LIST maps to disk (a `verify-precache.ts`
  script in the app's siblings' shape is the one missing lane — a future
  round's cheap add).

## Child DOX Index

- none (flat app)
