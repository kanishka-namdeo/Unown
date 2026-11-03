# Coda — app DOX (apps/coda/)

## Purpose

Coda is a **local-first, offline-first, installable PWA for markdown notes +
task boards**, at `apps/coda/`. Vanilla TypeScript, **zero dependencies**:
`apps/coda/package.json` declares no `dependencies`/`devDependencies` at all —
the file is 7 lines (the brace pair plus exactly five fields:
name/version/private/type/description). The two pure
third-party modules (`fuse.js`, `marked`) are **vendored** as browser-ESM
copies under `apps/coda/public/vendor/` (`fuse.mjs`, `marked.mjs`) and wired
by the relative import map in `index.html:16-20` — root `bun install` never
adds a package for Coda, and the CI lockfile-drift assert catches it if that
ever changes.

## Ownership

- Owns: `apps/coda/**` — `index.html`, `public/` (manifest.webmanifest, sw.js,
  offline.html, vendor/, icons), `scripts/serve.mjs`, `src/` (domain/, ui/,
  db/, app.ts, main.ts, coda.css, sw.js sits at the app root), the app's
  strict local `tsconfig.json`, and the domain's own README
  (`src/domain/README.md`).
- Does NOT own: the root `tsconfig.json`'s `apps/coda/**/*.ts` include
  (C5 wiring), `eslint.config.mjs`'s `no-restricted-globals` coda scope,
  the root `package.json`'s `coda:*` scripts, the `coda` CI job, and the
  `CODA_E2E` marker inside `playwright.coda.config.ts` — shared-surface
  contracts the app relies on, not the app's files.
- The e2e specs live at the **repo root**: `e2e/coda-offline.spec.ts` +
  `e2e/coda-a11y.spec.ts` (5 tests total), driven by root
  `playwright.coda.config.ts` whose webServer boots `bun apps/coda/scripts/serve.mjs`
  on :4012.

## Local Contracts

- **Zero-dep law.** `apps/coda/package.json` carries no dependency fields
  (7 lines: the brace pair + five fields). The CI `coda` job runs `bun install --frozen-lockfile`
  then asserts `sha256sum bun.lock` equals `git show HEAD:bun.lock`
  (`.github/workflows/ci.yml`, the coda job's "Lockfile unchanged assert"
  step, landing with C5). A root dep Coda pulls in moves the hash and reds.
