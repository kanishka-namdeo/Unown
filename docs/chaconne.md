# Chaconne — the keyboard-first browser-recipe runner

Chaconne is a self-contained, offline-first progressive web app at `apps/chaconne/`: **a keyboard-first, self-hosted browser-recipe runner** — compose a browser flow once (goto, click, fill, select, wait, assert-text, assert-element, extract, screenshot — the 9-step closed set), and it repeats on demand or on a schedule, capturing content-addressed artifacts and an honest run record every time. It is vanilla TypeScript with **zero package dependencies** (its `package.json` declares none — the test lane reuses the repo root's `@playwright/test`; the one deliberate exception is the runner, see [The dependency ruling](#the-dependency-ruling)), ships its own hand-rolled service worker, and is verified end to end by an isolated Playwright lane against **local fixture pages — no live-network test ever runs in CI**. The round's honest platform scope is **Chromium-desktop-only** — Safari/Firefox/mobile are out of P0 scope, not "cross-platform".

- [What it is](#what-it-is)
- [Run it](#run-it)
- [Test it](#test-it)
- [The runner story](#the-runner-story)
- [The recipe & schedule story](#the-recipe--schedule-story)
- [The keyboard-first story](#the-keyboard-first-story)
- [The PWA / offline story](#the-pwa--offline-story)
- [The dependency ruling](#the-dependency-ruling)
- [The CI chaconne job](#the-ci-chaconne-job)
- [The landing band's stills](#the-landing-bands-stills)
- [Related pages](#related-pages)

## What it is

Chaconne is the repo's third user-facing app — after [Coda](coda.md) and [Ostinato](ostinato.md), the Rondo round's DRIVE-track vehicle, [selected by the §0.9 procedure and approved by the PRD](chaconne-prd.md). One document shape, two hosts, one law: the UI shell persists to **localStorage** and the runner process persists to **disk JSON files**, both plain-JSON with the same schema and the same atomic-write pattern (temp-key write + commit-swap; boot recovery discards orphaned temp keys):

- **Domain core** (`apps/chaconne/src/domain/`) — pure, DOM-free, Node-free TypeScript: the recipe/run-record model (`types.ts`, `model.ts`, `ids.ts`'s deterministic integer ids, the `assertData` invariants in `invariants.ts`), the canonical-JSON import/export with byte-stable round-trips and future-schema rejection (`io.ts`), the `StoragePort` seam (`storage.ts`), and the pure `(schedule, now)` misfire-policy scheduler (`scheduler.ts`, injected clock — no `Date.now()`).
- **Runner** (`apps/chaconne/runner/`) — a Node process OUTSIDE the browser closure: `page-adapter.ts`'s seam (the 9 step kinds + `screenshot`), `RealPageAdapter` on the repo-root Playwright (iframe frame resolution, post-fill value read-back, full-page captures, capped waits that surface the taxonomy instead of hanging), `caps.ts` (per-step + per-run caps, the committed-prefix law — a killed run keeps only the steps that fully completed), `store.ts` (atomic disk writes, content-addressed artifact names — the name IS the sha256), `schedule.ts` (one-shot/interval loops with the misfire policy: skip-and-record, never a silent catch-up storm), and `index.ts` — the CLI entry, `bun apps/chaconne/runner/index.ts run <recipeId> [--data-dir <dir>]`.
- **UI shell** (`apps/chaconne/src/ui/`) — the three-route surface (recipes ⇄ run history ⇄ artifact viewer), the Ctrl+K palette (every P0 command enumerated), the recipe editor's modals on the house dialog contract (role=dialog, aria-modal, attach-before-focus, Esc focus-return, double-Esc discard guard), honest empty/loading/failed states, and every-transition persistence.
- **Persistence** (`apps/chaconne/src/storage/local-storage.ts`) — the localStorage adapter with atomic writes, deliberately OUTSIDE the domain, like Ostinato's.

The app directory is a flat, self-contained boundary; the five Playwright specs live at the repo root under `e2e/` and are driven by their own config (`playwright.chaconne.config.ts`) so the landing page's lane is never touched.

## Run it

```sh
bun run chaconne:dev    # = bun apps/chaconne/serve.mjs (the root package.json entry, C-11)
```

It boots at **http://127.0.0.1:4014** (override the port with `CHACONNE_PORT`). It is a transpiling static server — the Coda/Ostinato pattern: plain files plus on-the-fly `.ts` transpile via `Bun.Transpiler` (bun-only, which is why the script is `.mjs` run under `bun`, not a node tool), the `.js`→`.ts` swap added. No import map, no vendored libraries — the zero-dep law means there is nothing to wire. No build step, no bundler: the browser loads `.ts` modules directly through the transpiler. The runner is separate: `bun apps/chaconne/runner/index.ts run <recipeId> [--data-dir <dir>] [--base-url <u>] [--fake]` (data dir defaults to `apps/chaconne/data/`, gitignored; the runner resolves `playwright` from the repo root's `node_modules`, the PLAN §4 walk-up assumption — a resolution break fails loudly, not silently).

## Test it

| Lane | Command | What it is |
|---|---|---|
| **Lane A** (the purity enforcement lane) | `cd apps/chaconne && bun test` — or `bun run chaconne:test` from the repo root | 119 tests, run from the app directory where no `bunfig.toml` preload applies (bun's config resolution is cwd-bounded and no `apps/chaconne/bunfig.toml` exists) — the happy-dom DOM globals are **absent**, so the domain's DOM-free boundary is enforced against a genuinely DOM-free runtime; includes the runner's FakePageAdapter unit lane (every step kind, every error taxonomy entry, the caps, the committed-prefix law, the misfire policy — deterministic, no browser) |
| **Lane B** (the compatibility lane) | `bun test apps/chaconne` from the repo root | the same files from the repo root, where the root `bunfig.toml`'s `[test]` preload (happy-dom) **is** active — the DOM-guarded UI pins (the el-kin renders) run here; 157 tests |
| **e2e battery** (isolated, Chromium) | `bun run chaconne:e2e` = `bunx playwright test -c playwright.chaconne.config.ts` | 20 specs across five files: **K-1** the zero-mouse flow (compose via the palette → run against a fixture via the real runner → artifacts, keyboard events only), **A-1** axe `wcag2a/2aa` in BOTH schemes + the tab-order + Esc focus-return pins, **O-1 + R-1** the resilience lanes (kill no-phantom + orphaned-tmp recovery, corrupt-store quarantine, offline + 0-storm), **I-1** the import/export battery (the byte-stable golden, the refused future-schema dry-run report, the corrupt-import twin), and the **runner CLI** lane |

The **precache derivation proof** (`bun apps/chaconne/scripts/verify-precache.ts`) is a sub-second fs walk that parses `PRECACHE_LIST` out of `sw.js` and resolves every entry to a real on-disk file — the Ostinato O-5 pattern; it is a dedicated CI step in the `chaconne` job and re-runs locally on demand.

The chaconne specs are self-skip-guarded (`test.skip(!process.env.CHACONNE_E2E, …)` at the top of each file; the marker is armed inside `playwright.chaconne.config.ts` only — the root `playwright.config.ts` never does). Under the **root** Playwright config they are collected but skipped at run-time, so the landing lane's `bunx playwright test` stays green and untouched by construction. The round's operator-gate numbers as of C-9: the e2e battery **20/20 × 3 consecutive runs including the CI=1 cold boot**; the round's full record is in [docs/rondo-round-session.md](rondo-round-session.md).

## The runner story

The runner is the round's named exception to the zero-dep law — PLAN §4's ruling (a), operator-approved: `runner/` is Node-only and imports `playwright` from the **repo root's `node_modules`** by bare specifier (bun's resolution walks up from `apps/chaconne/runner/` to the root install). The PWA's browser closure never imports the runner: `src/` imports only relative `./`/`../` and `bun:test`, which the boundary scan enforces. One version, one Chromium build — the runner and the e2e battery can never drift apart, and the fixture battery IS the upgrade verifier. The run record's **committed-prefix law** is the crash honesty: a killed run keeps only the steps that fully completed, the record snapshots the recipe's version at start (the edge-6 law), and artifacts are content-addressed — two runs producing identical bytes get identical `sha256:<64hex>` names and dedupe instead of clobbering.

## The recipe & schedule story

Recipes are named, versioned, ordered step lists over the 9-step closed set (`goto`, `click`, `fill`, `select`, `wait`, `assert-text`, `assert-element`, `extract`, `screenshot`); every boundary validates (integer ids, selector shape, the artifact-name grammar). Schedules ride the same document: per-recipe `one-shot`/`interval` with a **misfire policy of skip-and-record** — a machine-sleep gap produces a skipped+recorded entry, never a silent double-run or a catch-up storm. The run history groups by recipe, arrow-navigates with selection pins, and prints the 5-entry status taxonomy (`ok`, `step-failed`, `selector-not-found`, `timeout`, `invalid-recipe`) as a legend that is always visible — the capped-wait honesty: a selector matching nothing produces the taxonomy entry, not a hang.

## The keyboard-first story

Every action in the app is reachable without a pointer — the K-1 lane proves it with zero pointer events. The direct keys (the `palette.ts` dispatch table): `N` new recipe, `E` edit, `R` run, `V` view run, `A` view artifact, `1`/`2` switch routes, arrows navigate the run rows (wrapping), `Ctrl+E`/`Ctrl+O` export/import the canonical JSON, and `Ctrl+K` opens the 11-command palette (filter-as-you-type; a command that cannot apply in the current state is **disabled in the palette, not hidden** — the enumeration stays total). `Esc` closes every overlay and returns focus to the invoking control (the C-9 dialog-contract pin: attach-before-focus, the Tab trap, focus-return).

## The PWA / offline story

The service worker (`apps/chaconne/sw.js`, a classic non-module worker at the app root — **never under `public/`**: a worker there could never control the app root, the Coda contract) pins the versioned cache and precaches the enumerated runtime closure, with the offline fallback at `public/offline.html`. The precache's **static derivation proof** is `apps/chaconne/scripts/verify-precache.ts` (the Coda C3 pattern): it parses `PRECACHE_LIST` out of `sw.js` and resolves every entry to a real on-disk file, printing the `<N> URLs, <M> missing` drift line — current state: **21 URLs, 0 missing — PASS**. The O-1 e2e lane pins the offline boot: SW-controlled, reload from cache with data intact, 0 background fires.

## The dependency ruling

`apps/chaconne/package.json` declares **no dependencies and no devDependencies** — the whole file is seven lines. The test lane's Playwright comes from the **root** install (the zero-dep law constrains the APP, not the repo). The runner is the one deliberate exception, ruled in PLAN §4: it imports `playwright` from the root `node_modules` (walk-up resolution, no app-dir install, no lockfile move) and lives OUTSIDE the PWA closure so the offline build can never touch it. C-11's CI job makes that a contract: a frozen-lockfile install + the lockfile-drift assert (any dependency a Chaconne change would pull in at the root moves the hash and reds the job) + both unit lanes + the precache derivation proof + the isolated e2e battery.

## The CI chaconne job

One dedicated `chaconne` job in `.github/workflows/ci.yml` (the gate ledger entry: [docs/testing-strategy.md](testing-strategy.md) §6), mirroring the Ostinato job's shape with Chaconne's own counts and honest-scope comment. It is **Chromium-desktop-only** — the PRD's own platform scope statement; Safari, Firefox, and mobile are untested, not "cross-platform". Five proofs in the one job:

1. **Frozen lockfile + the zero-dep invariant** — `bun install --frozen-lockfile` followed by a lockfile-drift assert (`sha256sum bun.lock` against `git show HEAD:bun.lock`). `apps/chaconne/package.json` declares no dependency fields at all, so any Chaconne dep pulled in at the root moves the hash and reds the job. (The runner's walk-up resolution of the root `node_modules/playwright` is a feature of this invariant, not a violation: it is the existing root install, not a new dep.)
2. **Lane A** (`cd apps/chaconne && bun test` — 119 tests) and **Lane B** (`bun test apps/chaconne` — 157 tests) — the two-lane purity/compatibility pair, milliseconds each.
3. **The precache derivation proof** (`bun apps/chaconne/scripts/verify-precache.ts`) — a dedicated CI step; the offline lane's static half, fails loudly on drift.
4. **The isolated e2e battery** (`bunx playwright test -c playwright.chaconne.config.ts` — 20 specs across five files) with its own Chromium install and its own artifact (`playwright-report-chaconne`); the `CHACONNE_E2E` marker keeps the root landing lane untouched by construction.
5. **The fixture honesty** — every e2e spec runs against LOCAL fixture pages under `apps/chaconne/test/fixtures/`; no live-network test ever runs in CI (the PRD's P0 #5 law).

The round's full record is in [docs/rondo-round-session.md](rondo-round-session.md); the app's own contracts live in `apps/chaconne/AGENTS.md` and its PRD in [docs/chaconne-prd.md](chaconne-prd.md).

## The landing band's stills

The landing band's stills come from the app's own usage-capture lane, `apps/chaconne/scripts/capture-usage.mjs` (the Ostinato precedent ported, written by C-10 per the C-7 receipt's ruling): it boots the real app via `serve.mjs` on a scratch port, drives the real UI **keyboard-only** (the app's own direct keys — zero pointer events), and stills seven honest states (five light + two dark, 1280×800 / DSF 2, the seed document's bytes are the e2e specs' own SEED_DATA shape) — `01-empty-boot`, `02-recipe-list`, `03-run-history`, `04-artifact-viewer`, `05-palette` (+ the dark twins) — committed under `public/landing/chaconne/` with the `PROVENANCE.md` sidecar as the receipt. No live network: the capture drives the app shell against a local dev server; the seed's fixture URL is 127.0.0.1. Re-run on demand: `bun apps/chaconne/scripts/capture-usage.mjs [target-dir] [--port P]`.

## Related pages

- [docs/coda.md](coda.md) · [docs/ostinato.md](ostinato.md) — the sibling products
- [docs/chaconne-prd.md](chaconne-prd.md) — the app's PRD (APPROVED 2026-11-06, the §0.9 selection)
- [docs/rondo-round-session.md](rondo-round-session.md) — the owning round's resumable checkpoint log
- [docs/testing-strategy.md](testing-strategy.md) — the CI gate ledger (the chaconne gate entry lands in C-11)
- [README.md](../README.md) — the repo overview
