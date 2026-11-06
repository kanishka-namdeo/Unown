# The Fugue PRD

> **Status: APPROVED 2026-11-07** — selected per the A1 directive §0.9 at
> the Sonata round's selection gate (scored against four alternatives with
> the receipt pre-registered at
> [benchmarks/sonata-round/README.md](../benchmarks/sonata-round/README.md);
> approval recorded per the operator's standing no-permission instruction).
> Etymology: a fugue is a contrapuntal form where independent voices enter
> one by one and interweave on a single theme — scheduled agent jobs are the
> voices, the engine's learning loop is the theme.

One-line purpose: the PRD for **Fugue** — the Sonata round's DRIVE-track
application, the production build that doubles as A2's capability stress
test.

- Round: [the Sonata round log](sonata-round-session.md) · suite:
  [benchmarks/sonata-round/](../benchmarks/sonata-round/) ·
  selection receipt: [the §0.9 scoring](../benchmarks/sonata-round/README.md)
- House pattern: [the Chaconne PRD](chaconne-prd.md) (the prior round's
  vehicle) — Fugue follows the apps/ lane laws; the ONE deliberate extension
  is named in the vision below.

## The vision, in one paragraph

Fugue is a **self-hosted, engine-native automation console**: a keyboard-first,
offline-capable PWA at `apps/fugue/` through which a Unown user authors,
observes, and curates **scheduled agent jobs** — "every weekday at 09:00,
summarize yesterday's commits and open TODOs; report risks" — that execute
as real engine routines (`unown routines`, `--mode json -p` runs), whose runs,
notes, dreams, and memory growth are rendered back in the console with the
same honesty discipline as every house app (real data only, never seeded
placeholders — the V-41 law). It is the first app in this repo whose RUNTIME
is the engine's own automation + learning loop, which is precisely what the
selection bought: the round's #1 structural weakness (learning-loop
accumulation never exercised on a real workload) becomes the product's core
mechanism, and every other advertised learning surface (notes → AutoDream →
memory render; skills-staged queue; memory versioning) gets a first-class
UI in the same stroke.

## Why this app (the §0.9 case, condensed)

- **Weakness-driven, not comfort-driven**: the weakness map's top entry (W2)
  is that no prior round ever exercised the learning loop end-to-end on a
  live workload — minting never fired, no skill promoted, accumulation
  structurally zero per bring-up. Fugue's product surface IS that loop.
  The alternatives (Legato, Tempo) were a fifth house-pattern PWA and a
  parked comfort-zone candidate respectively; both stay evidence-ready as
  §0.9.5 fallbacks.
- **Real-world, not a toy**: the self-hosted automation category is proven
  (n8n, Huginn, changedetection.io); for Unown users specifically it is the
  missing web mission-control over the routines engine.
- **Benchmark-friendly**: every defect class mints a deterministic verifier
  — pure schedule math, adapter contract fixtures, a live-engine e2e lane,
  byte-stable export goldens. The §5 reflex has somewhere to land on every
  lane.
- **The learning lanes get a real workload**: 12+ A2 sessions → tiered
  memory / AutoDream / skill minting / promotion gates (§6c); the engine's
  own runs become the app's data — the loop observing the loop.

## Users and jobs

A self-hoster (the Unown user) who wants their agent to do recurring work
without a terminal open. Job spine: **compose** (write a job: prompt +
schedule + mode + model) → **run** (the engine executes it on schedule or on
demand) → **observe** (run history, artifacts, spend) → **curate** (pause,
edit, skip; watch the job's knowledge grow in memory/dreams; export/import
job definitions).

## Scope

### P0 — the shippable core (7 items, each with its verification lane)

1. **The domain core** — pure types + invariants for Job (id, title, prompt,
   schedule, mode, model, timezone, misfire policy, spend cap), RunRecord,
   EngineStatus; the pure `(schedule, now) → {due, skip, next}` projection
   mirroring the engine's five schedule kinds; canonical JSON + the
   `"fugue.v1"` schema gate (foreign/future schemas REJECTED with a dry-run
   report). — *Lane A unit battery.*
2. **The `EngineAdapter` seam + `FakeEngineAdapter`** — the Chaconne
   `PageAdapter` precedent: one interface (listAutomations, createAutomation,
   pauseAutomation, resumeAutomation, runNow, history, overview, runs,
   dreams, notes, memory health), two implementations, the unit lane never
   touches the network. — *Lane A.*
