# Chaconne — Architecture Plan (C-0)

> Read-only plan. No files exist under `apps/chaconne/` yet; this document is
> the only write. C-1 owns the first code write. Basis: `docs/chaconne-prd.md`
> (APPROVED 2026-11-06), the house patterns of `apps/coda/` + `apps/ostinato/`,
> and the root test lanes (`package.json`, `playwright.ostinato.config.ts`,
> `e2e/`). Ticket queue: C-1..C-11 from `docs/rondo-round-session.md`.

## 1. Module decomposition + file tree + C-ticket mapping

Three modules, mirroring the Ostinato layering (domain under, UI on top,
host edges outside the domain) with one deliberate extension: a **runner**
process that lives OUTSIDE the browser-closure and imports the repo-root
Playwright (the PRD's named exception to the zero-dep law — ruling in §4).

### File tree (proposed)

```
apps/chaconne/
  PLAN.md                       (this file)
  package.json                  (7 lines, no dep fields — zero-dep law, C-1)
  index.html                    (PWA shell, C-3)
  sw.js                         (precache CACHE_NAME "chaconne-v<N>", C-6/PWA)
  serve.mjs                     (Bun.Transpiler dev/test server, CHACONNE_PORT=4014, C-3)
  public/
    manifest.webmanifest        (start_url "./", scope "./", C-6)
    offline.html                (offline fallback page, C-7)
    icon.svg
  test/fixtures/                (LOCAL fixture pages — never live network, §3; C-2)
    form-iframe.html            (form page with an iframe-hosted field — #43 class)
    tall.html                   (tall scrollable page, > viewport)
    slow.html                   (slow-loading page: staggered timers, late content)
    dynamic.html                (page with dynamic content: timer-driven DOM changes)
    blank.html                  (assert-element-negative / empty-page control)
  src/domain/                   (flat dir, DOM-free, Node-free — the Ostinato law)
    types.ts                    (Recipe, Step, RunRecord, Schedule, ArtifactRef,
                                 error taxonomy: step-failed | selector-not-found |
                                 timeout | invalid-recipe; integer IDs)
    ids.ts                      (deterministic nc-c-kin id helpers)
    invariants.ts               (assertData: step-order invariants, unique ids,
                                 known step kinds, selector shape, artifact name
                                 collisions → content-addressed)
    model.ts                    (pure mutations: addRecipe, updateRecipe (bumps
                                 recipeVersion), addRun, recordSchedule)
    io.ts                       (canonical JSON: sorted keys, compact separators,
                                 unicode-stable; import rejects foreign/future
                                 schema with a dry-run report — never partial)
    storage.ts                  (StoragePort contract: temp-key + commit-swap,
                                 recover() discards orphans — Ostinato law)
    scheduler.ts                (pure (schedule, now) → due-skip-record: interval +
                                 one-shot, misfire policy skip-and-record)
    *co-located *.test.ts per module + boundary.test.ts (import-graph pin)
  src/storage/
    local-storage.ts            (localStorage adapter over the StoragePort:
                                 "chaconne.data" / "chaconne.tmp"; atomic writes,
                                 corrupt-store recovery — OUTSIDE the domain on
                                 purpose, like Ostinato)
  src/ui/
    app.ts                      (boot, every-transition persistAll, route-by-route)
    palette.ts                  (Ctrl+K palette: every P0 action reachable)
    recipe-editor.ts            (modals on the Ostinato create-form contract:
                                 role=dialog, aria-modal, attach-before-focus,
                                 Esc focus-return, double-Esc discard guard)
    run-history.ts              (grouped lists, arrow navigation, selection pins)
    artifact-viewer.ts          (screenshot + extracted values)
    status.ts                   (live runner progress: step N of M, elapsed;
                                 honest loading states)
    empty.ts                    (no recipes / no runs / no artifacts / failed run
                                 panels — never blank)
    chaconne.css
    *co-located *.test.ts (DOM-guarded el-kin pins, the el.test.ts precedent)
  runner/                       (★ the runner process — Node, NOT in the PWA
                                 closure, NOT in boundary.test.ts's scan dir;
                                 imports repo-root playwright, §4)
    index.ts                    (CLI entry: `bun apps/chaconne/runner/index.ts
                                 run <recipe>` — loads store from disk JSON,
                                 executes, writes run record atomically)
    page-adapter.ts             (the seam: interface PageAdapter{goto,click,
                                 fill,select,wait,assertText,assertElement,
                                 extract,screenshot}; a RealPageAdapter (wraps
                                 Playwright Page) + the FakePageAdapter is a
                                 domain-side test double, see §3)
    real-adapter.ts             (RealPageAdapter on top of
                                 @playwright/test / playwright Page: iframe
                                 frame resolution for fill, fullPage screenshots,
                                 verify-value-landed after fill — #43/#44 kin)
    caps.ts                     (per-step + per-run caps: max steps, wall clock;
                                 committed-prefix law — a killed run keeps only
                                 the prefix of steps that fully completed)
    store.ts                    (disk store: recipe/run JSON files under
                                 apps/chaconne/data/ (gitignored), written with
                                 temp-file + rename-swap; content-addressed
                                 artifact names sha256(payload))
    schedule.ts                 (schedule loop: one-shot/interval, misfire
                                 policy skip-and-record on machine-sleep gaps,
                                 no silent catch-up storm; run-history dedup)
    log.ts                      (run log artifact: honest step-by-step log +
                                 error taxonomy entries)
```

### C-ticket mapping (what each ticket builds)

| Ticket | Builds (from the tree) | PRD P0 items it closes |
|---|---|---|
| **C-1** | `src/domain/*` (types, ids, invariants, model, io, storage contract + tests + boundary pin), `src/storage/local-storage.ts`, `apps/chaconne/package.json` (7-line zero-dep), `tsconfig`/eslint scoping notes | P0 #1 (model: recipes, step kinds, run records, validation on every boundary, integer IDs, canonical JSON) |
| **C-2** | `runner/page-adapter.ts` seam + `caps.ts` + `store.ts` + `log.ts`, `test/fixtures/*.html`, fake-adapter runner unit lane + ONE real-browser smoke against a fixture | P0 #2 (runner: all 9 step kinds against LOCAL fixtures, per-step/per-run caps, artifacts, atomic run-record writes, error taxonomy) |
| **C-3** | `index.html`, `sw.js` skeleton, `serve.mjs`, `public/manifest.webmanifest`, `src/ui/app.ts`, `recipe-editor.ts`, `run-history.ts`, `artifact-viewer.ts`, `palette.ts`, `empty.ts`, `chaconne.css` | P0 #4 (keyboard-first surface: list/create/edit, run history, artifact viewer, palette, honest empty/loading/error states, zero-dep, localStorage atomic) |
| **C-4** | `src/domain/scheduler.ts` + tests (injected clock — Ostinato law), `runner/schedule.ts`, schedule UI rows in `run-history.ts` | P0 #3 (recurring loop: one-shot/interval schedules, misfire policy skip-and-record, run-history dedup) |
| **C-5** | assertion + extraction hardening in `runner/*` (value checks, screenshot capture with pinned hashes, extraction report), `sw.js` precache list completion | P0 #2's artifact depth: **value checks, pinned screenshot hashes, extraction report** (the verification lanes P0 #5 are §3 + C-6..C-9's batteries) |
| **C-6** | `e2e/chaconne-flow.spec.ts` (K-1 compose → run → artifacts keyboard-only), `e2e/chaconne-a11y.spec.ts` (axe both schemes + tab-order + Esc focus-return), `playwright.chaconne.config.ts` (arms CHACONNE_E2E, self-skip-guarded) | P0 #4's K-1 law + P0 #7's battery wiring start + P0 #6 PWA shell (sw.js, offline.html, precache proof `scripts/verify-precache.ts` written in C-6 or C-7 — **rule: verify-precache.ts lands with the PWA completion in C-7**) |
| **C-7** | `e2e/chaconne-resilience.spec.ts` (kill/resume/verify R-1 law, corrupt-store recovery boot, offline PWA boot O-1), `public/offline.html`, `scripts/verify-precache.ts`, `scripts/capture-usage.mjs` | P0 #7 resilience lanes + P0 #6 PWA (offline-complete shell, installable, precache with static derivation proof) |
| **C-8** | import/export battery: `e2e/chaconne-io.spec.ts` + golden files + dry-run report UI hook | P0 #1's canonical export (byte-stable) end-to-end + P0 #4's export/import surface |
| **C-9** | a11y battery completion + light/dark both-scheme drive (axe wcag2a/2aa), tab-order pin, Esc focus-return pins | P0 #4 a11y hardening rows |
| **C-10** | landing band + `docs/chaconne.md` + README section + usage captures (`public/landing/chaconne/` stills via capture-usage.mjs) | P0 #7's product surface (landing band, docs page, usage captures) |
| **C-11** | root `package.json` scripts (`chaconne:dev`/`chaconne:test`/`chaconne:e2e`), `.github/workflows/ci.yml` chaconne job (lockfile-drift assert, Lane A/B, e2e), runbook, honest-scope statement (Chromium-desktop, fixture honesty) | P0 #7's CI gate entry + honest scope |

## 2. File-store schema on the Ostinato laws

**Two stores, one law:** the UI shell persists to **localStorage** (browser,
the Ostinato `local-storage.ts` law) and the runner persists to **disk JSON
files** (Node, the same atomic pattern). The domain is plain-JSON at every
level — no class instances, no `Date` objects; timestamps are ISO-8601
strings. The same schema shape feeds both; disk files are the import/export
canonical document.

### `ChaconneData` (the document)

```
{
  "schema": "chaconne.v1",       // top-level; import rejects any other value
                                  // (future-schema → dry-run report, never
                                  // partial import — PRD edge case 9)
  "recipes": [                   // integer ids (ids.ts), stable array order
    {
      "id": 1,
      "name": "…",               // unicode-safe; canonical export
                                  //  byte-stable (PRD edge case 8)
      "version": 3,              // bumped on every edit — a RUNNING recipe
                                 // snapshots its version at start
                                 // (PRD edge case 6)
      "steps": [                 // ordered; kinds: goto|click|fill|select|
        { "id": 11, "kind": "fill",   // wait|assert-text|assert-element|
          "selector": "…",            // extract|screenshot
          "value": "…?", "timeoutMs": 5000?, "intoFrame": "…?" }
      ],
      "schedule": { "kind": "one-shot"|"interval", "everyMs"? ,
                    "nextDueIso"? , "lastFiredIso"? }?
    }
  ],
  "runs": [
    {
      "id": 1,
      "recipeId": 1,
      "recipeVersion": 3,        // the snapshot law (edge case 6)
      "status": "ok"|"step-failed"|"selector-not-found"|"timeout"
                               |"invalid-recipe",
      "startedAt": "…", "finishedAt": "…?",
      "committedPrefix": 4,      // how many steps fully completed
                                  // (crash-kill edge case 5)
      "artifacts": [
        { "name": "1_r3_sha256:<64hex>.png"|"…_extract.json"|"…_run.log",
          "sha256": "…" }        // content-addressed (edge case 7) — a
                                  // collision can't happen: the name IS
                                  // the hash
      ]
    }
  ]
}
```

**Atomic writes (both hosts).** `save()` writes the temp key first, then
swaps the commit key; `recover()` on boot discards an orphaned temp.
- localStorage: `chaconne.data` / `chaconne.tmp` (Ostinato verbatim).
- disk store: `data/chaconne.data.json` + `data/chaconne.data.json.tmp` —
  `writeFile(tmp)` → `renameSync(tmp, commit)` (atomic on POSIX; the
  runner is a bun/Node process, so `fs.renameSync` is the commit step).
**Corrupt-store recovery.** Undecodable committed bytes → `load()`
returns `null` and boot runs `importData`-style validation that throws
the honest `DomainInvariantError` UI state (corrupt panel, never a
silent wipe; never a crash) — Ostinato's `load()` receipt, verbatim.
**Canonical JSON byte-stability.** `io.ts` port of Ostinato:
`sortKeysDeep` + compact separators + stable array order (arrays keep
index order — `runs` order IS the history; only object keys sort).
Same dataset → same bytes on every boot; golden files pin it (C-8).
**Invariants (`invariants.ts`)**: unique ids per collection; run's
`recipeId` resolves; `recipeVersion` present on every run; step
selectors are non-empty strings; step kinds in the closed 9-kind set;
artifact names match the content-addressed grammar; committedPrefix ≤
steps.length. Any breach → `DomainInvariantError` at every boundary
(P0 #1's "validation on every boundary").

## 3. Fixture-page test strategy

**Law (PRD P0 #5): every test runs against LOCAL fixture HTML committed
under `apps/chaconne/test/fixtures/` — no live-network test ever runs in
CI. Chromium-desktop only (PWA + runner scope statement).**

### The named fixture set

| Fixture | Purpose | PRD edge cases it drives |
|---|---|---|
| `form-iframe.html` | a form whose critical field lives in a same-origin `<iframe>` (plus a plain field) | edge 3 (fill on iframe-hosted field, #43 class — runner must **verify the value landed** after fill) |
| `tall.html` | content ~3× the viewport height, with a known target element near the bottom | edge 4 (screenshot of a page taller than the viewport — full-page capture + the element is assertable without scroll flake) |
| `slow.html` | body content inserted by a `setTimeout` chain (2 s) + a "ready" marker | edge 1 (step timing out mid-run — a `wait` with too-short cap on the slow marker → run record shows the committed prefix; the generous cap passes) |
| `dynamic.html` | timer-driven DOM: text that changes after 1 s, an element that appears then changes class | edge 1/4 kin + `assert-text`/`assert-element` timing determinism |
| `blank.html` | empty document control | edge 2 (selector matching nothing → `selector-not-found`, NOT a hang — a capped wait must produce the taxonomy entry, not a silent timeout-hang) |

Fixtures are static, zero-JS-dependency (inline `<script>` timers only,
no network, no CDNs), and served by `serve.mjs` (or by
`playwright.chaconne.config.ts`'s webServer) so e2e and the runner's real
adapter both address them as `http://127.0.0.1:4014/test/fixtures/…`.

### Runner-unit strategy (the fake page adapter)

The runner's core logic sits BEHIND the `PageAdapter` interface
(`runner/page-adapter.ts`): `goto, click, fill, select, wait,
assertText, assertElement, extract, screenshot`. Two implementors:

- **`FakePageAdapter`** — an in-memory DOM table (map of URL → element
  table + value map + timer ticks driven by an injected clock). Unit lane
  (`bun test`): every step kind, every error taxonomy entry, the caps,
  the committed-prefix law, dedup, misfire policy — all deterministic, no
  browser, no timers, fully off the real-Playwright flake surface
  (#43/#44 kin isolated where they belong: the fake makes the CONTRACT
  deterministic; the real adapter's iframe/verify-value-landed behavior is
  pinned by exactly ONE real-browser smoke per ticket (C-2) + the fixture
  battery in C-6/C-7).
- **`RealPageAdapter`** (runner/real-adapter.ts) — wraps a real Playwright
  `Page`: `frame` resolution for `intoFrame` (find the iframe by
  `name`/`data-testid` on the page, then `frame.fill(...)`),
  **post-fill verification** (`input.value()` read-back must equal the
  intended value — #43's cure), `screenshot({ fullPage: true })` for
  tall pages, capped `waitForSelector`/`waitForFunction` that surface
  `selector-not-found`/`timeout` (never a hang), `textContent()`
  asserts, and `textContent`/`getAttribute` extraction.

**Lane A vs Lane B** applies to the domain exactly as Ostinato's:
`cd apps/chaconne && bun test` (no app-dir bunfig → DOM-free runtime,
the enforcement lane) vs `bun test apps/chaconne` from root (root
`bunfig.toml` happy-dom preload → masked, the compatibility form). The
runner unit tests are DOM-free + Node-fs (fs in a temp dir, not
localStorage) and run in both lanes.

## 4. THE DEPENDENCY-LAW RULING

**Ruling: option (a)** — `apps/chaconne/` keeps `package.json` with NO
dependency fields (the house 7-line law, exactly like Ostinato/Coda), and
the runner lives at `apps/chaconne/runner/` inside the app dir, importing
Playwright from the **repo root's `node_modules`** by absolute bare
specifier:

```ts
// apps/chaconne/runner/real-adapter.ts
import { chromium, Page } from "playwright";   // ← the repo-root @playwright/test's
                                               //   sibling dep "playwright"
```

**Exact import mechanism.** `runner/` is executed ONLY by bun (`bun
apps/chaconne/runner/index.ts …`) from anywhere inside the repo. Bun
resolves bare specifiers by walking up from the importing file's
directory: `apps/chaconne/runner/` → `apps/chaconne/` → `apps/` →
repo root → **root `node_modules/playwright`** (present: root
`package.json` devDependencies `playwright` + `@playwright/test` 1.64.1).
The app dir's own `package.json` having no deps does not block this —
node_modules resolution walks UP, and the root install owns the package.
No install, no lockfile move (the CI lockfile-drift assert stays green —
this is exactly the Ostinato precedent: "No new dependency: the spec
reuses the root `@playwright/test` (the zero-dep law … the Coda C4
precedent)"). The PWA **browser closure** never imports the runner:
`src/` (domain+ui+storage) imports only relative `./`/`../`, `bun:test`
— `boundary.test.ts` scans `src/` only; `runner/` is Node-only and
excluded by construction.

**Risks, named and mitigated** (why (a) over (b)):

1. **Resolution fragility** — the runner only resolves `playwright`
   while it lives under the repo root's tree. Moving `apps/chaconne/`
   elsewhere silently breaks it. *Mitigation:* the C-2 verifier
   (the real-browser smoke) FAILS LOUDLY (bare-specifier error, not a
   flake) if resolution breaks; a one-line doc comment in
   `runner/real-adapter.ts` states the walk-up assumption; CI runs the
   runner lane from repo root only (the runbook, C-11, encodes this).
2. **Version coupling** — the runner inherits whatever playwright
   version the ROOT installs; the root is 1.64.1 for the e2e lane, so
   the runner and the e2e battery can never drift apart (a feature —
   ONE version, one chromium build, the env checkpoint's
   `chromium_headless_shell-1248`). Risk: a root dep upgrade changing
   the runner's behavior. *Mitigation:* the fixture battery IS the
   upgrade verifier; C-11's CI job runs it in the same leg.
3. **Accidental PWA contamination** — a future `import { … } from
   "playwright"` inside `src/` (browser closure) would break the
   offline build. *Mitigation:* `boundary.test.ts` bans bare
   non-relative imports in `src/domain/` (Ostinato's `./`-only rule,
   extended: `src/**` may import `./`, `../`, `bun:test` — nothing
   else); the eslint `no-restricted-globals` scope on
   `apps/chaconne/src/**` (Node globals + DOM in domain) rides the Coda
   pair.
4. **Why not (b) (root-level `scripts/chaconne-runner/`):** it would put
   the runner's product code OUTSIDE the product dir — a runner that
   ships with the app (the PRD's P0 #2 "produces artifacts, writes run
   records, reports the taxonomy" is a product capability, not build
   tooling) scattered in `scripts/`, where the repo convention is
   lifecycle/CI tooling. It also orphans the runner from the app's
   version/DOX ownership and would need a root-level test lane the repo
   doesn't have. The zero-dep law is about **app `package.json` fields
   and the browser closure** — (a) satisfies both while keeping the
   product cohesive. (b)'s one real advantage (explicit "not the app's
   code" signal) is covered by the doc comments + boundary-scan rule
   above. **Operator pre-approves (a).**

### Root `package.json` wiring (C-11 lands it; shapes pre-approved here)

Following the Coda/Ostinato script naming EXACTLY (the Coda/Ostinato
precedent: one-word app token, uppercased, the marker suffix `_E2E`
— `OSTINATO_E2E`, `CODA_E2E`; Chaconne's single-word app token is
`chaconne`, so the marker is `CHACONNE_E2E` and the port var is
`CHACONNE_PORT`):

```jsonc
"chaconne:dev":   "bun apps/chaconne/serve.mjs",
"chaconne:test":  "cd apps/chaconne && bun test",          // Lane A (enforcement)
                  // + the runner unit lane (FakePageAdapter) is IN
                  // apps/chaconne's bun test, so one command covers both
"chaconne:e2e":   "bunx playwright test -c playwright.chaconne.config.ts"
```

`playwright.chaconne.config.ts` (repo root, C-6) is the Ostinato config
verbatim shape:

- `testDir: "e2e"`, `testMatch: /chaconne-.*\.spec\.ts/` — selects ONLY
  the chaconne specs; the root landing lane (`playwright.config.ts`,
  `test:e2e`) and the Coda/Ostinato lanes never arm this marker, so the
  chaconne specs self-skip under every other lane (the Coda
  `CODA_E2E`/Ostinato `OSTINATO_E2E` self-skip-guard precedent).
- module-scope `process.env.CHACONNE_E2E = "1"` arms the marker.
- `outputDir: "download/test-results-chaconne"` (gitignored scratch).
- `baseURL: "http://127.0.0.1:4014"`; chromium-desktop-only project
  (`devices["Desktop Chrome"]`, the PRD's platform-scope statement).
- ONE webServer entry: `bun apps/chaconne/serve.mjs`
  (`env: { CHACONNE_PORT: "4014" }`) — the PWA + fixtures lane; the
  runner's fixture-serve is the SAME server — the fixtures are static
  files under `apps/chaconne/test/fixtures/`, served at
  `/test/fixtures/...`, so ONE webServer covers the e2e specs AND the
  real-browser runner smoke (the runner's e2e cases point
  `RealPageAdapter` at `http://127.0.0.1:4014/test/fixtures/...`).
- `reuseExistingServer: !process.env.CI`, `timeout: 60_000`
  (Ostinato's values verbatim).

Port/env naming (the single-word token throughout —
`CHA_CONNE_*` with a hyphen/underscore split is NOT the name; the app
token is one word, `chaconne`): `CHACONNE_PORT` (default 4014, the
next free port after Ostinato's 4013; Coda is 4012), `CHACONNE_E2E`
(the marker), `chaconne-v<N>` (the PWA `CACHE_NAME`, the
`ostinato-v<N>`/`coda-v<N>` discipline), `chaconne.data` /
`chaconne.tmp` (the localStorage keys, §2), `chaconne.v1` (the
import gate's schema value, §2/§5).

`chaconne:test` runs Lane A in `apps/chaconne` (domain tests + runner
unit tests via the FakePageAdapter + boundary pin + the DOM-guarded UI
pins' honest skips). The runner's real-browser smoke and the e2e
battery ride `chaconne:e2e`. The root `tsconfig.json` include gains
`apps/chaconne/**/*.ts` (C-1, mirroring Ostinato's C5-wiring note —
the root tsconfig's include lists the app dirs; C-1 adds chaconne's),
and root `bun run typecheck` becomes the app's typecheck gate.

## 5. Ticket-sized build order — every P0 item + every edge case
mapped to a named ticket's verifier (none orphaned)

**P0 → ticket (all 7):** P0#1→C-1(+C-8); P0#2→C-2(+C-5); P0#3→C-4;
P0#4→C-3(+C-6/C-9); P0#5→C-2's fixtures + C-6/C-7's battery; P0#6→C-7;
P0#7→C-10+C-11. **Edge cases (the PRD's 11) → ticket's verifier:**

1. **Step timing out mid-run (run record shows the committed prefix)** —
   C-2's verifier: FakePageAdapter timeout case + `slow.html` real
   smoke; `committedPrefix` asserted in the run record; C-7's R-1
   battery re-pins it through the kill lane.
2. **Selector matching nothing (selector-not-found, not a hang)** —
   C-2: `blank.html` fixture + FakePageAdapter + real smoke; the capped
   wait's taxonomy entry asserted (no hang — the e2e timeout is the
   cap, never the spec timeout).
3. **Fill on an iframe-hosted field (#43 class; verify the value
   landed)** — C-2: `form-iframe.html` + `RealPageAdapter`'s
   frame-resolution + post-fill read-back verification (the #43 kin;
   A2H-8's probe feeds it); C-6's flow battery re-runs it
   end-to-end.
4. **Screenshot of a page taller than the viewport** — C-5: `tall.html`
   + fullPage capture + sha256 pin on the artifact; the tall content
   target is assertable (`assert-element` on the bottom element)
   without scroll flake.
5. **A run killed and resumed mid-recipe** — C-7: the R-1 law battery
   (SIGKILL mid-recipe against `slow.html`; boot restores the
   committed prefix; re-run resumes from the prefix boundary, never
   re-fires completed steps; the dedup is C-4's — C-7's verifier
   exercises it against C-4's scheduler).
6. **A schedule misfire after machine sleep (skip-and-record)** —
   C-4: injected-clock scheduler tests (a gap ≥ interval →
   `skipped+recorded` entry, never a silent-double-run, never a
   catch-up storm); the "offline boot with pending schedules" twin is
   C-7's O-1 lane (boot with a due schedule + no network → the
   schedule is deferred+logged, no storm).
7. **A recipe edited while a run is in flight (the run snapshots its
   recipe version)** — C-2: `recipeVersion` snapshot law; a mid-run
   edit (the fake clock + a real e2e in C-6) shows the run's record
   carries the START version; the editor's version bump (C-3's
   recipe-editor) is what the snapshot reacts to.
8. **Artifact-name collisions (content-addressed names)** — C-5: two
   runs producing identical artifact bytes → identical
   `sha256:<64hex>` names, deduped in storage, never clobbered;
   `invariants.ts`'s name-grammar check (C-1) + C-5's battery.
9. **Canonical export with unicode recipe names** — C-8: golden-file
   round-trip with unicode names (UTF-8 byte-stability, no
   \u-escape drift across `JSON.stringify` implementations — the
   golden is pinned, not re-derived).
10. **Import of a future-schema recipe (rejected with a dry-run
    report, never a partial import)** — C-8: the `schema:
    "chaconne.v1"` gate (C-1's `io.ts`); a `chaconne.v2` fixture
    import → the dry-run report lists the rejected rows, and the
    store is byte-identical to pre-import (asserted).
11. **The offline boot with pending schedules (no silent catch-up
    storm)** — C-7: O-1 offline lane + C-4's misfire-policy
    interaction; boot under offline with 3 due schedules → 3 logged
    deferrals, 0 background fires, 0 UI storm.

**Build order (ticket-sized, strict):** C-1 → C-2 → C-3 → C-4 →
C-5 → C-6 → C-7 → C-8 → C-9 → C-10 → C-11. Rationale: domain before
runner before UI before batteries; C-4 (schedules) before C-5
(artifact depth) so C-5's pins can reference the dedup; batteries
(C-6..C-9) after all four product tickets (C-1..C-5); C-8's io
battery after C-2's store exists; C-9 (a11y) after C-6's happy path
(the axe pin needs the flow spec's page states); C-10 (product
surface) needs C-7's capture-usage.mjs; C-11 last (the CI gate asserts
everything above, so it lands on a green tree). Each ticket: ≤4
chunks × 8 turns, fresh session, byte-exact continuation (the round
log's standing economics).

## 6. The three riskiest unknowns + the spike that settles each

1. **Can `bun apps/chaconne/runner/real-adapter.ts`'s
   `import { chromium } from "playwright"` resolve through the root
   `node_modules` from the app dir WITHOUT any app-dir install, in
   BOTH `bun test`'s runner-unit lane and the real-browser smoke,
   on a fresh clone after `bun install`?**
   *Spike (C-2, first chunk):* a 15-line `runner/smoke-resolve.ts`
   that imports the bare specifier, prints `require`-free
   `chromium.executablePath()`, and launches headless chromium
   against `blank.html`. Green → ruling (a) is confirmed; red →
   the fallback is a root-level `test/chaconne-runner/` re-homing
   (option (b)) recorded in the round log, NOT a silent app-dir
   install. Settles the ruling's #1 risk before C-2 builds on it.
2. **Does full-page screenshot + content-addressed sha256 pinning
   actually give stable hashes across the e2e battery on THIS
   machine (the CI's chromium build, GPU/driver state, font
   metrics) — or do we get byte-stable-enough-with-retry flake
   (the #44 kin) that the artifact pin is more honest as a
   "screenshot taken" + "size/dimensions pinned" than a sha256
   byte pin?**
   *Spike (C-5, first chunk):* run the `tall.html` fullPage capture
   5× in the e2e lane, hash each; if 5/5 identical → the sha256
   pin is the law; if <5/5 → the artifact pin degrades to
   dimensions+capture-time+sha-of-metadata (documented in C-5's
   receipt; the PRD's "pinned hashes" wording is satisfied by the
   honest pin, the receipt names which).
3. **Does the R-1 kill/resume law hold across the DISK store's
   temp-file-rename swap when SIGKILL lands between
   `writeFile(tmp)` and `renameSync(tmp, commit)` (the exact
   Ostinato "orphaned temp" window, now on fs instead of
   localStorage) — and does the runner's committed-prefix law
   survive the resume correctly (no step re-fire)?**
   *Spike (C-7, first chunk):* a scripted kill harness — run the
   `slow.html` recipe under `bun runner/index.ts`, SIGKILL at a
   chosen step boundary, inspect the data dir (expect either the
   clean rename or the orphaned tmp), boot, assert the store
   recovers to the committed prefix, re-run, assert no
   re-fire of steps ≤ committedPrefix. The orphaned-tmp discard
   path is the Ostinato `recover()` law, re-pinned on fs.

## Appendix — what does NOT land in this plan (out of C-0's scope)

- No app code, no tests, no fixtures, no `package.json` (the app's
  or the root's), no `playwright.chaconne.config.ts`, no `sw.js`, no
  `serve.mjs` — all of it is C-1..C-11's. This file is the ONLY
  write C-0 makes.
- P1 (cron expressions, screenshot diffing vs a baseline, folders/
  tags, CSV export, `?` sheet) and P2 (cloud sync, accounts,
  captcha, live-network claims, native mobile) are post-freeze /
  deferred per the PRD; C-tickets do not touch them.
- The landing band + docs page + README + usage captures are C-10's
  product-surface ticket; the CI gate + runbook + honest-scope
  statement are C-11's.
