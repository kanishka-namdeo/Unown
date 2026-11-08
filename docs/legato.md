# Legato — the offline-first read-later PWA

Legato is the repo's fifth user-facing app, at `apps/legato/`: **a keyboard-first, offline-first, installable read-later / web-clip PWA** — clip any URL and get a clean readable copy stored locally, find it again with full-text search + tags, read it in a keyboard-driven queue, highlight what mattered, and carry everything in a byte-stable JSON bundle (the same bundle out that went in) — offline-first, no account, no server. The round was selected by the Vivace PRD's pre-registered §0.9.5 fallback law (the Serenade round's vehicle), receipted in [benchmarks/serenade-round/README.md](../benchmarks/serenade-round/README.md) + [docs/vivace-prd.md](vivace-prd.md). The binding spec is [apps/legato/PLAN.md](../apps/legato/PLAN.md) (the L-0 scored plan, 100/100).

- [What it is](#what-it-is)
- [Run it](#run-it)
- [Test it](#test-it)
- [The architecture story](#the-architecture-story)
- [The error taxonomy as product surface](#the-error-taxonomy-as-product-surface)
- [The B-16 holdout law](#the-b-16-holdout-law)
- [The PWA story](#the-pwa-story)
- [The dependency ruling](#the-dependency-ruling)
- [The honest scope](#the-honest-scope)
- [The root wiring (L-13)](#the-root-wiring-l-13)
- [The landing band's stills](#the-landing-bands-stills)
- [Related pages](#related-pages)

## What it is

Legato is the fifth app in the house PWA pattern — after [Coda](coda.md), [Ostinato](ostinato.md), [Chaconne](chaconne.md) and [Fugue](fugue.md) — and the one whose data is the web itself, stored locally: every clip is a `legato.v1` record (deterministic integer id, the URL as clipped + the final URL after redirects, the extracted readable body capped at 500 KB, the closed `ClipState` four-set, the closed `ClipError` seven-set, tags in canonical order, highlights as anchor + quote ranges) persisted in **IndexedDB** behind the `StoragePort` seam — the deliberate departure from the house localStorage pattern: clip bodies exceed its quota, and the storage seam makes the IDB quota-class errors deterministic in the unit lane (the fake throws, no real IDB ever appears there).

- **Domain core** (`apps/legato/src/domain/`) — pure, DOM-free, Node-free: the `legato.v1` grammar declared once in `types.ts`, the `assertData` invariants in `invariants.ts`, deterministic integer ids in `ids.ts`, canonical-JSON import/export with the schema gate in `io.ts`, the CJK-bigram hybrid search index in `search.ts`, the queue state machine + concurrent-flip guard in `queue.ts`, the tag filter combos in `tags.ts`, the highlight anchor/quote ranges in `highlights.ts`, and `boundary.test.ts` — the import-graph pin that IS the network-free-closure proof and the zero-dep law's executable form.
- **The storage seam** (`apps/legato/src/storage/`) — the `StoragePort` interface over the IDB object stores, the real `idb-storage.ts` adapter (the L-11 e2e battery is the only lane that touches real IDB), the in-memory `fake-storage.ts` (the quota-error pin), and `migration.ts` (the v1→v2-with-data frame + its named design note).
- **The clip pipeline** (`apps/legato/src/pipeline/`) — the ONE extension seam: `Fetcher` + `Extractor` interfaces, the `RealFetcher` (~40 lines on `window.fetch` + `DOMParser` + the readability-lite extractor, running INSIDE the PWA closure), the `FakeFetcher` canned-HTML doubles that double each `ClipError` taxonomy entry, and `error-taxonomy.ts` (the 7-entry map, PLAN §2).
- **The UI shell** (`apps/legato/src/ui/`) — the keyboard-first list/detail surface (`j/k` nav, `/` search, `r`/`d`/`a`/`u` state flips, `h` highlight, `t` tag editor/theme, Ctrl+K palette, Ctrl+E/Ctrl+O export/import), the Ostinato dialog contract on every overlay (attach-before-focus, the Tab trap, the Esc focus-return, the `el()` tabindex-routing law), light + dark theming (the Fugue accent-ink trap cured from day one — scheme-paired badge text).

## Run it

```sh
bun apps/legato/serve.mjs                    # the transpiling static server → http://127.0.0.1:4017 (LEGATO_PORT to override)
bun apps/legato/scripts/fixture-server.mjs    # the B-16 hostile fixture server → http://127.0.0.1:4018 (LEGATO_FIXTURE_PORT)
curl -s http://127.0.0.1:4017/health          # → {"ok":true,"port":4017}
curl -s http://127.0.0.1:4018/health          # → {"ok":true,"port":4018}
```

It is the Coda/Ostinato/Chaconne/Fugue pattern: plain files + on-the-fly `.ts` transpile via `Bun.Transpiler`, no build step, no bundler, no import map — the zero-dep law means there is nothing to wire. `GET /health` is the cheap liveness probe the e2e config's `webServer` entries assert on before launching specs. Two lanes, honestly scoped:

- **The fixture lane (everything in this doc's test story)** — the fixture server on 4018 serves the committed static hostile HTML (`fixtures/`: `clean.html`, `wrong-charset.html`, `paywall-excerpt.html`, `huge.html`, `empty-article.html`, sha256-frozen at L-3 per `fixtures/B16-HOLDOUT.md`) + the dynamic routes (`/redirect-chain`, `/redirect-loop`, `/walled-403`, `/walled-429`, `/slow`). CORS headers are pinned on every route (the G-4 receipted gap's standing cure). No live network: the fixture server IS the hostile web for every test lane.
- **The browser clip lane (real-world use)** — the `RealFetcher` + the clip orchestrator (`src/pipeline/clip.ts`) run inside the PWA closure against whatever URL the user types; the 4018 fixture server is the e2e/capture stand-in, not a host edge the app ships with (PLAN §1.2 seam ruling, [below](#the-architecture-story)).

The root `legato:dev` / `legato:test` / `legato:e2e` script wiring landed at L-13 (the Fugue F-11 precedent — [The root wiring (L-13)](#the-root-wiring-l-13)); before it, the commands above were the run surface.

## Test it

| Lane | Command | What it is |
|---|---|---|
| **Lane A** (the purity enforcement lane) | `cd apps/legato && bun test` | 222 tests (207 pass / 15 skip / 0 fail, 884 expects, 26 files) — the app dir has no `bunfig.toml`, so the DOM-free runtime IS the enforcement of the domain's DOM-free boundary; the FakeStorage + FakeFetcher unit lane rides here |
| **Lane B** (the compatibility lane) | `bun test apps/legato` from the repo root | 267 pass / 0 fail (1133 expects) — the root `bunfig.toml`'s happy-dom preload masks the DOM globals; the DOM-guarded UI pins run here (the Ostinato/Chaconne two-lane pair) |
| **The e2e battery** | `LEGATO_E2E=1 bunx playwright test -c playwright.legato.config.ts` | 14 specs across 7 files (the ≥12 bar beaten): **flow** (the keyboard read-loop: empty → clip the clean fixture → j/k → Enter detail → read → Esc), **queue** (the state flips + the Q-3 empty panels), **hostile-clip** (the T-1..T-7 taxonomy rows against 4018 + the B-16 re-run + the T-7 timeout-masking pin), **io** (the byte-stable export/import round-trip + the foreign-schema refusal in-browser), **offline** (the PWA offline boot + the offline fallback page), **a11y** (axe `wcag2a`+`wcag2aa` light + dark, the tab-order pin, the Esc focus-return), **cross-browser smoke** (the flagged Chromium-first condition) |
| **The precache derivation proof** | `bun apps/legato/scripts/verify-precache.ts` | 29 URLs / 0 missing — the static fs walk that parses `PRECACHE_LIST` out of `sw.js` and resolves every entry to a real on-disk file (the Coda C-7 / Ostinato O-5 pattern) |
| **The B-16 holdout** | re-run inside `legato-hostile-clip.spec.ts` | the frozen hostile-fixture set (frozen at L-3, re-run at L-11 — any extraction regression is a red gate, never a silent quality dip; delta receipts land in `benchmarks/vivace-round/`) |

The L-11 close numbers (14 e2e specs, Lane A/B unit green, typecheck 0) are receipted in [`benchmarks/serenade-round/receipts/l11.md`](../benchmarks/serenade-round/receipts/l11.md); every ticket's close gate rides its own receipt — [l3.md](../benchmarks/serenade-round/receipts/l3.md), [l4.md](../benchmarks/serenade-round/receipts/l4.md), [l5.md](../benchmarks/serenade-round/receipts/l5.md), [l6.md](../benchmarks/serenade-round/receipts/l6.md), [l7.md](../benchmarks/serenade-round/receipts/l7.md), [l8.md](../benchmarks/serenade-round/receipts/l8.md), [l9.md](../benchmarks/serenade-round/receipts/l9.md), [l10.md](../benchmarks/serenade-round/receipts/l10.md) — and the round's resumable log is [docs/serenade-round-session.md](serenade-round-session.md).

## The architecture story

One document shape, two hosts, one law — with ONE deliberate extension seam and one deliberate **omission**: the `legato.v1` grammar is declared once in `src/domain/types.ts` and both hosts (the pipeline, the storage seam) import it; plain JSON at every level, no class instances, no `Date` objects, timestamps as ISO-8601 strings. The app's clip pipeline is **browser-side**: `RealFetcher` lives in `src/pipeline/`, not in a Node edge dir — `window.fetch` + `DOMParser` run fine inside the PWA closure, so there is no out-of-closure half to build. **Legato is the first app in the house to need no `runner/` edge at all** (the Chaconne precedent, deliberately reshaped — receipted in the PLAN §8 learning plan).

The browser closure is **network-free by construction**: `boundary.test.ts` scans `src/**` and bans any import that is not a relative `./`/`../` specifier (up-depth ≤ 1 — `../../` escapes the `src/**` closure and is rejected, stricter than the PLAN's letter, receipted at L-1) or `bun:test`. The fixture server (4018) is *test infrastructure* the `RealFetcher` points at in the e2e lane — it is NOT a host process the app ships with; the PWA install context can't walk up to root `node_modules`, and the zero-dep law makes that a non-issue (the app closure is 100% self-contained vanilla TS).

The storage departure from the house pattern is receipted: clip bodies exceed localStorage's quota-class ceiling, so `idb-storage.ts` (the real adapter) + `fake-storage.ts` (the in-memory unit double whose quota-class errors are deterministic by construction — no real IDB ever appears in the unit lane) ride the `StoragePort` interface; the L-11 e2e battery is the ONLY lane that touches real IDB (PLAN §6.1).

## The error taxonomy as product surface

The seven-entry `ClipError` set is not an internal ledger — it is the app's honest-degradation UI, each lane receipted (PLAN §4.1 T-1..T-7):

| Entry | The degraded clip's shape |
|---|---|
| `charset-unknown` | an error clip, never mojibake text |
| `redirect-loop` | no infinite follow; the clip records the loop, `text: ""` |
| `js-walled` | the **FALLBACK lane**: title + URL + the `jsWalled` flag + the "open in browser" affordance — never the default path, no bypass |
| `paywalled` | the clipable **excerpt + link, never bypass** (`paywallExcerptOnly`, `text` = the excerpt) |
| `oversized` | the 500 KB extract cap: the first-N-KB prefix retained + the flag |
| `empty-text` | title+URL fallback + the `emptyText` flag |
| `fetch-failed` | the app-side fetch cap's abort lane: an error clip in bounded time, never a silent hang (the T-7 timeout-masking pin pairs the 4018 `/slow` route with a short cap override) |

The list's degraded rows render the error badge (`.legato-clip-degraded`, the aria-label naming the lane), the detail pane names the lane in its status copy ("Clipped (degraded: …)"), and the B-16 holdout re-run at L-11 pins the taxonomy's positive + negative half against the frozen fixtures — the product surface and the gate are the same contract.

## The B-16 holdout law

The hostile-fixture holdout is **frozen at L-3** (`apps/legato/fixtures/B16-HOLDOUT.md` — the pre-registered task definition + the sha256 pin of the five static fixtures; any fixture-byte change between freeze and re-run is a red gate) and **re-run at L-11** inside `e2e/legato-hostile-clip.spec.ts` — every manifest row lands its exact taxonomy lane (receipted: [l11.md](../benchmarks/serenade-round/receipts/l11.md), the "B-16 re-run: every manifest row lands its exact lane" line), and the L-11 genuine-gap ledger (G-4..G-9) records what the re-run caught: **G-7** (the browser's `redirect:"manual"` + CORS opaque-response reality — the loop route's first run classified as `empty-text`, cured with the manual-first walk; the manifest held as law) stands alongside the **G-4 CORS-pinning** standing cure. Delta receipts land in `benchmarks/vivace-round/` (the PRD's W2 live-web-axis receipt, the PLAN §8 benchmark lane).

## The PWA story

The service worker (`apps/legato/sw.js`) pins the versioned cache `legato-v<N>` and precaches the enumerated 29-entry runtime closure — the **static derivation proof** (`scripts/verify-precache.ts`, the Coda C-7 / Ostinato O-5 pattern) asserts the precache list equals the app's asset closure, re-runnable locally on demand and a dedicated CI step (L-13's job). The manifest (`public/manifest.webmanifest`, `start_url "./"` + `scope "./"`) makes the app installable; the offline fallback page (`public/offline.html`) is the one the offline-boot e2e spec drives. The `/health` + clip-fetch lanes are NEVER cache-served (the fetch policy's pass-through set).

## The dependency ruling

`apps/legato/package.json` declares **no dependencies and no devDependencies** (the seven-line whole-file invariant, the Ostinato/Chaconne law): nothing to vendor — the app closure is 100% self-contained vanilla TS, and the zero-dep law constrains the APP, not the repo (the e2e lane's `@playwright/test` resolves from the repo root's `node_modules`; the fixture server is plain-Bun test infra). The L-11 close receipts' lockfile-drift assert rides L-13's CI job (the frozen-lockfile gate, the F-11 precedent).

## The honest scope

The round's platform scope is **Chromium-desktop-only** — the PRD's own non-goal #3 (no Firefox/WebKit full parity; the cross-browser lane is a SMOKE, run under a second engine if the lane allows, the gap otherwise stays a named `[U]`). No live-network test ever runs in CI or the capture lane — the 4018 fixture server stands in for the hostile web (the static + dynamic routes, the G-4 CORS-pinned headers, zero CDNs). The P1 backlog (post-freeze, out of L-1..L-13): browser-extension quick capture, reading-time estimates, per-tag digests, WebDAV file sync, Firefox/WebKit full batteries. No AI features in the app itself — the agent built it; the app is deterministic.

## The root wiring (L-13)

L-13 (the Fugue F-11 precedent — root wiring lands last, separate, on a green tree) wired the three root surfaces. One dedicated `legato` job in `.github/workflows/ci.yml` (the gate ledger entry: [docs/testing-strategy.md](testing-strategy.md) §6), mirroring the coda/ostinato/chaconne/fugue job shape with Legato's own counts and honest-scope comment. It is **Chromium-desktop-only** — the PRD's own platform scope statement. Three proofs in the one job:

1. **Frozen lockfile + the zero-dep invariant** — `bun install --frozen-lockfile` followed by a lockfile-drift assert (`sha256sum bun.lock` against `git show HEAD:bun.lock`). `apps/legato/package.json` declares no dependency fields at all (the seven-line whole-file invariant, [The dependency ruling](#the-dependency-ruling)), so any Legato dep pulled in at the root moves the hash and reds the job.
2. **Lane A** (`cd apps/legato && bun test` — 222 tests / 26 files, 207 pass / 15 skip / 0 fail, 884 expects; the L-11 close numbers receipted in [`benchmarks/serenade-round/receipts/l11.md`](../benchmarks/serenade-round/receipts/l11.md)) — the app directory carries no `bunfig.toml`, so the DOM-free runtime IS the enforcement of the domain's DOM-free boundary; the FakeStorage + FakeFetcher lane rides here.
3. **The isolated e2e battery** (`bunx playwright test -c playwright.legato.config.ts` — 14 specs across 7 files) with its own Chromium install and its own artifact (`playwright-report-legato`); the `LEGATO_E2E` marker arms in the legato config ONLY, so the specs self-skip under the root landing lane — it stays green and untouched by construction.

The root `package.json` gained the three `legato:*` scripts (after the `fugue:*` block):

```sh
bun run legato:dev   # bun apps/legato/serve.mjs                    → http://127.0.0.1:4017
bun run legato:test  # cd apps/legato && bun test                   (Lane A)
bun run legato:e2e   # LEGATO_E2E=1 bunx playwright test -c playwright.legato.config.ts
```

**Port discipline** (the `PLAN.md` §5.1 ops contract, restated as CI law):

- **4017** — the reserved dev port. `serve.mjs`'s default `LEGATO_PORT`; the e2e config's first `webServer` boots it (`http://127.0.0.1:4017/health` liveness probe). CI reuses it via `reuseExistingServer: !process.env.CI` — a stale dev server reds the job rather than silently driving against it.
- **4018** — the hostile fixture lane. `scripts/fixture-server.mjs` serves the committed static hostile HTML + the dynamic routes (`/redirect-chain`, `/redirect-loop`, `/walled-403`, `/walled-429`, `/slow`); the e2e config's second `webServer` boots it. Never a live target — the fixture server IS the hostile web for every test lane.

**Honest-scope statement — what this job runs, and what it never runs:** the fixture lane and the e2e battery, Chromium-desktop only. It never runs **the browser-clip lane against the live web**: `RealFetcher`'s real-world clipping (window.fetch against arbitrary user-supplied URLs) is a live-network path, and no live-network test ever runs in CI (the PRD's P0 honesty law, the chaconne fixture-honesty pattern) — the 4018 fixture server stands in for the hostile web. The `LEGATO_E2E` self-skip marker keeps the root landing lane's `bunx playwright test` collecting-but-skipping the legato specs, untouched by construction.

## The landing band's stills

The landing band's stills come from the app's own usage-capture lane, `apps/legato/scripts/capture-usage.mjs` (the Chaconne/Fugue lane ported): it boots the real app on 4017 beside the fixture server on 4018, drives the real UI keyboard-first (the Ctrl+K → type-filter → Enter palette lane, the clip affordance's own URL form, the tag editor's `h`/`t`/Enter keys, the `j`/`k`/`Enter` list lane) and stills six honest states under the light scheme: the empty state, the list with REAL clips (seeded through the app's own clip flow against the 4018 fixtures — `clean.html`, `redirect-chain`, `paywall-excerpt.html`), the reading view with a highlight (the `h` key's selection-to-`<mark>` binding), the palette open, the tag filter bar (two tags seeded through the app's own tag editor), and the hostile-clip honest outcomes (`walled-403` + `wrong-charset.html` — the T-3 + T-1 taxonomy lanes visible as the degraded rows). Committed under `public/landing/legato/` with the `PROVENANCE.md` sidecar as the receipt. No live network: every clip URL is a 127.0.0.1:4018 fixture. Re-run on demand: `bun apps/legato/scripts/capture-usage.mjs [target-dir]`.

## Related pages

- [docs/coda.md](coda.md) · [docs/ostinato.md](ostinato.md) · [docs/chaconne.md](chaconne.md) · [docs/fugue.md](fugue.md) — the sibling products
- [docs/vivace-prd.md](vivace-prd.md) — the Legato PRD (the pre-registered §0.9.5 fallback, APPROVED selection)
- [docs/serenade-round-session.md](serenade-round-session.md) — the owning round's resumable checkpoint log
- [benchmarks/serenade-round/README.md](../benchmarks/serenade-round/README.md) — the §0.9 selection receipt + baseline battery
- [benchmarks/vivace-round/](../benchmarks/vivace-round/) — the B-16 holdout lane (the frozen hostile fixtures + the re-run receipts)
- [apps/legato/PLAN.md](../apps/legato/PLAN.md) — the L-0 scored plan (the seam ruling, the module tree, the ticket queue)
- [README.md](../README.md) — the repo overview
