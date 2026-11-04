# Ostinato — the keyboard-first spaced-repetition PWA

Ostinato is a self-contained, offline-first progressive web app at `apps/ostinato/`: **spaced-repetition flashcards, keyboard-first, with all data kept in the browser** (localStorage). It is vanilla TypeScript with **zero package dependencies** (its `package.json` declares none — the test lane reuses the repo's root `@playwright/test`), ships its own hand-rolled service worker, and is verified end to end by an isolated Playwright lane. The round's honest platform scope is **Chromium-desktop-only** — Safari/Android/Firefox are untested/deferred, not "cross-platform".

- [What it is](#what-it-is)
- [Run it](#run-it)
- [Test it](#test-it)
- [The keyboard-first story](#the-keyboard-first-story)
- [The PWA / offline story](#the-pwa--offline-story)
- [The zero-dep law](#the-zero-dep-law)
- [The CI ostinato job](#the-ci-ostinato-job)
- [Related pages](#related-pages)

## What it is

Ostinato is the repo's second user-facing app — after [Coda](coda.md), everything else here is the marketing landing page or the terminal agent. Markdown decks, card fronts, and markdown-lite card backs; the SM-2 scheduling family (Wozniak 1990 SuperMemo-2, cited not re-derived — `q = grade − 1`, delta `0.1 − (5−q)·(0.08 + (5−q)·0.02)`, the easiness floor at 1.3, an injected clock — no `Date.now()`), byte-stable canonical-JSON import/export, and a crash-safe persisted review session:

- **Domain core** (`apps/ostinato/src/domain/`) — pure, DOM-free TypeScript: the deck/card model (`types.ts`, `model.ts`, `ids.ts`, the `assertData` invariants in `invariants.ts`), the SM-2 scheduler (`scheduler.ts`), canonical-JSON serialization plus the `ImportExportPort` with lossless, byte-stable round-trips and corrupt-import rejection (`io.ts`), and the `StoragePort` seam the domain owns (`storage.ts`). No DOM, no Node I/O — the `boundary.test.ts` + `DOM_GLOBS` verifier pair enforces it (see the app's DOX, `apps/ostinato/AGENTS.md`).
- **UI shell** (`apps/ostinato/src/ui/`) — the review runner (`runner-core.ts`, the front → reveal → grade → done state machine with the injected-clock due-queue computation), the queue navigation (`queue-nav.ts`, j/k wrap + g/G bounds + filter-respecting selection math), the 17-command palette (`palette.ts`, every action reachable, filter-as-you-type, phase-aware enablement), and the DOM wiring + every-transition persistence (`app.ts`).
- **Persistence** (`apps/ostinato/src/storage/local-storage.ts`) — localStorage with atomic writes (temp-key-write + commit-key-swap, the localStorage analogue of temp-write-then-rename), deliberately OUTSIDE the domain: an interrupted save orphans the temp key that boot `recover()` discards.

The app directory is a flat, self-contained boundary; the five Playwright specs live at the repo root under `e2e/` and are driven by their own config (`playwright.ostinato.config.ts`) so the landing page's lane is never touched.

## Run it

```sh
bun run ostinato:dev    # = bun apps/ostinato/serve.mjs
```

The dev/test server boots at **http://127.0.0.1:4013** (override the port with `OSTINATO_PORT`). It is a transpiling static server — the Coda pattern, the `.js`→`.ts` swap added: plain files plus on-the-fly `.ts` transpile via `Bun.Transpiler` (bun-only, which is why the script is `.mjs` run under `bun`, not a node tool). No import map, no vendored libraries — the zero-dep law here means there is nothing to wire. The compiled module graph keeps the `.js`-specifier convention, and the server swaps `x.js` back to `x.ts` and transpiles it (`serve.mjs`'s `transformSync` lane — the async `transform` form coerces every module body to the literal string `[object Promise]`).

No build step, no bundler: the browser loads `.ts` modules directly through the transpiler.

## Test it

| Lane | Command | What it is |
|---|---|---|
| **Lane A** (the purity enforcement lane) | `cd apps/ostinato && bun test` | 93 tests, run from the app directory where no `bunfig.toml` preload applies (bun's config resolution is cwd-bounded and no `apps/ostinato/bunfig.toml` exists) — the happy-dom DOM globals are **absent**, so the domain's DOM-free boundary is enforced against a genuinely DOM-free runtime |
| **Lane B** (the compatibility lane) | `bun test apps/ostinato` | the same 93 tests from the repo root, where the root `bunfig.toml`'s `[test]` preload (happy-dom) **is** active — DOM-globally-dependent code would be masked here, which is exactly why Lane A exists |
| **e2e battery** (isolated, Chromium) | `bun run ostinato:e2e` = `bunx playwright test -c playwright.ostinato.config.ts` | 12 specs across five: **K-1** the zero-mouse flow (create → review → export → import, keyboard events only — the export/import round-trip is the byte-stable I-1 lane riding inside it), **A-1** axe `wcag2a/2aa` in BOTH schemes per-context + the tab-order + Esc focus-return pins, **O-1** the offline lane (SW-controlled boot, offline reload from cache with the loop completing offline, the non-precached-URL fallback page), **R-1** crash-resume + resize, and the O-3 review trio (the loop, the honest empty state, the corrupt-session recovery) |

The ostinato specs are self-skip-guarded (`test.skip(!process.env.OSTINATO_E2E, …)` at the top of each file; the marker is armed inside `playwright.ostinato.config.ts` only — the root `playwright.config.ts` never does). Under the **root** Playwright config they are collected but skipped at run-time, so the landing lane's `bunx playwright test` stays green and untouched by construction. The commit the battery last ran clean on: `benchmarks/ostinato/receipts/run-20261104T181704Z/` (12/12 in 8.5 s first run / 7.2 s re-run, headless chromium-1248, the external Playwright verifier; Lane A 93/0 and Lane B 93/0 the same hour — see [benchmarks/ostinato/RESULTS.md](../benchmarks/ostinato/RESULTS.md)).

## The keyboard-first story

Every action in the app is reachable without a pointer — the e2e K-1 lane proves it by driving the whole create → review → export → import flow with **zero pointer events** in the spec (the download and filechooser ride `waitForEvent`, the sanctioned lanes):

- **Review** — `Space`/`Enter` reveals the card back; `1`–`4` grade (Again/Hard/Good/Easy, the SM-2 q mapping); `S` skips, `R` restarts the queue.
- **Navigate** — `j`/`k` step the queue (wrapping), `g`/`G` jump to the bounds, `/` focuses the card/deck search.
- **Data** — `N` creates a deck, `C` a card (both legal in every phase), `Ctrl+E`/`Ctrl+O` export/import the canonical JSON, `Ctrl+X` clears the review session.
- **The palette** — `Ctrl+K` opens the 17-command palette (4 review + 4 navigate + 1 filter + 4 data + 1 app + 3 phase controls, `palette.ts`'s `PALETTE_COMMANDS`); `Esc` closes it and focus returns to the invoking control. A command that cannot apply in the current phase is **disabled in the palette, not hidden** — the enumeration stays total.

Crash safety is structural, not bolted on: `app.ts` persists on **every transition** (the O-4 B-3 fix wired the `persistAll` call into every state change, not just a few), so a killed mid-review session restores on reload with its queue, phase, and invariants intact — the R-1 lane pins the semantics: a mid-reveal reload restores the reveal phase, a post-grade reload recomputes the due queue (the graded card drops, the cursor advances into the shrunk queue), and the loop completes across two crashes.

## The PWA / offline story

The service worker (`apps/ostinato/sw.js`, a classic non-module worker at the app root — **never under `public/`**: a worker there could never control the app root, the Coda contract) pins the versioned cache `ostinato-v2` and precaches the **18-entry enumerated runtime closure** (every URL the browser actually loads — `index.html` requested AS `.ts`, the manifest, the offline page, the 12 compiled-module-graph `.js`-convention entries serve.mjs serves as transpiled `.ts`). `cache.add` rejects non-2xx, so a wrong path fails install loudly — the honesty the offline lane wants. The fetch handler is network-first with a runtime cache belt, and offline navigation requests fall back to `public/offline.html`; `clients.claim()` lands the first load already under a controller, so the precache exists at install and offline reloads boot from cache with data intact.

The offline proof is receipted by the e2e lane (O-1 above), and the precache's **static derivation proof** is `apps/ostinato/scripts/verify-precache.ts` (the Coda C3 pattern): it parses `PRECACHE_LIST` out of `sw.js` and resolves every entry to a real on-disk file through a three-way ladder (exact file → `+ ".ts"` for extensionless entries → the `.js`→`.ts` swap), with three honesty pins (`CACHE_NAME` must parse and match `ostinato-v<N>`; the list is non-empty and duplicate-free; it prints the `<N> URLs, <M> missing` drift line). Current state: **18 URLs, 0 missing — PASS**, first run of which caught the tree's own count drift (the closure grew 17→18 when the create surface wired `src/domain/ids.js` in).

The landing band's stills come from the app's own usage-capture lane, `apps/ostinato/scripts/capture-usage.mjs`: it boots the real app via `serve.mjs` on a scratch port, drives the K-1 flow's **own keyboard contract** (zero pointer events, `.fill()` banned), and stills four honest states at 1280×800 / DSF 2 — `01-fresh-boot`, `02-palette`, `03-review`, `04-revealed` — committed under `public/landing/ostinato/` with the `PROVENANCE.md` sidecar as the receipt. Re-run on demand: `bun apps/ostinato/scripts/capture-usage.mjs [--port P]`.

## The zero-dep law

`apps/ostinato/package.json` declares **no dependencies and no devDependencies** — the whole file is seven lines. Unlike Coda (which vendors its two pure libraries under `public/vendor/`), Ostinato has none to vendor: the domain and UI are hand-rolled, and the markdown-lite rendering of card backs is a ~20-line local renderer in `src/ui/app.ts`, not a library. The test lane's Playwright comes from the **root** `@playwright/test` (the zero-dep law constrains the APP, not the repo). The CI `ostinato` job makes that a contract, not a hope: it installs with `--frozen-lockfile` and asserts the root lockfile's sha256 against `git show HEAD:bun.lock` — any dependency an Ostinato change would pull in at the root moves the hash and reds the job.

## The CI ostinato job

One dedicated `ostinato` job in `.github/workflows/ci.yml` (the gate ledger entry: [docs/testing-strategy.md](testing-strategy.md)), four proofs:

1. **Frozen lockfile + the drift assert** — the zero-dep invariant above.
2. **Lane A** (`cd apps/ostinato && bun test`) and **Lane B** (`bun test apps/ostinato`) — both 93-test lanes, milliseconds each.
3. **The precache derivation proof** (`bun apps/ostinato/scripts/verify-precache.ts`) — a dedicated CI step; an improvement over the coda job, which runs its proof only in the operator lane (the script is a sub-second fs walk).
4. **The isolated e2e battery** (`bunx playwright test -c playwright.ostinato.config.ts`) with its own Chromium install and its own artifact (`playwright-report-ostinato` + the trace results); the `OSTINATO_E2E` marker keeps the root landing lane untouched by construction.

The round's full record — the O-1…O-6 checkpoint log, the defect ledger B-1…B-11, the harvest of nine live defects the battery surfaced — is in [docs/ostinato-round-session.md](ostinato-round-session.md); the app's own contracts live in `apps/ostinato/AGENTS.md` and its PRD in [docs/ostinato-prd.md](ostinato-prd.md).

## Related pages

- [docs/coda.md](coda.md) — the first user app this doc's pattern follows
- [docs/testing-strategy.md](testing-strategy.md) — the CI gate ledger (the ostinato gate entry)
- [docs/ostinato-prd.md](ostinato-prd.md) — the app's PRD + round plan
- [docs/ostinato-round-session.md](ostinato-round-session.md) — the round's resumable checkpoint log
- [benchmarks/ostinato/](../benchmarks/ostinato/README.md) — the canary-armed benchmark suite (RESULTS + receipts)
- [README.md](../README.md) — the repo overview
