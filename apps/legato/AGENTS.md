# Legato — app DOX (apps/legato/)

Landed by the operator at the L-1 close (2026-11-07, the Serenade round)
per the instruction-set gate: the draft-and-operator-land workflow — the
in-session write gate denied A2's landing attempt (and a worker
subagent's), so the operator lands the DOX. Binding spec:
[`PLAN.md`](./PLAN.md) (L-0, scored 100/100) · product spec:
[`docs/vivace-prd.md`](../../docs/vivace-prd.md) · round:
[`docs/serenade-round-session.md`](../../docs/serenade-round-session.md).

## Purpose

Legato is a **keyboard-first, offline-first, installable read-later /
web-clip PWA**, at `apps/legato/` (the fifth user product under `apps/`
after Coda, Ostinato, Chaconne and Fugue — distinct job: clip any URL →
a clean readable copy stored locally, find it again with full-text
search + tags, read in a keyboard-driven queue, highlight what
mattered, carry everything in a byte-stable JSON bundle — offline-first,
no account, no server). Vanilla TypeScript, **zero runtime
dependencies**: `apps/legato/package.json` carries no
`dependencies`/`devDependencies` fields. The DOM-free/Node-free domain
core under `src/domain/` (the `legato.v1` clip grammar, tags, queue
states, highlights, search, canonical JSON) sits under the UI shell
(`src/ui/`), the storage seam (`src/storage/`, IndexedDB behind
`StoragePort` — the deliberate departure from the house localStorage
pattern: clip bodies exceed its quota) and the clip pipeline seam
(`src/pipeline/`, `Fetcher`/`Extractor` — **browser-side**; the plan's
seam ruling: `window.fetch` + `DOMParser` inside the PWA closure, no
Node `runner/` edge — the Chaconne precedent reshaped).

## Ownership

- Owns: `apps/legato/**` — `index.html`, `serve.mjs` (app root),
  `src/{domain,storage,pipeline,ui}/`, the app-local `tsconfig.json`
  (extends the root — the Fugue sibling convention), the `fixtures/`
  hostile-page dir + `scripts/fixture-server.mjs` (L-3+), `sw.js` +
  `public/` (L-10), `scripts/verify-precache.ts` (L-10).
- Does NOT own: the root `package.json`'s `legato:*` scripts, the CI
  `legato` job (both are L-13 — the fugue F-11 precedent: root wiring
  lands as its own ticket, last of all), the benchmark lane
  `benchmarks/serenade-round/` (operator-owned measurement surface), the
  e2e specs at the repo root (`e2e/legato-*.spec.ts` +
  `playwright.legato.config.ts`, L-10/L-11), and the PRD/round docs
  under `docs/` (operator lane).

## Local Contracts

- **Zero-dep law.** No dependency fields in `apps/legato/package.json`.
  Anything needed is vendored (the Coda precedent; nothing vendored to
  date — the app needs nothing).
- **Domain purity + the boundary test.**
  `src/domain/boundary.test.ts` — the real `node:fs` scanner: every
  `.ts` file under `src/` imports only relative `./`/`../` (up-depth ≤ 1
  — `../../` escapes the `src/**` closure and is rejected; stricter than
  PLAN §1.1's letter, receipted at L-1 as a safe deviation) or
  `bun:test`; nothing Node-specific or DOM-global in non-test modules.
  **Lane A** — `cd apps/legato && bun test`: no `bunfig.toml` in the app
  dir, the root happy-dom preload does NOT apply — the purity enforcer.
  **Lane B** — `bun test apps/legato` from the root: preload active,
  the compatibility form.
- **The `legato.v1` grammar** (PLAN §2, lands L-2): `Clip` records,
  closed enums (`ClipState`, the 7-entry `ClipError` taxonomy),
  deterministic integer ids, canonical JSON (sortKeysDeep + compact
  separators), the import-gate law (foreign schema → dry-run report
  refusal, store never touched).
- **The error taxonomy is product surface** (PLAN §4.1, T-1..T-7):
  `charset-unknown` · `redirect-loop` · `js-walled` (title+URL+flag, the
  "open in browser" affordance — the FALLBACK lane, never a bypass) ·
  `paywalled` (excerpt + link, never bypass) · `oversized` (500 KB
  extract cap, prefix retained) · `empty-text` (title+URL fallback) ·
  `fetch-failed` (never a silent hang).
- **Ports.** `LEGATO_PORT` default **4017** (allocation: 4012 coda ·
  4013 ostinato · 4014 chaconne · 4015/4016 fugue+capture · 4050/4051
  bolero; 4018 is this app's fixture/capture lane). `serve.mjs`'s header
  carries the port history. `GET /health` answers `{"ok":true,"port":…}`.
- **The B-16 holdout law** (L-3): the frozen hostile fixture is
  re-run at L-11; a regression is a red gate, never a silent quality
  dip.

## Work Guidance

- The build order is PLAN §3's queue L-1→L-12 (+ L-13 root wiring,
  separate); do not fold tickets.
- New domain fields: plain JSON only, invariant added in the same
  change (the Coda law).
- e2e specs live at the repo root with the `LEGATO_E2E` self-skip
  marker (the Coda/Ostinato/Fugue precedent) — the root landing lane
  stays untouched by construction.
- P1 backlog (post-freeze, per the PRD): browser-extension quick
  capture, reading-time estimates, per-tag digests, WebDAV file sync,
  Firefox/WebKit full batteries.

## Verification (at this L-1 close)

- Lane A: `cd apps/legato && bun test` — 1 test (the boundary pin)
  green, 0 fail.
- App typecheck: the ROOT `bun run typecheck` (the root tsconfig's
  include covers `apps/legato/**/*.ts`; the app-local tsconfig extends
  the root per the Fugue convention).
- `curl -s http://127.0.0.1:4017/health` → `{"ok":true,"port":4017}`.
- The receipts: `benchmarks/serenade-round/receipts/l1.md`.

## Child DOX Index

- `src/domain/` — the grammar + search + io (L-2..L-4, L-9); keep
  layer dirs flat (the boundary test's up-depth ≤ 1 law).
- `src/storage/` — `StoragePort`, the IDB adapter, the in-memory fake,
  the migration frame (L-2).
- `src/pipeline/` — `Fetcher`/`Extractor`, the taxonomy, the fixtures
  lane (L-3).
- `src/ui/` — the keyboard-first shell, palette, list/detail, theme
  (L-5..L-8).
