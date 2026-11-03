# Coda — the local-first notes & task-board PWA

Coda is a self-contained, installable progressive web app at `apps/coda/`: **markdown notes + task boards, offline-first, with all data kept in the browser** (IndexedDB). It is vanilla TypeScript with **zero package dependencies**, ships its own hand-rolled service worker, and is verified end to end by an isolated Playwright lane. The round's honest platform scope is **Chromium-desktop-only** — Safari/Android/Firefox are untested/deferred, not "cross-platform".

- [What it is](#what-it-is)
- [Run it](#run-it)
- [Test it](#test-it)
- [The PWA / offline story](#the-pwa--offline-story)
- [The zero-dep vendoring story](#the-zero-dep-vendoring-story)
- [The CI coda job](#the-ci-coda-job)
- [Related pages](#related-pages)

## What it is

Coda is the repo's first user-facing app — everything else here is the marketing landing page or the terminal agent. One note model, one task board, global search; markdown round-trips losslessly to `.md` files so the "local-first" proof is a real export path, not a claim:

- **Domain core** (`apps/coda/src/domain/`) — pure TypeScript: types, a state-machine `Repository` (the legal task-status transitions), an in-memory serializable `Store` (JSON is the byte-format), Fuse-backed search, and the lossless markdown round-trip. No DOM, no Node I/O — a two-mechanism boundary enforces that (see the app's DOX, `apps/coda/AGENTS.md`, and `apps/coda/src/domain/README.md`).
- **UI + persistence** (`apps/coda/src/ui/`, `apps/coda/src/db/idb.ts`) — a hand-built interface with an IndexedDB write-through: one database, one store, the whole serialized document as a single row.
- **PWA layer** (`apps/coda/sw.js`, `apps/coda/public/`) — a hand-rolled service worker with a versioned precache of the app's emitted asset set, offline fallback, and an installable manifest.

The app directory is a flat, self-contained boundary; the two Playwright specs live at the repo root under `e2e/` (`e2e/coda-offline.spec.ts`, `e2e/coda-a11y.spec.ts`) and are driven by their own config (`playwright.coda.config.ts`) so the landing page's lane is never touched.

## Run it

```sh
bun run coda:dev          # = bun apps/coda/scripts/serve.mjs
```

The dev/test server boots at **http://127.0.0.1:4012** (override the port with `CODA_PORT`). It is a transpiling static server — plain files, plus on-the-fly `.ts` transpile via `Bun.Transpiler` (bun-only, which is why the script is `.mjs` run under `bun`, not a node tool). Two quirks you should know: the import map points at `./public/vendor/`, so a bare static server that does not resolve the `/vendor/*` alias 404s the vendored libraries, and the server uses `transformSync` — the async `transform` form coerces every module URL to the literal string `[object Promise]` and the app sits at "Booting…".

No build step, no bundler: the browser loads `.ts` modules directly through the transpiler.

## Test it

| Lane | Command | What it is |
|---|---|---|
| **Lane A** (the purity enforcement lane) | `bun run coda:test` = `cd apps/coda && bun test` | 51 tests, run from the app directory where no `bunfig.toml` preload applies — the happy-dom DOM globals are **absent**, so the domain's DOM-free boundary is enforced against a genuinely DOM-free runtime |
| **Lane B** (the compatibility lane) | `bun test apps/coda` | the same 51 tests from the repo root, where the root `bunfig.toml`'s `[test] preload` (happy-dom) **is** active — DOM-globally-dependent code would be masked here, which is exactly why Lane A exists and why the import-boundary test + the scoped ESLint `no-restricted-globals` are the real guards |
| **e2e + a11y lane** | `bun run coda:e2e` = `bunx playwright test -c playwright.coda.config.ts` | 5 specs: offline persistence across reloads, the offline-fallback navigation, the soft-gated `beforeinstallprompt`, and axe `wcag2a/2aa/21a/21aa` in light + dark |

The coda specs are self-skip-guarded (`test.skip(!process.env.CODA_E2E, …)` at the top of each file; the marker is armed inside `playwright.coda.config.ts` only). Under the **root** Playwright config they are collected but skipped at run-time, so the landing lane's `bunx playwright test` stays green and untouched by construction.

## The PWA / offline story

The service worker (`apps/coda/sw.js`, registered at app-root scope from `apps/coda/src/main.ts` — a `public/sw.js` worker can never control the app root, so the file lives at the app root) pins the versioned cache `coda-v1` and precaches **every URL the browser actually loads** — the full emitted asset set, verified 23/23 by the C3 lane's `scripts/verify-precache.ts` (the domain's `markdown.ts` is deliberately excluded: only test files import it, so it is not in the runtime closure). The strategy is stale-while-revalidate on the precached set, network-first with cache fallback for the rest, and offline navigation requests fall back to the precached `public/offline.html`. `storage.persist()` is asked at boot so Coda's IndexedDB sits outside the browser's eviction candidates, and `clients.claim()` lands the first load already under a controller.

The offline proof is receipted by the e2e lane: service worker activated and controlling → the page goes offline → reload → the app boots from cache with its data intact → a note created offline **saves and survives the return online** → a non-precached navigation offline lands on the offline page.

The installability criteria and the offline-load boot timing are **measured, not claimed**: the [coda-pwa benchmark lane](../benchmarks/coda-pwa/README.md) (the doc-truth round's T2) records every installability criterion the e2e spec asserts (manifest 200, required fields, icon inventory, SW controller, display mode) as a receipted inventory, and times the offline boot-from-cache against the online baseline (median over N, with min/max and in-page navigation-timing cross-checks). The 2026-11-03 receipt: installability **PASS**, offline **91 ms median** vs online **175 ms median** (N=5, headless chromium, scratch port 4099 — the caveats are in [RESULTS.md](../benchmarks/coda-pwa/RESULTS.md)). Re-run on demand: `bun benchmarks/coda-pwa/run-pwa-bench.mjs`.

## The zero-dep vendoring story

`apps/coda/package.json` declares **no dependencies and no devDependencies** — the whole file is seven lines (the brace pair plus five fields). Coda's two pure third-party modules (`marked`, `fuse.js`) are **vendored** as browser-ESM copies under `apps/coda/public/vendor/` (`marked.mjs`, `fuse.mjs`) and wired by the relative import map in `index.html`, so root `bun install` never adds a package on Coda's behalf. The CI `coda` job makes that a contract, not a hope: it installs with `--frozen-lockfile` and then asserts the root lockfile's sha256 against `git show HEAD:bun.lock` — any dependency a Coda change would pull in at the root moves the hash and reds the job.

## The CI coda job

One dedicated `coda` job in `.github/workflows/ci.yml` (the gate ledger entry: [docs/testing-strategy.md](testing-strategy.md)), four proofs:

1. **Frozen lockfile + the drift assert** — the zero-dep invariant above.
2. **Lane A** (`cd apps/coda && bun test`) and **Lane B** (`bun test apps/coda`) — both 51-test lanes, milliseconds each.
3. **The isolated e2e + a11y lane** (`bunx playwright test -c playwright.coda.config.ts`) with its own Chromium install and its own artifact (`playwright-report-coda`).

The round's full record — the C1–C5 checkpoint log, the protocol laws, and the deviations — is in [docs/coda-app-round-session.md](coda-app-round-session.md); the app's own contracts live in `apps/coda/AGENTS.md` and `apps/coda/src/domain/README.md`.

## Related pages

- [docs/testing-strategy.md](testing-strategy.md) — the CI gate ledger (the coda gate entry)
- [docs/coda-app-round-session.md](coda-app-round-session.md) — the round's resumable checkpoint log
- [README.md](../README.md) — the repo overview
