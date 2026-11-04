# Ostinato — app DOX DRAFT (apps/ostinato/)

> **Draft — operator-landed, not in force.** Authored by A2 ticket O-1;
> lands as `apps/ostinato/AGENTS.md` via the instruction-set gate at the
> round closeout (the A2 draft-and-operator-land workflow; the
> instruction-set write gate is final). Until it lands, this file is
> advisory context, not a binding contract.

## Purpose

Ostinato is a **keyboard-first, offline-first, installable PWA for
spaced-repetition flashcards**, at `apps/ostinato/` (the second user
product under `apps/` after Coda — distinct job: decks of markdown
front/back cards scheduled by SM-2, driven entirely by the keyboard:
`j`/`k` browse, `1`–`4` grade, `/` search, `Ctrl+K` palette). Vanilla
TypeScript, **zero runtime dependencies**: `apps/ostinato/package.json`
carries NO `dependencies`/`devDependencies` fields (the Coda zero-dep
law — the app's package.json is 7 lines: the brace pair plus exactly five
fields: name/version/private/type/description). The DOM-free domain
core under `src/domain/` (deck/card model, the Scheduler port, the
import/export port) sits under a UI shell that does not exist yet (O-3);
the O-1 skeleton ships the model + ports + boundary test + dev server +
offline PWA stubs only.

## Ownership

- Owns: `apps/ostinato/**` — `index.html`, `public/`
  (manifest.webmanifest, offline.html, icon.svg), `sw.js` (app root,
  Coda contract: never under public/), `serve.mjs` (app root),
  `src/domain/` (types.ts, ports.ts, invariants.ts, boundary.test.ts),
  and the app's local `tsconfig.json` when O-3 adds the UI shell's
  typecheck surface.
- Does NOT own: root `bunfig.toml` (Lane B's happy-dom preload), the
  root `package.json` (no `ostinato:*` scripts yet — O-5 lands CI
  wiring), the benchmark lane `benchmarks/ostinato/` (operator-owned
  measurement surface; app tickets read RESULTS.md, never write it),
  and the PRD/reliability matrix under `docs/` (operator lane).

## Local Contracts

- **Zero-dep law.** No dependency fields in `apps/ostinato/package.json`.
  Anything a later ticket needs is vendored (Coda precedent:
  `public/vendor/*.mjs` + import map). CI wiring (O-5) will assert the
  lockfile hash is untouched by the app.
- **Domain purity (the Coda pair, Ostinato edition).**
  - `src/domain/boundary.test.ts` — the runtime import-graph check:
    every domain module imports only relative `./` (flat directory —
    `../` escapes and is rejected) or `bun:test`; nothing
    Node-specific, no DOM/Node globals. A breach fails the whole suite
    in both lanes.
  - **Lane A** — `cd apps/ostinato && bun test`: no `bunfig.toml`
    inside the app dir, so the root happy-dom preload does NOT apply;
    domain-purity is enforced against a genuinely DOM-free runtime.
  - **Lane B** — `bun test apps/ostinato` from the repo root: the root
    `bunfig.toml`'s preload IS active, so DOM-globally-dependent code
    would be MASKED — the compatibility form, not the purity enforcer.
    O-5 wires the e2e battery (Playwright, self-skip guard, its own
    config; the root landing lane is untouched).
- **Domain model (P0 #1, O-1 pinned).** `OstinatoData` = plain JSON at
  every level (no class instances, no Date objects). Per-deck invariant
  (the Coda Board.taskOrder rule): a deck's `cardOrder` set-matches its
  cards exactly — no orphans, no missing entries, no duplicate ids
  (checked by `invariants.ts`'s `assertData`). Cards carry markdown
  `front`/`back`; SM-2 state rides per-card as the optional `sm2` field
  (shape pinned O-1, logic O-2).
- **Ports.** `Scheduler` (the O-2 seam: pure `(card, grade, now) →
  Card`; "now" is injected as an ISO-8601 string — the domain never
  calls `Date.now()`, so scheduling is deterministic and unit-pinnable)
  and `ImportExportPort` (the P0 #7 seam: `exportData` byte-stable
  across boots — matrix lane I-1 — `importData` throws
  `DomainInvariantError` on any invariant breach). Both are type-only
  at O-1; implementations land with their tickets.
- **PWA stubs.** `sw.js` is an offline STUB (Coda-prefaced placeholder
  per O-1): classic worker at the app root, `ostinato-v0` cache,
  precaches index.html + offline.html, network-first with cache
  fallback, offline.html navigation catch. The full precache design
  (PRECACHE_LIST derived from the runtime import graph, verify-precache
  script, versioned cache) lands at O-5 once O-3 creates the runtime
  closure to enumerate. `index.html` carries the manifest link but NO
  module script yet — nothing to precache.
- **Dev server.** `serve.mjs` at the app root (the Coda `scripts/`
  shape would only matter after the app grows an import map; the
  skeleton keeps it at the root, port `OSTINATO_PORT` default 4013):
  static files + on-the-fly `.ts` transpile (Bun.Transpiler "tsx"),
  extensionless import resolution, 127.0.0.1 only.

## Work Guidance

- Non-overlap for O-1: no SM-2 scheduling logic (O-2), no review
  runner / keyboard surface (O-3), no e2e battery (O-4), no PWA capture
  lane / CI wiring (O-5), no landing/blog/README surfaces (O-6).
- New domain files must stay DOM-free: no `document.`/`window.`/
  `indexedDB`/`localStorage`/Node builtins — `boundary.test.ts` fails
  the suite on a breach.
- New model fields: plain JSON only; add the invariant to
  `assertData` in the same change.

## Verification

- Lane A boot: `cd apps/ostinato && bun test` — the boundary test plus
  the invariant boot (O-1: 2 tests, green).
- When O-3 adds `src/` UI code: app `tsc` via the local
  `tsconfig.json` (Coda shape: strict, ES2022, bundler resolution,
  `src/**/*.ts` include) joins the gate battery.
- e2e (O-4/O-5): isolated Playwright config, self-skip guard; axe
  `wcag2a`/`wcag2aa`, keyboard-only create → review → export, offline
  boot, crash-resume — each naming its verifier per the PRD's
  hardening table.

## Child DOX Index

- `src/domain/` (this flat directory: types.ts, ports.ts, invariants.ts,
  boundary.test.ts) — O-2 may add `scheduler.ts` (SM-2) and O-3 the
  repository/persistence layer; keep the directory flat (the boundary
  test's `../` escape-rejection assumes it).
