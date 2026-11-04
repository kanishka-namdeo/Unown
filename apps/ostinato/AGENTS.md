# Ostinato — app DOX (apps/ostinato/)

Landed from `AGENTS.draft.md` (authored by A2 ticket O-1, updated by the
operator at the round closeout 2026-11-04 per the instruction-set gate: the
draft-and-operator-land workflow; the in-session write gate is final).

## Purpose

Ostinato is a **keyboard-first, offline-first, installable PWA for
spaced-repetition flashcards**, at `apps/ostinato/` (the second user
product under `apps/` after Coda — distinct job: decks of markdown
front/back cards scheduled by SM-2, driven entirely by the keyboard:
`j`/`k` browse, `1`–`4` grade, `/` search, `Ctrl+K` palette). Vanilla
TypeScript, **zero runtime dependencies**: `apps/ostinato/package.json`
carries NO `dependencies`/`devDependencies` fields (the Coda zero-dep law —
the app's package.json is 7 lines: the brace pair plus exactly five
fields). The DOM-free domain core under `src/domain/` (deck/card model,
the SM-2 scheduler, import/export) sits under the UI shell (`src/ui/`) and
the persistence adapter (`src/storage/`).

## Ownership

- Owns: `apps/ostinato/**` — `index.html`, `public/`
  (manifest.webmanifest, offline.html, icon.svg), `sw.js` (app root,
  Coda contract: never under public/), `serve.mjs` (app root),
  `src/domain/`, `src/ui/`, `src/storage/`, `scripts/`
  (verify-precache.ts, capture-usage.mjs). No local `tsconfig.json` — the
  app's TypeScript rides the ROOT `tsconfig.json`'s include
  (`apps/ostinato/**/*.ts`), so root `bun run typecheck` is the app's
  typecheck gate.
