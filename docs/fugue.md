# Fugue — the engine-native automation console

Fugue is the repo's fourth user-facing app, at `apps/fugue/`: **a keyboard-first, offline-capable PWA console for the engine's own automation + learning loop**. It is not a new automation runtime — it is the engine's runtime made visible: author, pause, resume, skip, snooze and run-now the engine's scheduled agent jobs (routines), watch their runs back with honest status/tokens/turns, and curate the learning loop the engine is already running (the AutoDream journal, the tiered memory + health card, the staged-skills queue, and the Manual-notes editor — the one hand-edit lane). The round was selected by the Sonata round's §0.9 procedure, receipted in [benchmarks/sonata-round/README.md](../benchmarks/sonata-round/README.md), and the PRD is [docs/fugue-prd.md](fugue-prd.md).

- [What it is](#what-it-is)
- [Run it](#run-it)
- [Test it](#test-it)
- [The architecture story](#the-architecture-story)
- [The engine-adapter seam ruling](#the-engine-adapter-seam-ruling)
- [The learning-views story](#the-learning-views-story)
- [The PWA story](#the-pwa-story)
- [The dependency ruling](#the-dependency-ruling)
- [The a11y lane](#the-a11y-lane)
- [The FUGUE_NOTES_ROOT law](#the-fugue_notes_root-law)
- [The CI fugue job](#the-ci-fugue-job)
- [The landing band's stills](#the-landing-bands-stills)
- [Related pages](#related-pages)

## What it is

Fugue is the fourth app in the house PWA pattern — after [Coda](coda.md), [Ostinato](ostinato.md) and [Chaconne](chaconne.md) — and the one that points at the engine instead of at localStorage: the UI shell persists its offline shadow to **localStorage** (the canonical `fugue.v1` document, atomic temp-key + commit-swap, the Ostinato law), while every engine fact — the job rows, the run history, the dreams, the memory, the spend meter — is fetched live through the adapter seam and is the engine's own record, never re-invented by the console.

- **Domain core** (`apps/fugue/src/domain/`) — pure, DOM-free, Node-free: the `Job` / `RunRecordView` / `EngineStatusView` types, the five schedule kinds, `assertData` invariants, deterministic integer ids, the canonical-JSON import/export with the `"fugue.v1"` schema gate, and the pure `(schedule, now)` misfire projection (`PLAN.md` §2 is the grammar source).
- **The adapter seam** (`apps/fugue/src/adapter/`) — the `EngineAdapter` interface, the `FakeEngineAdapter` double (canned in-memory, zero network — the unit lane), and the typed per-endpoint contract pins (`contract.ts` — engine REST drift is a ticket, never a silent widening).
- **The UI shell** (`apps/fugue/src/ui/`) — the nine-route surface (jobs ⇄ runs ⇄ run-detail ⇄ spend ⇄ engine ⇄ dreams ⇄ memory ⇄ skills ⇄ manual-notes), the 15-command Ctrl+K palette, the compose dialog on the house dialog contract, and every-transition persistence of the shadow store.
- **The Node edge** (`apps/fugue/runner/`) — OUTSIDE the browser closure: `engine-client.ts` (the real fetch against the engine on 3030, bearer from `$UNOWN_HOME/engine.token`) and `fixture-server.ts` (the stub engine on 4130 with canned contract-pinned JSON — the lane the e2e battery drives).

## Run it

```sh
bun apps/fugue/serve.mjs   # the transpiling static server → http://127.0.0.1:4015 (FUGUE_PORT to override)
```

It is the Coda/Ostinato/Chaconne pattern: plain files + on-the-fly `.ts` transpile via `Bun.Transpiler`, no build step, no bundler, no import map — the zero-dep law means there is nothing to wire. `GET /health` answers `{ "ok": true, "port": 4015 }` — the liveness probe the e2e webServer asserts on. Two lanes, honestly scoped:

- **The fixture lane (everything in this doc's test story)** — boot the stub engine beside the app (`bun apps/fugue/runner/fixture-serve.mjs`, 4130; the e2e specs spawn it themselves per lane). The app's default engine URL is the fixture; with no engine at all it degrades to the `EngineDown` panel + the FakeEngineAdapter, never a blank.
- **The live lane (off-peak, operator-witnessed)** — the real engine on **3030** + the bearer token (`$UNOWN_HOME/engine.token`, or `FUGUE_ENGINE_TOKEN`); the spec injects both through `window.__FUGUE_ENGINE__` (no token ever lands in a served file). The live lane is the F-6 proof lane, run with `FUGUE_LIVE=1` — it needs a real engine and is deliberately not part of CI.

The root `fugue:dev` / `fugue:test` / `fugue:e2e` script wiring is the next ticket, F-11 (the CI gate); until it lands, the commands above are the run surface.

## Test it

| Lane | Command | What it is |
|---|---|---|
| **Lane A** (the enforcement lane) | `cd apps/fugue && bun test` | the app directory's own `bunfig.toml` applies, so the DOM-free runtime is the enforcement of the domain's DOM-free boundary; the FakeEngineAdapter lane and the fixture contract lane ride here |
| **Lane B** (the compatibility lane) | `bun test apps/fugue` from the repo root | the same files from the repo root, where the root `bunfig.toml`'s happy-dom preload masks the DOM globals — the DOM-guarded UI pins run here (the Ostinato/Chaconne two-lane pair) |
| **The fixture contract lane** | `bun test apps/fugue/test/adapter-contract.test.ts` | the F-3 lane: the fixture server on 4130, the typed per-endpoint pins, the drift detectors |
| **The refreshed-fixture lane** (H-24, the V-15 law mechanized) | `cd apps/fugue && bun test src/adapter/fixtures-live.test.ts` | the LIVE-WIRE recording lane: `scripts/a1/fixture-refresh.mjs` regenerates `src/adapter/fixtures-live.gen.ts` from the real engine's verbatim responses (provenance + timestamp), and this lane runs every recorded body through `assertContract` — pin-vs-live drift REDDENS at the dotted path. **The refresh-then-build law: run the refresh at every fixture-consuming ticket's open** (a fixture that is not refreshed is a fixture free to fossilize — the V-24 class); SHOULD-NOT fire on pure-domain tickets. The paired A/B gate (the false-confidence delta on a deliberate wire change) rides `scripts/a1/h24-gate.mjs` |
| **The e2e battery** | `FUGUE_E2E=1 bunx playwright test -c playwright.fugue.config.ts` | the isolated Playwright lane: the smoke, the flow (the E-05 verbatim + E-04 throttle + the palette commands over the live fixture engine), the io battery (the byte-stable export goldens + the schema-gate refusals), the learning battery (the dreams/memory/skills/manual-notes routes) and the a11y battery — all Chromium-desktop, all against the fixture lane, **no live network in CI** |
| **The live lane** (off-peak) | `FUGUE_E2E=1 FUGUE_LIVE=1 …` + the operator witness | the real engine on 3030: create a routine through the compose UI, run-now, watch the run + the session note land back in the console — ≥3 consecutive runs + a cold boot at close (the F-6 operator-gate law) |

The F-9 close numbers (Lane A 283 pass / 0 fail / 31 files, the e2e battery 23 + 1) receipted in `benchmarks/sonata-round/receipts/f9.md`; every ticket's close gate rides its receipt — [f5.md](../benchmarks/sonata-round/receipts/f5.md), [f6.md](../benchmarks/sonata-round/receipts/f6.md), [f7.md](../benchmarks/sonata-round/receipts/f7.md) — and the round's resumable log is [docs/sonata-round-session.md](sonata-round-session.md).

## The architecture story

One document shape, two hosts, one law — but with a twist Chaconne does not have: the app's own persisted document is only the **offline shadow** (the local jobs the console authored, the `fugue.v1` grammar, localStorage with atomic writes). Everything engine-side is fetched live through the seam and rendered as the engine's authoritative rows (the "Engine jobs" lane above the "Offline shadow" lane in the job list). The app NEVER opens the engine's SQLite, NEVER writes `.unown/memory/**` outside the Manual-notes lane, and NEVER spawns agents itself — execution is the engine's alone; the console is authorship, observation and curation. That is the round's §0.9 selection rationale made code: the learning loop IS the product surface, so the product's job is to make the loop visible and curable, not to run it.

## The engine-adapter seam ruling

The one deliberate house-pattern extension, ruled in `PLAN.md` §1 (the Chaconne runner-side Playwright-import precedent, applied to the engine REST surface): the browser closure is **network-free** — `src/**` imports only relative `./`/`../` and `bun:test` (the boundary test scans the import graph and bans more). The real HTTP client lives in `apps/fugue/runner/engine-client.ts` (a Node edge process, allowed to fetch the localhost engine, bearer from `$UNOWN_HOME/engine.token`), reachable only through the `EngineAdapter` interface; the UI and the domain depend on the interface, never on a transport. In dev the browser talks to the fixture server on 4130 directly (the CORS headers are pinned); in production the runner's client proxies the same seam. Missing or rotated token → the typed `EngineLocked` error (the honest "engine locked" panel, E-01), never a blank; engine down → `EngineDown` + the queued-action outbox surfaced (E-02), never a silent success. One engine contract, drift-pinned per endpoint — REST drift is a ticket, never a silent widening (the anti-rot law).

## The learning-views story

The F-7 ticket is the round's keystone: the four views that make the engine's own learning loop the app's surface, all FUGUE_NOTES-free, all fixture-driven:

- **The dreams journal** (`src/ui/dreams.ts`) — the AutoDream consolidation log, newest first, the five-status badge vocabulary (`done`/`running`/`no-notes`/`error`/`gated`) with **gated NEVER green** (E-06), the expandable output preview, the honest no-dreams panel (V-41).
- **The memory view** (`src/ui/memory.ts`) — the tiers (name/version/content preview) + the health card (backend, model, memory count, duplicates, conflicts, warnings, last reconcile) — the degraded lane stays honest.
- **The skills view** (`src/ui/skills.ts`) — the engine's DB skills (the honest empty state in the fixture lane) + the real staged queue through the server's read-only `/skills-staged` route + the promote hint as TEXT (the human `mv` — the 2026-10-22 hardening law: the app never automates promotion).
- **The Manual-notes editor** (`src/ui/manual-notes.ts` + `manual-notes-core.ts`) — the one hand-edit lane into `.unown/memory/project.md`'s `## Manual notes` section: the section extraction/splice with byte-preservation outside the section, the 4k budget meter, the **visible** over-cap marker + the exact dropped tail (edge 11 — never a silent truncate), the "hand-edited, unverified" label, and the atomic write. In-app edits are the human's edits — the app never writes through an agent session (the same law that made the instruction-set write policy real).

## The PWA story

The service worker (`apps/fugue/sw.js`) pins the versioned cache `fugue-v<N>` and precaches the enumerated runtime closure; `/health` and the engine's `/api/*` are NEVER cache-served (the sw.js fetch policy). The manifest is the installable PWA's (`public/manifest.webmanifest`, `start_url "./"`); the offline shell is the one that boots and degrades to the `EngineDown` panel + the FakeEngineAdapter lane — the offline-first form of the Chaconne/Coda story, applied to a console whose live data source is a real engine instead of a local document.

## The dependency ruling

`apps/fugue/package.json` declares **no dependencies and no devDependencies** (the seven-line whole-file invariant, the Ostinato/Chaconne law): the test lane's Playwright resolves from the **repo root's** `node_modules` (the zero-dep law constrains the APP, not the repo), and the e2e lane is self-skip-guarded (`FUGUE_E2E` arming only inside `playwright.fugue.config.ts` — the root landing lane's `bunx playwright test` collects the fugue specs but skips them at run-time, untouched by construction). The one deliberate exception is the Node edge (`runner/`), which lives OUTSIDE the browser closure by the seam ruling above — exactly Chaconne's runner precedent.

## The a11y lane

F-9's battery (`e2e/fugue-a11y.spec.ts`): axe `wcag2a` + `wcag2aa` under **both** light and dark color schemes, the tab-order pin, and the Esc focus-return pin (the Ostinato dialog contract re-pinned on the compose dialog: attach-before-focus, the Tab trap, focus-return to the invoking control). The compose dialog's `aria-labelledby` points at the dialog title's id (not the title input's), the palette listbox carries `tabindex="0"` (the focusable-content pin), and the dark-scheme accent-ink trap is cured by scheme-pairing the badge text (light: the accent pair; dark: the fixed pale-green 7.2:1 on the accent-mix background — never `--fugue-accent-ink` under the dark scheme). Zero WCAG-2AA violations across the jobs, runs, dreams, memory, palette-open and compose-open states — the F-9 receipt's close claim.

## The FUGUE_NOTES_ROOT law

The V-28 isolation ruling: a route that can write a real file resolves its target from the `FUGUE_NOTES_ROOT` env var — default the repo root (the live lane keeps working unchanged), **the test lane always overrides it** with a temp fixture dir, so no test-server boot can write a real file. `serve.mjs`'s `/manual-notes` and `/skills-staged` routes honor the seam, and `apps/fugue/test/isolation-pin.test.ts` pins it end-to-end through a real in-process server: the REAL repo's `.unown/memory/project.md` bytes are snapshotted BEFORE a PUT and asserted byte-identical AFTER, while the temp fixture tree under `os.tmpdir()` carries the change. The law's first live catch was receipted in the round log (an F-7 chunk session PUT-tested against the REAL project.md and was caught by the memory-guard at the commit boundary — the cure is the FUGUE_NOTES_ROOT override, and this doc is its standing statement).

## The CI fugue job

One dedicated `fugue` job in `.github/workflows/ci.yml` (the gate ledger entry: [docs/testing-strategy.md](testing-strategy.md) §6), mirroring the Ostinato/Chaconne job shape with Fugue's own counts and honest-scope comment. It is **Chromium-desktop-only** — the PRD's own platform scope statement; Safari, Firefox, and mobile are untested, not "cross-platform". The **engine-native runtime needs a local engine + the bearer token** (`$UNOWN_HOME/engine.token`, `3030`); without both, Fugue degrades to the `EngineDown` panel + the FakeEngineAdapter lane — never a blank — and that degraded lane is exactly what CI exercises. Three proofs in the one job:

1. **Frozen lockfile + the zero-dep invariant** — `bun install --frozen-lockfile` followed by a lockfile-drift assert (`sha256sum bun.lock` against `git show HEAD:bun.lock`). `apps/fugue/package.json` declares no dependency fields at all (the seven-line whole-file invariant), so any Fugue dep pulled in at the root moves the hash and reds the job.
2. **Lane A** (`cd apps/fugue && bun test` — 283 tests / 31 files, the F-9 close numbers receipted in `benchmarks/sonata-round/receipts/f9.md`) — the app directory's own `bunfig.toml` applies, so the DOM-free runtime is the enforcement of the domain's DOM-free boundary; the FakeEngineAdapter lane and the fixture contract lane ride here.
3. **The isolated e2e battery** (`bunx playwright test -c playwright.fugue.config.ts` — 23 passed + 1 skipped) with its own Chromium install and its own artifact (`playwright-report-fugue`); the `FUGUE_E2E` marker keeps the root landing lane untouched by construction.

**Port discipline** (the `PLAN.md` §5 ops contract, restated as CI law):

- **4015** — the reserved dev port. `serve.mjs`'s default `FUGUE_PORT`; the e2e config's `webServer` boots it (`http://127.0.0.1:4015/health` liveness probe). CI reuses it via `reuseExistingServer: !process.env.CI` — a stale dev server reds the job rather than silently driving against it.
- **4130** — the fixture engine. `runner/fixture-server.ts` serves the canned contract-pinned JSON; every e2e spec drives the app against the fixture lane only.
- **4016** — the capture/probe lane (per the `PLAN.md` §5 ruling): `scripts/capture-usage.mjs` boots the real app on a scratch port beside the fixture engine; the landing stills' receipt lane. Never an e2e target, never a live target.

**The FUGUE_NOTES_ROOT law** (the V-28 isolation ruling, restated): a route that can write a real file resolves its target from the `FUGUE_NOTES_ROOT` env var — default the repo root (the live lane keeps working unchanged), **the test lane always overrides it** with a temp fixture dir, so no test-server boot can write a real file. `serve.mjs`'s `/manual-notes` and `/skills-staged` routes honor the seam, and `apps/fugue/test/isolation-pin.test.ts` pins it end-to-end (byte-identical `.unown/memory/project.md` before/after a PUT against a real in-process server).

**Honest-scope statement — what this job runs, and what it never runs:** the fixture lane and the e2e battery, Chromium-desktop only. It never runs **the live lane**: the `FUGUE_LIVE` gate (the real engine on 3030 + the operator's bearer token, ≥3 consecutive runs + a cold boot at close — the F-6 operator-gate law) is the operator's off-peak witness, and the comment in the job states it. No live-network test ever runs in CI (the PRD's P0 honesty law, the Chaconne fixture-honesty pattern).

The round's full record is in [docs/sonata-round-session.md](sonata-round-session.md); the app's own contracts live in `apps/fugue/AGENTS.md` and its PRD in [docs/fugue-prd.md](fugue-prd.md).

## The landing band's stills

The landing band's stills come from the app's own usage-capture lane, `apps/fugue/scripts/capture-usage.mjs` (the Chaconne lane ported): it boots the real app via `serve.mjs` on a scratch port (4016, the F-11 ruling) beside the fixture engine, drives the real UI — keyboard where the app's own keyboard path exists (the Ctrl+K palette over the learning routes, the arrow-navigated job rows) — and stills eight honest states under the light scheme: the boot/jobs route, the compose dialog, the runs route, the dreams journal, the memory view, the skills view, the Manual-notes editor, and the palette — committed under `public/landing/fugue/` with the `PROVENANCE.md` sidecar as the receipt. No live network: the capture drives the app shell against the fixture engine (canned contract-pinned JSON on 4130); the live lane is the F-6 proof lane, not a capture lane. Re-run on demand: `bun apps/fugue/scripts/capture-usage.mjs [target-dir] [--port P] [--smoke]`.

## Related pages

- [docs/coda.md](coda.md) · [docs/ostinato.md](ostinato.md) · [docs/chaconne.md](chaconne.md) — the sibling products
- [docs/fugue-prd.md](fugue-prd.md) — the app's PRD (APPROVED 2026-11-07)
- [docs/sonata-round-session.md](sonata-round-session.md) — the owning round's resumable checkpoint log
- [benchmarks/sonata-round/README.md](../benchmarks/sonata-round/README.md) — the §0.9 selection receipt + the baseline battery
- [docs/routines.md](routines.md) · [docs/memory.md](memory.md) — the engine surfaces the console consumes
- [README.md](../README.md) — the repo overview