3. **The real adapter** — HTTP client over the LIVE-pinned engine REST
   surface (`/api/overview`, `/api/automations`, `/api/runs`, `/api/dreams`,
   `/api/notes`, `/api/memories`; bearer token discovery from
   `UNOWN_HOME/engine.token`), typed contracts with drift pins per endpoint.
   The one deliberate house-pattern extension (a runner-side `fetch` client,
   like Chaconne's runner importing playwright). — *Lane A + a
   fixture-server contract test lane (spin a stub engine, assert the pins).*
4. **The PWA shell + job authoring** — vanilla TS, zero deps, `serve.mjs`
   (Bun.Transpiler, port 4015), Ctrl+K palette, the compose dialog
   (prompt/schedule/mode/model/timezone/misfire with validation), the job
   list with status. — *Lane A + serve boot HTTP 200 + e2e smoke.*
5. **Run history + job detail** — runs list with status/tokens/turns/duration,
   run detail with error surfaces, spend meter (`routines spend` kin),
   honest empty/loading/error panels everywhere. — *Lane A/B + e2e flow.*
6. **The LIVE loop** — create a routine THROUGH the PWA, the real engine
   executes it (manual `run now` in P0), the run and its session note land
   back in the console; the real-data bridge lane (no seeded documents —
   the V-41 lesson: a REAL record must cross the app boundary). — *A
   live-engine e2e lane + the operator witness receipt.*
7. **Learning views** — dreams journal (last N, status incl. gated/rolled
   back), memory tiers + version count + health card, the skills-staged
   queue (read-only + the promote hint: staging is a human `mv`), and the
   `## Manual notes` editor (the ONE hand-edit lane, marked unverified in
   the render — in-app edits are the human's edits, never A2's). — *Lane A/B
   + e2e.*

### P1 — post-freeze candidates

- Import/export of job definitions (byte-stable, golden-pinned) — may
  promote into P0's F-8 if the ticket lands light.
- Webhook/event-routine authoring (`--on-event` + filter expression).
- The `--every`/`--cron` next-occurrence preview in the compose dialog.
- Dark/light themes beyond the a11y floor.

### P2 — explicitly deferred

- Multi-engine federation (multiple Unown installs in one console).
- Any server-side component beyond the engine itself (no accounts, no cloud,
  no telemetry — the house law).
- Mobile/WebKit/Firefox scope (Chromium-desktop is the honest P0 scope, the
  same ruling as Chaconne's).

## Non-goals (the negative space)

- No editing of the engine's core state beyond the routines API surface —
  the app NEVER opens the engine's SQLite, never writes `.unown/memory/**`
  outside the Manual-notes lane, never spawns agents itself (the engine
  owns execution).
- No in-app skill promotion automation — staging → promotion stays a human
  action (the 2026-10-22 hardening law); the app surfaces the queue and the
  command, nothing more.
- No live-network e2e claims beyond the localhost engine fixture.
- No accounts, no telemetry, no cloud, no third-party runtime deps in the
  UI (zero-dep law; the adapter's `fetch` is the single runner-side
  exception, operator-approved per the Chaconne precedent).

## Hardening-first mapping (the directive's lanes → Fugue's coverage)

| Directive lane | Fugue's coverage | Law |
|---|---|---|
| Keyboard-only operation | the palette + dialog-contract editor + list navigation, all keyboard-reachable | K-1 |
| Tab order / focus | compose dialog focus trap; Esc returns focus to the anchor | A-1 |
| Modals | the compose/edit dialogs with the focus-trap contract | M-1 |
| Command palette | Ctrl+K, 11+ commands | K-1 |
| Scrolling / lists | the runs list with grouped history (Chaconne's grouped-run pattern) | R-1 |
| Empty states | no jobs / no runs / engine down / no dreams yet — four honest panels | O-1 |
| Loading states | adapter fetches with skeletons + timeouts, never blank | L-1 |
| Crash recovery | corrupt-store recovery panel (never silent wipe) + engine-down queue | C-1 |
| Resize | responsive down to 1024×640, the e2e window | Z-1 |
| Cross-session consistency | storage schema `"fugue.v1"` + import refusal on foreign schemas | X-1 |

## Edge cases the PRD names up front (each becomes a unit pin or an e2e case)

1. Engine token missing/rotated at boot → honest "engine locked" panel, retry affordance, never a blank.
2. Engine DOWN at adapter call → typed EngineDown error, queued-action affordance (the outbox pattern, surfaced), never silent success.
3. A routine created in the PWA but engine restarted before first run → re-sync reconciles by routine id, never duplicates.
4. Budget governor throttled (engine budget 0/60) → the spend meter shows the throttle state, runs marked `budget:throttled` honestly.
5. A run that FAILS mid-tool-stream → the run detail shows the error field verbatim; no partial run is rendered as success.
6. Dream gated + rolled back → the dreams journal shows `gated` status with the rollback pointer — the canary gate is a FEATURE to surface, not hide.
7. Corrupt localStorage at boot → recovery panel with export-the-wreckage, never a silent wipe.
8. Foreign/future schema at import → dry-run refusal report (the Chaconne law), never partial import.
9. Job edited between schedule-due and run-start → the engine's own semantics govern; the UI never predicts a run that the history disproves.
10. Timezone/DST edges in `--every "2d at 09:00"` schedules → the pure projection mirrors the engine's documented semantics, pinned by unit tests.
11. The Manual-notes editor hitting the 4k cap → the over-cap marker surfaces (the memory law), never a silent truncate.
12. Concurrent routine run + interactive session → the run's tokens/turns reflect the engine's accounting only; the UI never invents numbers.

## Success criteria

**The battery** (every lane green at close): Lane A (`cd apps/fugue && bun
test`) · Lane B (`bun test apps/fugue` from root) · root battery growth
receipted per ticket · the fixture-server contract lane · the live-engine
e2e lane ×3 consecutive (≥1 cold boot) · the a11y lane (axe wcag2a/2aa,
light+dark) · check:docs / check:blog / check:claims riding the close ·
the standing battery re-run at teardown (holdout discipline).

**The engagement's bars**: turns-to-done trending down across F-tickets ·
every harvested defect converted to a pinned regression (§5) · the learning
mechanisms receipted §6c (memory create→reuse→persist, harness, minting —
the W2 exercise, consolidation, skill generation/promotion attempt with
honest nulls if null) · at least one paired A/B augmentation gate executed
(H-17 or H-20) · §0.9 predictions reconciled with no retroactive
story-telling · the evidence packet complete.

**Honest scope**: Chromium-desktop-only P0; the engine REST surface pinned
2026-11-07 (drift = a ticket, never silent); automation execution is the
ENGINE's, the console's is authorship/observation/curation only.

## Related pages

- [The Sonata round log](sonata-round-session.md) · [the selection receipt](../benchmarks/sonata-round/README.md)
- [The Chaconne PRD](chaconne-prd.md) — the house-pattern parent
- [docs/routines.md](routines.md) · [docs/memory.md](memory.md) ·
  [docs/standing-orders.md](standing-orders.md) — the engine surfaces the
  console consumes
