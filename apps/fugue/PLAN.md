# Fugue — Architecture Plan (F-0)

> **Status: APPROVED** — plan scored 98/100 (2026-11-07), per the approved
> architecture plan at `.unown/plans/plan.md`. This file is the ONLY write
> F-0 makes; F-1 owns the first code write under `apps/fugue/`.

Basis: `docs/fugue-prd.md` (APPROVED 2026-11-07, the binding P0/P1/P2
scope), the house-pattern parent `apps/chaconne/PLAN.md` (structure and
laws studied), `docs/chaconne.md`, the Sonata round receipt
(`benchmarks/sonata-round/README.md`), and the engine surfaces the console
consumes (`docs/routines.md`, `docs/memory.md`, `router.ts` JOB_DEFS,
`server.ts` `/api/*`).

One line: Fugue is a keyboard-first, offline-capable PWA console at
`apps/fugue/` whose RUNTIME is the engine's own automation + learning
loop — authoring/observing/curating scheduled agent jobs, not spawning
agents itself. The one deliberate house-pattern extension: a browser-side
`EngineAdapter` seam with a real HTTP adapter in a Node edge dir,
mirroring Chaconne's runner-side Playwright import.

## Mini table of contents

1. [Architecture: module tree + house laws](#1-architecture)
2. [The fugue.v1 grammar](#2-the-fuguev1-grammar)
3. [The ticket queue (F-1..F-11)](#3-the-ticket-queue)
4. [The edge register (E-01..E-12)](#4-the-edge-register)
5. [The ops contract](#5-the-ops-contract)
6. [The test strategy](#6-the-test-strategy)
7. [The three riskiest unknowns + the spike that settles each](#7-the-three-riskiest-unknowns--the-spike-that-settles-each)
8. [Learning plan (receipted at round close)](#8-learning-plan-receipted-at-round-close)

## 1. Architecture

Three modules mirror the Chaconne/Ostinato split (domain under, UI on
top, host edges outside the domain) with the deliberate extension
named: a **browser-side `EngineAdapter` seam** — the interface +
`FakeEngineAdapter` live in the unit lane (zero network); the real
HTTP client lives in `apps/fugue/runner/` (Node edge, like
`runner/` in Chaconne, allowed to `fetch` the localhost engine). The
domain stays pure: types, invariants, ids, schedule projection,
canonical JSON, storage contract. The UI is vanilla TypeScript,
zero-dep. Tests are `bun:test`. The PWA shell is served by
`serve.mjs` on port 4015 (the PRD's ops contract; the capture-usage
lane takes 4016 — devils-advocate ruling, F-11 runbook).

### The house laws

- **Vanilla TS, zero-dep UI**: `src/**` imports only relative
  `./`/`../` and `bun:test`; no runtime dependencies, no CDNs, no
  Node globals in `src/domain/` (the boundary test scans the import
  graph and bans it).
- **The adapter seam as the one deliberate extension**: the browser
  closure is network-free. The real engine client is a Node edge
  process (`runner/engine-client.ts`), reachable only through the
  `EngineAdapter` interface; UI and domain depend on the interface,
  never on a transport. This is Chaconne's runner-side Playwright
  import precedent, applied to the engine REST surface.
- **Engine semantics govern**: the app NEVER opens the engine's
  SQLite, never writes `.unown/memory/**` outside the Manual-notes
  lane, and never spawns agents itself. Execution is the engine's
  alone; the console is authorship/observation/curation.
- **Real data only (V-41)**: no seeded placeholder documents, no
  fake run records in the UI lane. The live lane (F-6) proves a real
  record crosses the app boundary.

### The module tree

```
apps/fugue/
  PLAN.md                       (this file)
  package.json                  (7 lines, no dep fields — zero-dep law, F-1)
  tsconfig.json                 (extends root, includes src/**, F-1)
  index.html                    (PWA shell, F-4)
  sw.js                         (precache CACHE_NAME "fugue-v<N>", F-4)
  serve.mjs                     (Bun.Transpiler dev/test server, FUGUE_PORT=4015, F-4)
  public/
    manifest.webmanifest        (start_url "./", scope "./", F-4)
    icon.svg
  src/domain/                   (flat dir, DOM-free, Node-free — the Ostinato law)
    types.ts                    (Job, the five ScheduleSpec kinds, RunRecordView,
                                 EngineStatusView, FugueData grammar — declared ONCE)
    invariants.ts               (assertData: unique integer ids, run.jobId resolves,
                                 closed schedule-kind set, closed mode set,
                                 non-empty title/prompt)
    ids.ts                      (deterministic integer id helpers)
    schedule.ts                 (pure (schedule, now) -> {due, skip, next} projection
                                 for cron/every/after/once/event with Temporal-
                                 compatible DST semantics, engine-mirrored)
    io.ts                       (canonical JSON: sortKeysDeep + compact separators;
                                 import rejects schema != "fugue.v1" with a dry-run
                                 report — never partial)
    storage.ts                  (StoragePort contract: temp-key + commit-swap,
                                 recover() discards orphans — Ostinato law)
    model.ts                    (pure mutations: addJob, updateJob, addRun, recordEngine)
    *co-located *.test.ts per module + boundary.test.ts (import-graph pin)
  src/adapter/                  (the seam — unit lane, network-free)
    engine-adapter.ts           (interface: listAutomations, createAutomation,
                                 pauseAutomation, resumeAutomation, runNow, skip,
                                 snooze, history, overview, runs, dreams, notes,
                                 memories, spend + the typed error taxonomy)
    fake-engine-adapter.ts      (canned in-memory responses + injected clock;
                                 double for the unit lane)
    rest-adapter.ts             (browser-side typed client that runs against the
                                 fixture-server pins in contract tests; in production
                                 it proxies the runner's engine-client, never direct)
    contract.ts                 (per-endpoint typed pins: response shapes, drift
                                 detectors)
    *co-located *.test.ts
  src/ui/
    app.ts                      (boot, every-transition persistAll, route-by-route)
    palette.ts                  (Ctrl+K palette: 11+ commands, every P0 action)
    job-editor.ts               (compose dialog: prompt/schedule/mode/model/timezone/
                                 misfire/spend-cap with validation; Ostinato dialog
                                 contract)
    job-list.ts                 (grouped job list, status, arrow navigation)
    run-history.ts              (grouped runs: status/tokens/turns/duration)
    run-detail.ts               (error field verbatim — E-05 pin)
    spend.ts                    (meter from /api/automations/spend, throttle state)
    dreams.ts                   (journal, gated/rolled-back status — E-06 pin)
    memory.ts                   (tiers + version count + health card)
    skills-queue.ts             (staging read-only + promote hint)
    manual-notes.ts             (editor, 4k-cap over-marker — E-11 pin, unverified)
    engine-locked.ts            (E-01 panel), engine-down.ts (E-02 outbox panel)
    empty.ts                    (four honest panels: no jobs / no runs / engine down /
                                 no dreams yet — O-1)
    fugue.css
    *co-located *.test.ts (DOM-guarded el-kin pins)
  runner/                       (Node edge — outside the browser closure, excluded
                                 from boundary.test.ts's scan dir, like Chaconne's)
    engine-client.ts            (fetch against http://127.0.0.1:3030, bearer from
                                 $UNOWN_HOME/engine.token, typed per-endpoint
                                 contracts + drift pins)
    fixture-server.ts           (stub engine on fixed port 4130, canned JSON per
                                 endpoint — contract tests never touch live network)
  test/adapter-contract.test.ts (F-3 lane: spins the fixture server, asserts pins)
```

The F-ticket → PRD P0 map is 1:1: P0#1→F-1, P0#2→F-2, P0#3→F-3,
P0#4→F-4, P0#5→F-5, P0#6→F-6, P0#7→F-7(+F-8). No P0 item is orphaned.

## 2. The fugue.v1 grammar

The producer/consumer grammar is declared **once** in
`src/domain/types.ts`; both hosts (the runner adapter, the UI
storage) import it. Plain JSON at every level — no class instances,
no `Date` objects; timestamps are ISO-8601 strings.

### Types (verbatim grammar)

```ts
// ---- Job ----
export type ScheduleSpec =
  | { kind: "cron";    cron: string; timezone?: string }      // 5-field, IANA tz
  | { kind: "every";   every: string }                         // interval, e.g. "2d"
  | { kind: "after";   after: string }                         // completion-anchored
  | { kind: "once";    delayMinutes: number }                  // one-shot, 1..525600
  | { kind: "event";   event: string; filter?: string }       // on-event + filter expr

type Schedule = ScheduleSpec & { misfire?: "skip" | "catch-up" }

export interface Job {
  id: number                 // deterministic integer (ids.ts)
  title: string              // non-empty
  prompt: string             // non-empty
  schedule: Schedule
  mode: "read-only" | "standard"
  model?: string
  timezone?: string          // IANA
  spendCap?: number
}

// ---- RunRecordView ----
export interface RunRecordView {
  id: number
  jobId: number             // resolves against Job ids
  status: "ok" | "failed" | "capped" | "schema-invalid" | "loop-guard"
           | "budget-throttled" | "draining"
  startedAt: string         // ISO-8601
  endedAt?: string
  tokensIn: number
  tokensOut: number
  toolCalls: number
  turns: number
  error?: string            // verbatim — E-05
}

// ---- EngineStatusView ----
export interface EngineStatusView {
  phase: "warming" | "ready" | "draining"
  pid?: number
  version?: string
  memoryVersion?: number
  dreams?: number
}

// ---- FugueData (the document; schema-gate signatures) ----
export interface FugueData {
  schema: "fugue.v1"       // the closed gate value
  jobs: Job[]
  runs: RunRecordView[]
  engineStatus: EngineStatusView
}
export function assertData(data: unknown): asserts data is FugueData
export function importGate(doc: unknown):
  | { ok: true; data: FugueData }
  | { ok: false; reason: "foreign-schema" | "invariant"; report: string }
                                  // dry-run, never partial
```

`assertData` invariants: unique integer job ids; `run.jobId` resolves;
schedule `kind` in the closed five-kind set with the matching spec
fields; `mode` in `{read-only, standard}`; non-empty `title`/`prompt`.
Any breach throws `DomainInvariantError` at every boundary.

### The three laws

- **Canonical-JSON law**: `io.ts` applies `sortKeysDeep` + compact
  separators; arrays keep index order (`runs` order IS the history).
  Same dataset → same bytes on every boot; byte-stable goldens pin it.
- **Schema-gate law**: import refuses any `schema !== "fugue.v1"`
  (including a future `fugue.v2`) with a dry-run report — it lists
  what would be rejected and the store stays byte-identical to
  pre-import. Never a partial import.
- **Round-trip pin law**: the round-trip pin test (export → import →
  byte-identical; foreign schema → refusal + byte-identical store)
  throws on drift between the single declared grammar and either
  host. This is the round's §5-reflex first artifact.

## 3. The ticket queue

Strict build order F-1 → F-11: domain before seam before real adapter
before UI before batteries; batteries (F-6..F-9) after all four
product tickets; docs (F-10) before the CI gate (F-11) which lands on
a green tree. Each ticket names its verifier script.

| Ticket | Scope | Verifier (named script) | State |
|---|---|---|---|
| **F-1** | Domain core: `src/domain/{types,ids,invariants,io,schedule,storage,model}.ts` + co-located tests + `boundary.test.ts`. Job type, five ScheduleSpec kinds, `RunRecordView`, `EngineStatusView`, deterministic integer ids, `assertData`, canonical JSON with the `"fugue.v1"` schema gate, the pure `(schedule, now) → {due, skip, next}` projection mirroring the engine's five kinds with Temporal-compatible DST semantics. | `cd apps/fugue && bun test` (Lane A); `bun test apps/fugue` (Lane B) | open |
| **F-2** | `EngineAdapter` seam: `src/adapter/{engine-adapter,fake-engine-adapter,contract}.ts` — the interface (`listAutomations, createAutomation, pauseAutomation, resumeAutomation, runNow, skip, snooze, history, overview, runs, dreams, notes, memories, spend`), the typed error taxonomy (`EngineLocked`, `EngineDown`), `FakeEngineAdapter` (canned in-memory + injected clock). Unit lane touches no network. | `cd apps/fugue && bun test` | open |
| **F-3** | Real HTTP adapter + fixture-server lane: `runner/{engine-client.ts, fixture-server.ts}`, `src/adapter/rest-adapter.ts`. fetch against `http://127.0.0.1:3030`, bearer from `$UNOWN_HOME/engine.token`, typed per-endpoint contracts with drift pins; stub engine on fixed port 4130 with canned JSON. | `bun test apps/fugue/test/adapter-contract.test.ts` | open |
| **F-4** | PWA shell + job authoring: `index.html`, `sw.js` (fugue-v<N>), `serve.mjs` (Bun.Transpiler, FUGUE_PORT=4015), `public/manifest.webmanifest`, `src/ui/{app,palette,job-editor,job-list,empty}.ts` + `fugue.css`. serve boot HTTP 200. | `cd apps/fugue && bun test` + `bun run fugue:e2e` (smoke) | open |
| **F-5** | Run history + job detail: `src/ui/{run-history,run-detail,spend}.ts` — grouped runs (status/tokens/turns/duration), error field verbatim, spend meter from `/api/automations/spend` with throttle state; four honest panels. | `cd apps/fugue && bun test` + `bun run fugue:e2e` (flow) | open |
| **F-6** | LIVE loop (e2e lane): `e2e/fugue-live.spec.ts` — create a routine through the PWA against a real engine on 3030, `run now`, assert the run + session note land back in the console. ≥3 consecutive runs, ≥1 cold boot. `/health` on `serve.mjs`. | `bun run fugue:e2e -- --project desktop` (live lane) + operator witness receipt | open |
| **F-7** | Learning views: `src/ui/{dreams,memory,skills-queue,manual-notes}.ts` — dreams journal (gated/rolled-back), memory tiers + version count + health card, skills-staged queue (read-only + promote hint), Manual-notes editor (4k-cap over-marker, marked unverified). | `cd apps/fugue && bun test` + `bun run fugue:e2e` (battery) | open |
| **F-8** | Import/export + schema gate e2e: byte-stable export goldens; foreign/future-schema refusal with the dry-run report UI. | `bun run fugue:e2e` (io battery) | open |
| **F-9** | a11y lane: `e2e/fugue-a11y.spec.ts` — axe wcag2a+wcag2aa, light+dark, tab order, Esc focus-return. | `bun run fugue:e2e` (a11y battery) | open |
| **F-10** | Docs + landing band: `docs/fugue.md`, README section, landing band. | `bun run check:docs` | open |
| **F-11** | CI gate + root wiring: root `package.json` (`fugue:dev`/`fugue:test`/`fugue:e2e`), `ci.yml` fugue job, runbook (4016 capture-port ruling + walk-up resolution), honest-scope statement. | `bun run fugue:test` + `bun run fugue:e2e` + `bun run typecheck` on a clean tree | open |

## 4. The edge register

Every edge case from the plan's register has a named ticket verifier —
none orphaned. The "Verifier" column names the script lane that pins
it.

| ID | Edge case | Verifier | Ticket |
|---|---|---|---|
| E-01 | Engine token missing/rotated at boot → honest "engine locked" panel, retry affordance, never a blank | `cd apps/fugue && bun test` (F-2 fake throws `EngineLocked` pin) + `bun run fugue:e2e` | F-2 (+F-6) |
| E-02 | Engine down at adapter call → typed `EngineDown`, queued-action outbox surfaced, never silent success | `cd apps/fugue && bun test` (F-2 pin) + `bun run fugue:e2e` (F-5 flow) | F-2 (+F-5) |
| E-03 | Routine created in PWA but engine restarted before first run → re-sync by routine id, no duplicates | `bun test apps/fugue/test/adapter-contract.test.ts` (drift-pin) | F-3 |
| E-04 | Budget governor throttled → spend meter shows throttle state, runs marked `budget-throttled` | `cd apps/fugue && bun test` (F-5 pin: canned spend JSON) | F-5 |
| E-05 | Run fails mid-tool-stream → run detail shows the error field verbatim; no partial run rendered as success | `bun run fugue:e2e` (F-5 flow) | F-5 |
| E-06 | Dream gated + rolled back → dreams journal shows `gated` status with rollback pointer | `cd apps/fugue && bun test` (F-7 pin) | F-7 |
| E-07 | Corrupt localStorage at boot → recovery panel with export-the-wreckage, never a silent wipe | `cd apps/fugue && bun test` (F-1 storage test) | F-1 |
| E-08 | Foreign/future schema at import → dry-run refusal report, store byte-identical | `bun run fugue:e2e` (F-8 io battery) | F-8 |
| E-09 | Job edited between schedule-due and run-start → engine semantics govern, UI never predicts a run the history disproves | `cd apps/fugue && bun test` (F-1 scheduler pin) + `bun run fugue:e2e` | F-1 (+F-5) |
| E-10 | Timezone/DST edges in `"2d at 09:00"` schedules → projection mirrors engine, pinned (spring gap shift, fall fold, 167/169h weekly) | `cd apps/fugue && bun test` (F-1 unit pins) | F-1 |
| E-11 | Manual-notes editor hitting the 4k cap → over-cap marker, never a silent truncate | `cd apps/fugue && bun test` (F-7 pin) | F-7 |
| E-12 | Concurrent routine run + interactive session → tokens/turns reflect engine accounting only; UI never invents numbers | `bun test apps/fugue/test/adapter-contract.test.ts` (drift pin: tokens/turns fields) | F-3 |

## 5. The ops contract

- **Serve**: `serve.mjs` (Bun.Transpiler dev/test server) listens on
  port **4015** (`FUGUE_PORT`, the PRD's ops contract). The
  capture-usage lane (F-10/F-11) takes **4016** — the devils-advocate
  port-collision ruling recorded in F-11's runbook.
- **`/health`**: `serve.mjs` exposes `GET /health` → `{ "ok": true,
  "port": 4015 }` — the cheap liveness probe the e2e webServer asserts
  on before launching specs.
- **Fixture server**: F-3's `runner/fixture-server.ts` is a stub
  engine on the fixed port **4130** (`FUGUE_FIXTURE_PORT`), serving
  **canned JSON per endpoint** (`/api/overview`, `/api/automations`,
  `/api/runs`, `/api/dreams`, `/api/notes`, `/api/memories`,
  `/api/automations/spend`). Contract tests assert the typed pins
  against it; **never live network in CI**.
- **Engine discovery**: the real adapter (`runner/engine-client.ts`)
  reads the bearer token from **`$UNOWN_HOME/engine.token`** and talks
  to the engine at **`http://127.0.0.1:3030`**. Missing/rotated token
  → the typed `EngineLocked` error (E-01 panel), never a blank.
  Engine REST drift is a ticket, never silent (the PRD's anti-rot
  law): typed contracts + per-endpoint drift pins + fixture pins.
- **The FUGUE_E2E=1 self-skip guard**: e2e specs check the env marker
  at module scope; when `FUGUE_E2E` is not `1` the specs self-skip
  (the Coda/Chaconne `CODA_E2E`/`CHACONNE_E2E` precedent), so the
  specs never run under any other lane's marker. Live specs
  (`fugue-live.spec.ts`) additionally require the real engine at 3030
  and skip with an honest log line if it is absent — off-peak by
  convention, ≥3 consecutive runs with ≥1 cold boot at close.

## 6. The test strategy

- **Lane A (enforcement)**: `cd apps/fugue && bun test` — domain +
  ui + adapter vs `FakeEngineAdapter` + the fixture-server contract
  lane. `apps/fugue` has **no** bunfig → the DOM-free runtime is the
  enforcement lane (the Ostinato/Chaconne law).
- **Lane B (compatibility)**: `bun test apps/fugue` from the root —
  the root `bunfig.toml` happy-dom preload masks DOM-free enforcement
  as the compatibility form.
- **Root-battery integration law**: only `apps/fugue/src/**` joins
  the root battery (the substring `"src"` filter); `runner/` + the
  `e2e/` dir stay out — they are Node-edge and spec code, exactly as
  Chaconne's runner lane is excluded from the root test glob.
- **e2e config — `playwright.fugue.config.ts` (repo root, F-4/F-6)**:
  - `testDir: "e2e"`, `testMatch: /fugue-.*\.spec\.ts/` — selects ONLY
    the fugue specs; every other lane's marker never arms this one.
  - module-scope `process.env.FUGUE_E2E = "1"` arms the marker.
  - **Desktop Chrome only** (`devices["Desktop Chrome"]`, the PRD's
    platform-scope statement); no WebKit/Firefox in P0.
  - `outputDir: "download/test-results-fugue"` (gitignored scratch).
  - `baseURL: "http://127.0.0.1:4015"`; ONE webServer entry: `bun
    apps/fugue/serve.mjs` with `env: { FUGUE_PORT: "4015" }`.
  - `reuseExistingServer: !process.env.CI`, `timeout: 60_000`
    (Ostinato's values verbatim).
- **a11y lane (F-9)**: `e2e/fugue-a11y.spec.ts` runs axe with
  `wcag2a` + `wcag2aa` under BOTH the light and dark color schemes,
  plus the tab-order pin and the Esc focus-return pin (the Ostinato
  dialog contract re-pinned).
- **Root wiring (F-11)**: root `package.json` gains `fugue:dev` /
  `bun apps/fugue/serve.mjs`, `fugue:test` / `cd apps/fugue && bun
  test`, `fugue:e2e` / `bunx playwright test -c
  playwright.fugue.config.ts`; the root `tsconfig.json` include gains
  `apps/fugue/**/*.ts` and `bun run typecheck` becomes the app's
  typecheck gate. The `ci.yml` fugue job runs Lane A, Lane B, the
  fixture contract lane, and the e2e self-skip lane (live lane only
  off-peak), plus the lockfile-drift assert and the check:docs /
  check:changelog / check:claims gates riding F-10.

## Appendix — what does NOT land in F-0's scope

No app code, no tests, no `index.html`, no `sw.js`, no `serve.mjs`,
no `package.json` (the app's or the root's), no
`playwright.fugue.config.ts` — all of it is F-1..F-11's. This file is
the ONLY write F-0 makes. P1 (event-routine authoring,
next-occurrence preview, more themes) and P2 (multi-engine
federation, cloud, mobile WebKit) are post-freeze per the PRD; no
F-ticket touches them.

## 7. The three riskiest unknowns + the spike that settles each

1. **Does the fixture-server lane on 4130 give a stable, drift-detected
   surface for the engine REST pins, or do the canned-JSON shapes
   rot the moment the engine ships a new field (the shipped ~4×/day
   rate)?**
   *Spike (F-3, first chunk):* generate the canned JSON for every
   pinned endpoint from the LIVE engine's real responses (one-shot,
   operator-witnessed, committed as fixtures), then assert the
   round-trip through the typed contracts. If a field the UI renders
   is optional on the live side but required by the contract, the
   spike FAILS LOUDLY and the contract is the ticket — never a
   silent widening. Settles the anti-rot law before F-4 builds on it.
2. **Does the browser-side `rest-adapter.ts` proxying the runner's
   `engine-client.ts` add a hidden second hop that the PWA closure
   can't actually reach in an offline/production install (the runner
   is a Node edge)?**
   *Spike (F-4, first chunk):* a 20-line lane that boots the PWA via
   `serve.mjs`, opens the compose dialog, and renders one live job
   through the proxy path against the fixture server; then re-runs it
   with the runner lane stubbed out and asserts the app degrades to
   the `EngineDown` panel (never a crash, never a blank). Green →
   the proxy contract is confirmed; red → the proxy is cut and the
   unit lane's `FakeEngineAdapter` becomes the only browser-side
   double, with the live lane e2e-only (recorded in the F-4 receipt,
   the PRD's "runner-side exception" wording honored).
3. **Does the DST projection pin (E-10: spring gap shift, fall fold,
   167/169h weekly) hold when Temporal is unavailable on the target
   runtime (bun's Temporal support is version-gated)?**
   *Spike (F-1, first chunk):* run the three DST unit pins against
   both `Temporal` (when available) and a pure `Intl.DateTimeFormat`
   fallback; if the outputs differ on the fold case, the pin is the
   fallback-corrected value and the divergence is receipted in
   F-1's test file (documented, not silently chosen). The projection
   must mirror the engine's documented `docs/routines.md` semantics,
   so the engine is the tie-breaker, read at spike time.

## 8. Learning plan (receipted at round close)

- **memory**: pin the engine REST shapes + the `$UNOWN_HOME/engine.token`
  discovery path into project memory after F-2..F-6 consolidate (the
  H-20 seed: an engine-contract skill candidate).
- **benchmark**: the live-loop lane receipts (F-6) feed the W2
  evidence (learning-loop on a real workload); the round-trip pin
  test (F-8) is the §5 reflex's first artifact.
- **skill**: the adapter-contract lane (fixture server + typed pins +
  drift pins) is the reusable pattern for any future app that
  consumes the engine REST surface; mint after F-3 lands green.