- Does NOT own: root `bunfig.toml` (Lane B's happy-dom preload), the root
  `package.json`'s `ostinato:*` scripts (wired O-5), the CI `ostinato` job
  (`.github/workflows/ci.yml`, wired O-5), the benchmark lane
  `benchmarks/ostinato/` (operator-owned measurement surface; app tickets
  read RESULTS.md, never write it), the e2e specs at the repo root
  (`e2e/ostinato-*.spec.ts` + `playwright.ostinato.config.ts`), and the
  PRD/reliability matrix under `docs/` (operator lane).

## Local Contracts

- **Zero-dep law.** No dependency fields in `apps/ostinato/package.json`.
  Anything needed is vendored (Coda precedent: `public/vendor/*.mjs` +
  import map — nothing vendored to date; the app needs nothing). The CI
  `ostinato` job asserts the root lockfile hash is untouched by the app.
- **Domain purity (the Coda pair, Ostinato edition).**
  - `src/domain/boundary.test.ts` — the runtime import-graph check:
    every domain module imports only relative `./` (flat directory —
    `../` escapes and are rejected) or `bun:test`; nothing Node-specific,
    no DOM/Node globals (`DOM_GLOBS`). A breach fails the whole suite in
    both lanes.
  - **Lane A** — `cd apps/ostinato && bun test`: no `bunfig.toml` inside
    the app dir, so the root happy-dom preload does NOT apply;
    domain-purity is enforced against a genuinely DOM-free runtime.
  - **Lane B** — `bun test apps/ostinato` from the repo root: the root
    `bunfig.toml`'s preload IS active, so DOM-globally-dependent code
    would be MASKED — the compatibility form, not the purity enforcer.
- **The e2e battery** (O-4): isolated Playwright lane
  (`playwright.ostinato.config.ts` at the repo root, self-skip-guarded
  the Coda way — the root landing lane untouched by construction), five
  specs: the K-1 zero-mouse flow (create → review → export → import,
  keyboard events only), A-1 axe `wcag2a`/`wcag2aa` both schemes + the
  tab-order + Esc focus-return pins, O-1 offline (SW-controlled boot,
  offline reload, the fallback page), R-1 crash-resume + resize, and the
  review trio. 12 specs / 12 green at the closeout receipt.
- **Domain model.** `OstinatoData` = plain JSON at every level (no class
  instances, no Date objects). Per-deck invariant (the Coda
  Board.taskOrder rule): a deck's `cardOrder` set-matches its cards
  exactly — no orphans, no missing entries, no duplicate ids (checked by
  `invariants.ts`'s `assertData`). Cards carry markdown `front`/`back`;
  SM-2 state rides per-card as the optional `sm2` field.
- **The Scheduler seam.** Pure `(card, grade, now) → Card`; "now" is
  injected as an ISO-8601 string — the domain never calls `Date.now()`,
  so scheduling is deterministic and unit-pinnable. The implementation is
  the Wozniak 1990 SM-2 spacing family, cited not re-derived, pinned by
  its own tests.
- **ImportExportPort.** `exportData` byte-stable across boots (matrix
  lane I-1 — canonical JSON, fixed key order, canonical separators),
  `importData` throws `DomainInvariantError` on any invariant breach.
- **Persistence.** localStorage + atomic writes behind the `StoragePort`
  seam (`src/storage/local-storage.ts`, outside the domain):
  temp-key-write + commit-key-swap; an interrupted save orphans the temp
  key that boot `recover()` discards. The UI persists on EVERY
  transition (the O-4 cure for B-3) — a killed mid-review session
  restores its queue and phase by construction.
- **PWA.** `sw.js` at the app root, cache `ostinato-v<N>`, the
  install-time precache of the enumerated runtime closure
  (`PRECACHE_LIST`, 18 entries), the offline fallback page,
  `clients.claim()`. The static derivation proof
  `scripts/verify-precache.ts` (the three-way disk ladder + honesty pins)
  gates drift between the list and the tree; the usage-capture lane
  `scripts/capture-usage.mjs` stills honest app states keyboard-only
  (the `public/landing/ostinato/` stills + PROVENANCE.md — the landing
  band's input).
- **Dev server.** `serve.mjs` at the app root, port `OSTINATO_PORT`
  default 4013: static files + on-the-fly `.ts` transpile
  (Bun.Transpiler "tsx"), the `.js`→`.ts` specifier swap for the compiled
  module graph, 127.0.0.1 only.

## Work Guidance

- New domain files must stay DOM-free: no `document.`/`window.`/
  `indexedDB`/`localStorage`/Node builtins — `boundary.test.ts` fails the
  suite on a breach.
- New model fields: plain JSON only; add the invariant to `assertData` in
  the same change.
- P1 backlog (post-freeze, per the PRD): stats heatmap, deck-level review
  settings, CSV (Anki-style) import, in-app shortcut sheet (`?`). P2
  deferred: accounts/cloud sync, sharing, sub-decks, cloze cards, spaced
  audio.

## Verification

- Lane A: `cd apps/ostinato && bun test` — 93 tests green.
- Lane B: `bun test apps/ostinato` — the same 93 green.
- App typecheck: the ROOT `bun run typecheck` (the root tsconfig's
  include covers `apps/ostinato/**/*.ts` — there is no local tsconfig).
- The e2e battery: `bun run ostinato:e2e` — 12 specs, Chromium.
- The derivation proof: `bun apps/ostinato/scripts/verify-precache.ts` —
  18/0 PASS.
- The closeout receipts: `benchmarks/ostinato/RESULTS.md` +
  `receipts/run-20261104T181704Z/` (the fresh-clone re-run).

## Child DOX Index

- `src/domain/` (the flat directory: types.ts, ports.ts, invariants.ts,
  model.ts, ids.ts, scheduler.ts, storage.ts, io.ts + their tests) —
  keep the directory flat (the boundary test's `../` escape-rejection
  assumes it).