- **Test lanes — and which one enforces purity.**
  - **Lane A** — `cd apps/coda && bun test` (the `bun run coda:test` form):
    no `bunfig.toml` exists inside `apps/coda/` (verified 2026-11-03, C5
    chunk 5 — the only `bunfig.toml` is the repo root's), so bun's
    cwd-bounded config resolution finds no preload; the root happy-dom DOM
    globals are ABSENT; domain-purity is enforced against a genuinely
    DOM-free runtime. 51 tests.
  - **Lane B** — `bun test apps/coda` from the repo root (the `bun test
    apps/coda` CI step): the root `bunfig.toml`'s `[test] preload`
    (happy-dom, `src/test-dom-setup.ts`) IS active, so DOM-globally-dependent
    domain code would be MASKED — the developer-typed compatibility form,
    not the purity enforcer. `boundary.test.ts` still runs and still
    enforces the import graph here. 51 tests.
- **Domain-purity pair** (grep alone is bypassable — the design doc's P1
  fix this pair closes):
  - `src/domain/boundary.test.ts` (88 lines) — the runtime import-graph
    check: every domain module imports only relative `./` (the domain is a
    flat directory), `fuse.js`, or `bun:test`; nothing Node-specific. A
    breach fails the whole suite in both lanes. It re-implements a small
    scanner in plain JS so it survives the repo's TS-unfriendly PostToolUse
    hook.
  - `eslint.config.mjs` — `no-restricted-globals` scoped onto
    `apps/coda/src/domain/*.ts` (the strict: no DOM, no Node globals) and
    the `*.test.ts` twin (DOM allowed as mock surface, Node forbidden).
    A stray `document.` in a domain module is a lint error, not a missed
    grep.
- **Type-keyword import law** (C2's browser-link law). Every type-only
  symbol imported across modules carries the `type` keyword —
  `src/ui/tasks.ts:10` `import { type Note, type TaskStatus } from
  "../domain/types"`; `src/ui/notes.ts:13` `import type { Note } from
  "../domain/types"`. Bun's isolated-module transpile keeps an
  unmarked type import as a VALUE import; the browser's module linker
  rejects it and the app sits at "Booting…" with zero console errors.
  tsc-green + bun-test-green does NOT prove browser-link-green; the C4
  lane (`bun run coda:e2e`) or a headless boot check does.
- **`node --check` for every non-TS artifact** (C3's law). `sw.js`,
  `serve.mjs`, manifest JSON, `offline.html` — anything non-TS you touch
  passes `node --check` (or a documented structural equivalent) in the
  same change. tsc never sees `sw.js`; a dead TS signature inside it
  evaluates-failed in the browser while tsc stayed green.
- **`CODA_E2E` self-skip guards are load-bearing** (the C4-collision law).
  `e2e/coda-offline.spec.ts:3` and `e2e/coda-a11y.spec.ts:4` open with
  `test.skip(!process.env.CODA_E2E, "coda lane only — run via
  playwright.coda.config.ts")`. `playwright.coda.config.ts` arms the marker
  (`process.env.CODA_E2E = "1"`, module scope); the root `playwright.config.ts`
  never does — so under the root lane the 5 coda tests are collected
  (testDir "e2e", recursive) but SKIP at run-time, and the landing lane
  stays green and untouched. Never weaken or remove the guards.
- **Service-worker scope law.** The SW lives at `apps/coda/sw.js` — the
  APP ROOT, not `public/` (a `public/sw.js` worker can never control the
  app root: a worker's max allowable scope is the directory its script is
  served from). Registration is relative: `src/main.ts:18`
  `navigator.serviceWorker.register("./sw.js", { scope: "./" })`, and the
  manifest's `start_url`/`scope` are `"./"` (`public/manifest.webmanifest`),
  so the app works from ANY mount point.
- **Local-first data story.** One IndexedDB, one object store, the whole
  serialized `CodaData` document — `DB_NAME = "coda"` / `STORE_NAME =
  "state"` (`src/db/idb.ts:14-16`), a single `STATE_KEY` row
  (`src/db/idb.ts:45` reads / `:56` writes / `:68` deletes). No schema
  fork: `store.toSerialized()` IS the byte-format (export/sync later is a
  non-rewrite; the grammar is `src/domain/store.ts`). `storage.persist()`
  is asked at boot (`src/app.ts:96`) to push Coda's storage out of the
  eviction candidates.
- **Platform scope is Chromium-desktop-only.** Safari/Android/Firefox are
  untested/deferred, not "cross-platform". Do not add a claim that widens
  it (the plan's P1 overpromise fix).

## Work Guidance

- **Run it:** `bun run coda:dev` (root script → `bun apps/coda/scripts/serve.mjs`,
  the transpiling static server, default `http://127.0.0.1:4012`, override
  with `CODA_PORT` — `scripts/serve.mjs` reads `process.env.CODA_PORT ?? 4012`).
  bun-only (`Bun.Transpiler`), and it MUST use `transformSync`, not the
  async `transform` — `new Response(promise)` coerces the body to the
  literal string `"[object Promise]"` and the app sits at "Booting…"
  (the C4 operator-unblock bug class).
- **Test it:** `bun run coda:test` (Lane A, the enforcement lane) ·
  `bun test apps/coda` (Lane B, masked) · `bun run coda:e2e` (→
  `bunx playwright test -c playwright.coda.config.ts`, 5 specs; the
  config's webServer boots serve.mjs itself — in CI
  `reuseExistingServer` is `!process.env.CI` so it always starts fresh).
- **Type-check it:** `bunx tsc -p apps/coda/tsconfig.json --noEmit` (the
  app's own stricter tsconfig: ES2022 + DOM libs) AND `bun run typecheck`
  (the root tsconfig includes `apps/coda/**/*.ts` since C5). Both green
  in the same change.
- **Edit the domain:** stay import-bounded to `./`, `fuse.js`, `bun:test`.
  Add a pure module + its co-located `*.test.ts`; `boundary.test.ts`
  walks the directory, so new files are in scope automatically.
- **Edit the UI:** carry the `type` keyword on type-only imports; run
  `bun run coda:e2e` after — tsc/test-green alone does not prove the
  browser link.
- **Edit the PWA layer:** bump `CACHE_NAME` ("coda-v1", `sw.js:34`) when
  the precache set changes; `PRECACHE_LIST` (`sw.js:39`+) must enumerate
  every URL the browser closure actually loads — verified by
  `scripts/verify-precache.ts` (the C3 23/23 lane). `markdown.ts` is
  deliberately absent from the closure (only test files import it).
  `sw.js` + `serve.mjs` get `node --check` in the same change.

## Verification

- `bun run coda:test` → 51/51 (Lane A, DOM-free). `bun test apps/coda` →
  51/51 (Lane B). `bun run coda:e2e` → 5/5.
- `bunx tsc -p apps/coda/tsconfig.json --noEmit` AND `bun run typecheck`
  → both green. `bun run lint` → zero new findings vs baseline; the coda
  scope of `no-restricted-globals` fires on a stray `document`.
- CI: the `coda` job — frozen-lockfile install, the lockfile-drift assert,
  Lane A, Lane B, `bunx playwright install chromium --with-deps`, the
  isolated e2e+a11y lane, the `playwright-report-coda` artifact.
- Domain-purity: `grep -rE 'document\.|window\.|indexedDB|localStorage'
  apps/coda/src/domain/` returns nothing (secondary proof) AND
  `boundary.test.ts` is green (primary).

## Child DOX Index

(none — the app is flat; `src/domain/README.md` is the domain layer's own
contract, not a DOX child)
