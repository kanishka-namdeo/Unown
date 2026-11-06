# Bolero — Architecture Plan (S-0)

> Read-only plan. No code exists under `apps/bolero/` yet; this document is
> the only write. S-1 owns the first code write. Basis: `docs/bolero-prd.md`
> (APPROVED 2026-11-07), the frozen Chaconne recipe domain at
> `apps/chaconne/src/domain/` (the grammar reference), the house plan pattern
> (`apps/chaconne/PLAN.md`), and the root `package.json` script lanes.
> Ticket queue: S-1..S-10 from the PRD's P0 table.

## 1. Architecture overview

Four components, each with a hard boundary — the same layering as the
Chaconne house pattern (domain under, product on top), plus the two host
edge that makes Bolero a watchdog instead of a PWA:

```
apps/bolero/
  src/domain/     FROZEN grammar: watch-spec + run-report types, the
                  round-trip pins, invariants, ids, canonical JSON (io)
  src/runner/     recipe executor: Chaconne-recipe semantics over a real
                  Chromium page (CDP lane); emits run reports; can run
                  scheduled watches; the server host, bounded real-clock
                  scheduler
  src/server/     bun server + bun:sqlite: watch registry, report ingest
                  API (STRICT grammar validation), health endpoint,
                  static face that serves the dashboard build
  src/dashboard/  status board: vanilla TS, zero deps, hand-rolled PWA
                  (the house pattern) — watch list, run history, latest
                  screenshot, failure detail
  fixtures/       deterministic local pages the runner + e2e verify against
  scripts/        serve.mjs (the house pattern), verify-*.ts gates
```

**Boundaries** (the import contract, pinned by `boundary.test.ts` as in
Chaconne/Ostinato):

- `src/domain/` — pure, DOM-free, Node-free, server-free. No fs, no
  `Date.now()`, no HTTP. Both the runner and the server import from
  here; the dashboard imports ONLY the type/serialization halves of
  the report grammar (via the emitted build), never the server. This
  directory is the single declaration site for the grammar (§2).
- `src/runner/` — Node-only host. Imports `playwright` from the repo
  root's `node_modules` (the Chaconne §4 walk-up ruling, operator-
  approved for the sibling app and extended here by the same reasoning:
  one chromium build for the runner and the e2e battery — they can
  never drift). Never imported by `src/` (the browser/server closure).
- `src/server/` — the storage + ingest host. Owns the SQLite file
  (`data/bolero.db`, gitignored), the watch registry, and the REST API.
  The runner delivers reports to it; it never drives the browser itself
  (in one-command local boot the server spawns the scheduler, which is
  the runner — see §5).
- `src/dashboard/` — static, zero-dep, installable PWA. Talks to the
  server over fetch; on deploy it is a static build under
  `public/bolero/` that polls the health endpoint of wherever the
  server runs (the deploy lane, S-6).

**Data flow (the one-directional ring):**

1. **Register.** The dashboard (or the CLI) creates a *watch* — a named
   Chaconne-domain recipe (the frozen 9-step grammar) + target URL +
   schedule — POSTed to the server; the server validates it against
   `src/domain/` invariants and stores it in SQLite (canonical JSON in
   a `TEXT` column, byte-stable).
2. **Schedule.** The runner's scheduler (bounded real-clock polls, the
   V-18 mechanism the operator hands down: no fake clocks in the live
   lane, one poll loop, a small bounded pool given the metered ~20 RPM
   upstream) sees due watches, fetches the watch-spec from the server,
   and executes the recipe against the target.
3. **Report.** The runner emits a *run-report* (§2 grammar: status
   taxonomy, committed prefix, extracted values, content-addressed
   artifact refs incl. screenshot sha256, timings) and POSTs it to the
   server's ingest endpoint.
4. **Ingest.** The server STRICT-validates the report against the same
   frozen grammar (any drift → 422 with a dotted-name path, the V-41
   law), stores it (large screenshot bytes go to content-addressed
   files under `data/artifacts/`, the row keeps only the ref),
   computes watch-level alert state (N consecutive failures), and is
   done — storage only, no browser.
5. **Observe.** The dashboard polls `GET /api/watches` / `GET
   /api/watches/:id` / `GET /health` and renders latest status, history
   and the latest screenshot. Alert lane: a local notification when
   the alert state flips (P0 scope; delivery beyond a local lane is
   P1).

The round-trip law (V-41 encoded): runner and server are two hosts
sharing one grammar. `src/domain/` is the only place the shapes exist;
both import it; §2's round-trip pin makes a drift on EITHER side throw
RED at test time, never surface as a 422 in production.

## 2. The FROZEN artifact grammar draft

Declared once, in `src/domain/`. Both hosts import it; neither re-declares
any shape. The shapes below re-express the Chaconne frozen domain
(`apps/chaconne/src/domain/types.ts`'s `Recipe`/`Step`/`RunRecord`) as
Bolero's two transport artifacts — the **watch-spec** (what a watch says) and
the **run-report** (what a run says). Plain JSON only: no class instances, no
`Date` objects, timestamps are ISO-8601 strings, ids are deterministic
integers (`ids.ts`, max+1, never random).

### The watch-spec (`WatchSpec`)

```ts
export type Schedule = {
  kind: "one-shot" | "interval";
  /** interval only: the period in ms (bounded below by the pool's rate). */
  everyMs?: number;
  /** ISO-8601; one-shot: the due instant; interval: next due. */
  nextDueIso?: string;
  /** ISO-8601; the last fire. */
  lastFiredIso?: string;
};

export type WatchSpec = {
  /** the top-level gate value (the schema law, §2 round-trip). */
  schema: "bolero.v1";
  watch: {
    /** deterministic integer id. */
    id: number;
    /** unique per registry (server invariant — duplicate names are
     *  rejected at ingest, edge case E-04). */
    name: string;
    /** the frozen 9-kind recipe, verbatim Chaconne `Recipe.steps`. */
    steps: Step[];        // { id, kind, selector, value?, timeoutMs?, intoFrame? }
    /** where the recipe's goto targets (real-site: public https, no credentials). */
    baseUrl: string;
    /** the recurrence (Chaconne `Schedule` semantics, skip-and-record misfire). */
    schedule?: Schedule;
    /** alert lane: fail N consecutive times before the watch alerts. */
    alertAfter?: number;  // default 1
    /** the recipe version snapshot the runner executes (edge E-09 kin). */
    recipeVersion?: number;
  };
};
```

### The run-report (`RunReport`) — the cross-host artifact

```ts
export type RunReport = {
  /** the only accepted schema value; anything else → server 422. */
  schema: "bolero.v1";
  report: {
    /** the watch this run belongs to (must resolve in the registry —
     *  edge E-09: an invalid recipe reference is a 422, never a 500). */
    watchId: number;
    /** the recipe version the run SNAPPED at start (edge E-09 kin). */
    recipeVersion: number;
    /** the Chaconne 5-entry taxonomy, extended with two host-lane
     *  statuses (runner unreachable / screenshot failed): */
    status: "ok" | "step-failed" | "selector-not-found" | "timeout"
          | "invalid-recipe" | "runner-offline" | "screenshot-failed";
    startedAt: string;       // ISO-8601
    finishedAt?: string;     // ISO-8601; absent when the run was killed
    /** how many steps fully completed (the committed-prefix law, crash honesty). */
    committedPrefix: number;
    /** which step index failed, when status is not "ok". */
    failedStepIdx?: number;
    /** extracted values keyed by step index (the `extract` kind). */
    extracted?: Record<string, string>;
    /** content-addressed artifact refs (the name IS the sha256).
     *  Grammar: `<watchId>_r<runSeq>_sha256:<64hex>.<ext>`. */
    artifacts: { name: string; sha256: string; ext: "png" | "json" | "log" }[];
    /** per-run honest log, bounded (the server caps total ingest bytes,
     *  edge E-07 oversized report). */
    log?: string;
  };
};
```

### The cross-host round-trip pin law (in prose — the V-41 law)

1. **Declared once.** The `WatchSpec`/`RunReport`/`Schedule`/`Step`
   shapes and the closed sets (9 `StepKind`s, the 7-entry `RunStatus`
   taxonomy, `SCHEMA_VERSION = "bolero.v1"`) live in `src/domain/types.ts`
   and the closed-set constants in `src/domain/sets.ts`. The runner imports
   them to CONSTRUCT reports; the server imports the SAME module to
   VALIDATE them. No host ever declares its own copy of a grammar field.
2. **Round-trip pin test.** `src/domain/roundtrip.test.ts` (S-1) drives the
   pin: build a `RunReport` from the runner's path, serialize it through
   the canonical JSON (`io.ts`, sorted object keys, compact separators —
   byte-stable across hosts), re-parse it, and re-validate it on the
   server's path. ANY drift between the two sides throws at the exact
   **dotted path** (e.g. `report.status` not in the closed set;
   `report.artifacts[2].sha256` missing) — dotted names THROW, the
   test goes RED by construction. This is the A2H-13/A2H-14 pattern:
   the drift is a test failure at authoring time, not a 422 at runtime.
3. **STRICT server validation.** The server's ingest (`src/server/ingest.ts`,
   S-3) runs the domain's `assertReport` on every body; on breach it
   answers `422 { reason: "<dotted path>: <detail>" }` and stores
   NOTHING. The round-trip pin and the ingest validator are the same
   code (`assertReport` in `src/domain/invariants.ts`), so a server
   that rejects a well-formed report IS a pin failure, not a product bug.
4. **Schema gate.** A report carrying any `schema` other than
   `bolero.v1` is refused with the dry-run report (the Chaconne `io.ts`
   law: what WOULD import and why — never a partial ingest).

`src/domain/` also carries: `ids.ts` (deterministic max+1 for watch/run
ids), `invariants.ts` (`assertWatch`, `assertReport` — the closed-set +
shape checks both hosts share), `io.ts` (the canonical JSON port,
byte-stable round-trips + future-schema dry-run rejection), and
`boundary.test.ts` (the import-graph pin: `src/` and the dashboard
import only `./`/`../`/`bun:test`; `runner/` and `server/` may import
the domain but never each other's internals).

## 3. The ticket map

Build order is strict: S-1 → S-2 → S-3 → S-4 → S-5 → S-6 → S-7 → S-8 →
S-9 → S-10 (domain before runner before server before dashboard before
batteries; batteries land on a green tree; S-10 closes last). Every
acceptance item NAMES its verification script; the operator gate re-runs
the whole lane set (V-31) on the final tree.

### S-1 — Domain core: the FROZEN grammar + round-trip pins
- [ ] `src/domain/` lands: `types.ts` (`WatchSpec`, `RunReport`, `Step`,
      `Schedule`, closed sets), `sets.ts`, `ids.ts`, `invariants.ts`
      (`assertWatch`/`assertReport`), `io.ts` (canonical JSON + dry-run
      schema gate), `boundary.test.ts`. **Verify: `bun run bolero:test`
      green (Lane A, DOM-free), incl. the closed-set and dotted-path throw tests.**
- [ ] `roundtrip.test.ts` RED-by-construction: hand-edited drift (a
      dotted field renamed/missing on one side) fails the pin with the
      dotted path in the message. **Verify: `bun run bolero:test` — pin
      throws on the planted drift, passes on the clean grammar.**
- [ ] Root `package.json` wires `"bolero:test": "cd apps/bolero && bun test"`
      (+ `bolero:dev`/`bolero:server`/`bolero:e2e` shapes pre-approved
      here, landed in S-3/S-6 per the Coda/Chaconne one-word-token
      precedent). **Verify: `bun run bolero:test` resolves from the repo root.**

### S-2 — Runner v1: recipe execution + report emission, fixture-first
- [ ] `src/runner/` executes the frozen 9-step grammar against a local
      fixture page (`fixtures/`), with per-step/per-run caps, the
      committed-prefix law, and the 7-entry status taxonomy; emits a
      `RunReport` that passes `assertReport`. **Verify: `bun run
      bolero:test` — runner unit lane (fake-adapter deterministic) green
      for every step kind + every taxonomy entry.**
- [ ] ONE real-browser smoke against `fixtures/` via the root
      `playwright` (walk-up ruling, the Chaconne §4 precedent) asserts
      a well-formed report + content-addressed screenshot sha256.
      **Verify: `bun run bolero:e2e` runner lane green on the fixture page.**
- [ ] Real-site canary lane exists and is flagged, never the verifier:
      a fixed public-page set, rate-limited, `--canary`-gated.
      **Verify: `bun run bolero:e2e` — canary lane self-skips without the
      marker; the deterministic verifier is the fixture lane only (the §6 law).**

### S-3 — Server: bun + SQLite, watch registry, STRICT ingest, health
- [ ] `src/server/` boots on port 4050 (`BOLERO_PORT`, override; the next
      free port after Chaconne's 4014 per the house sequence); `GET
      /health` returns `{phase, pid}`-style shape (§5). **Verify: `bun run
      bolero:server` + a curl/`bun test` health assertion.**
- [ ] Ingest API validates every `RunReport` through the shared
      `assertReport`; a breach is a 422 with the dotted path and stores
      nothing; valid reports persist watch/report rows + content-
      addressed artifact files. **Verify: `bun run bolero:test` — the
      422/valid-split test + the oversized-report reject (edge E-07).**
- [ ] Watch registry: CRUD + duplicate-name reject (edge E-04) + invalid
      recipe reference reject (edge E-09). **Verify: `bun run bolero:test`**

### S-4 — Scheduler: interval execution of due watches
- [ ] Bounded real-clock poll loop (the operator-handed V-18 mechanism;
      no fake clocks in the live lane) fires due interval/one-shot
      schedules with the skip-and-record misfire policy (a gap ≥ period →
      skipped+recorded, never a silent double-run, never a catch-up
      storm). **Verify: `bun run bolero:test` — misfire + dedup pins via
      the injected-clock domain scheduler; the live poll is bounded.**
- [ ] Concurrent-runs-of-one-watch guard: a second due fire while the
      first is in flight is deferred + logged, never two overlapping
      runs of one watch (edge E-08). **Verify: `bun run bolero:test`**

### S-5 — Dashboard: status board PWA
- [ ] Vanilla-TS zero-dep PWA: watch list, run history, latest
      screenshot, failure detail; keyboard-first (the K-1 law); honest
      empty/loading/offline states. **Verify: `bun run bolero:test`
      (DOM-guarded UI pins, Lane B) + `bun run bolero:e2e` flow lane.**
- [ ] PWA shell: hand-rolled `sw.js` precache + offline fallback +
      static derivation proof. **Verify: `bun run bolero:verify-precache`
      (the house pattern) prints `<N> URLs, 0 missing — PASS`.**

### S-6 — Deploy + supervision
- [ ] Server runs under the operator daemonizer (`.a1/scripts/dispatch-bg.py`)
      with a health check; the dashboard static build lands under
      `public/bolero/` (live on the Vercel landing on `main` merge, the
      repo's standing deployment contract). **Verify: the CI lane (S-8's
      `ci.yml` bolero job) runs the health gate; `public/bolero/` static
      build asserted by the verify gate.**
- [ ] One-command local boot (`bun run bolero:dev` or the server's
      `serve` script) brings up server + dashboard + scheduler together,
      trusting `/health`. **Verify: `bun run bolero:server` boots, `GET
      /health` 200, and the boot is supervised (crash → restart, §5).**

### S-7 — Resilience battery
- [ ] Corrupt report payload, offline runner, server restart mid-run,
      kill-and-resume lanes all land as deterministic tests (the O-1/C-7
      pattern). **Verify: `bun run bolero:e2e` resilience spec + `bun run
      bolero:test` — each of the 4 lanes asserts its honest recovery
      (quarantine / skip-and-record / committed prefix), no silent wipe.**
- [ ] Root `package.json` wires the full script set used above
      (`bolero:dev`/`bolero:server`/`bolero:verify-precache`). **Verify:
      `bun run bolero:…` every entry resolves from the repo root.**

### S-8 — e2e + a11y battery
- [ ] `playwright.bolero.config.ts` (repo root) arms `BOLERO_E2E`,
      self-skip-guarded; keyboard-only flow spec + axe `wcag2a/2aa`
      both schemes + offline boot + crash-resume spec. **Verify: `bun run
      bolero:e2e` green across all four specs.**
- [ ] CI `bolero` job in `.github/workflows/ci.yml`: frozen lockfile +
      zero-dep invariant + both unit lanes + the precache proof + the
      isolated e2e battery + the fixture-honesty comment. **Verify: `bun run
      check:docs` + the CI job green (the S-8 receipt names the lane).**

### S-9 — Docs + landing + README + blog
- [ ] `docs/bolero.md` (the app doc, Chaconne/Ostinato shape), the
      landing demo card, the round-table row, the blog post with
      captured stills (`public/landing/bolero/` + `PROVENANCE.md`).
      **Verify: `bun run check:docs` green; landing/blog gates
      (`check:changelog`, `check:blog`, `check:claims`) green.**
- [ ] README section + honest-scope statement (Chromium-desktop-only;
      real-site canaries are canaries, never the verifier). **Verify:
      `bun run check:docs` + a grep of the scope line.**

### S-10 — Round closeout
- [ ] §6c learning-mechanism receipts, §8 evidence pack, `RESULTS.md`
      under the round's benchmarks dir. **Verify: the round-close
      evidence-pack gate (`bun run check:benchmarks` where the receipt
      feeds a landing figure; the closeout receipt is the §8 pack).**
- [ ] The pre-registered failure classes (§6 of the PRD) reconciled
      against what actually happened — no retroactive story-telling.
      **Verify: the RESULTS.md reconciliation table + the round log.

## 4. The edge-case register

Each edge case is pinned to the ticket that ships its verifier, so none
are discovered late and none are orphaned. The 12 the brief names are
E-01..E-12; the register extends to E-14 (two more the PRD implies).
Every row names its ticket id — re-check that no row points at a ticket
that doesn't build the verifier.

| # | Edge case | Ticket | Verifier |
|---|---|---|---|
| E-01 | **Corrupt report payload** — undecodable/invalid-grammar body at ingest → 422 + the quarantine/reject path stores nothing, never a partial row | S-3 (reject split) + S-7 (quarantine lane) | `bun run bolero:test` (ingest reject) ; `bun run bolero:e2e` resilience spec |
| E-02 | **Runner offline** — the scheduler is up but no runner can reach a watch's target → the watch's latest status reflects `runner-offline`, not a silent stale-ok; no unbounded retries | S-4 (offline runner detection) | `bun run bolero:test` — the runner-offline status pin |
| E-03 | **Server restart mid-run** — the server dies while a run is in flight; on restart the committed-prefix law means the half-run record is the honest prefix, and no double-write of a report row | S-7 (kill/resume) | `bun run bolero:e2e` — kill-and-resume spec asserts the committed prefix |
| E-04 | **Duplicate watch names** — creating a second watch with an existing name is rejected at ingest (name is unique per registry) | S-3 (watch registry) | `bun run bolero:test` — duplicate-name reject |
| E-05 | **Schedule drift** — a machine-sleep gap ≥ one period on an interval watch → skip-and-record, never a silent double-run and never a catch-up storm | S-4 (misfire policy) | `bun run bolero:test` — the injected-clock misfire + dedup pins |
| E-06 | **Screenshot failure** — the `screenshot` step throws (element detached / page gone) → status `screenshot-failed`, the run still records its committed prefix, never a hung runner | S-2 (taxonomy extension) + S-7 | `bun run bolero:test` — the screenshot-failed pin on the fixture |
| E-07 | **Oversized report** — a report whose `log` or artifact bytes exceed the server cap → rejected (413-class), never truncated-and-stored | S-3 (ingest cap) | `bun run bolero:test` — the oversized-report reject |
| E-08 | **Concurrent runs of one watch** — a second due fire overlaps the in-flight run → deferred + logged, never two overlapping executions of the same watch | S-4 (run guard) | `bun run bolero:test` — the concurrency-defer pin |
| E-09 | **Invalid recipe reference** — a report's `watchId`/`recipeVersion` doesn't resolve in the registry → 422 (a contract error, not a 500) | S-3 (ingest validation) | `bun run bolero:test` — the invalid-reference reject |
| E-10 | **Fixture-vs-real-site divergence** — a recipe green on the fixture but red on the real canary is an honest DIVERGENCE result, not a silent pass; the canary lane records both and the verifier stays the fixture | S-2 (canary split) + S-8 | `bun run bolero:e2e` — the divergence lane records both verdicts; the fixture lane is the gate |
| E-11 | **Health endpoint under load** — `GET /health` stays fast and truthful (phase + pid) even while ingest is busy; it is the cheap lifecycle probe the supervisor trusts, never blocks on in-flight jobs | S-3 (health) + S-6 (supervision) | `bun run bolero:test` — health-under-load pin; `bun run bolero:server` observed under a queued ingest |
| E-12 | **Kill-and-resume** — SIGKILL of a running run, then boot → the store recovers to the committed prefix; a re-run is a FRESH run id, no step re-fire (the RECORD-AT-END semantics, the O-1/R-1 law) | S-7 (kill-and-resume) | `bun run bolero:e2e` — kill-and-resume spec |
| E-13 | **Foreign/future schema report** — a `schema` other than `bolero.v1` → refused with the dry-run report, store byte-unchanged (the Chaconne `io.ts` law) | S-1 (io gate) + S-3 (ingest) | `bun run bolero:test` — the dry-run rejection pin |
| E-14 | **Orphaned artifact file** — an ingest crash between writing the artifact file and the DB commit → boot recovery discards the orphaned file (the content-addressed name IS the hash, so no clobber) | S-7 (recovery) | `bun run bolero:test` — the orphaned-artifact discard |

**Orphan check (the closeout gate):** the table's ticket column must
cover every E-row; re-run `bun run bolero:test` + `bun run bolero:e2e`
on the final tree (S-7/S-8) so each verifier actually exists, not just
points at a ticket that hasn't landed it yet.

## 5. The ops contract

**Server port.** The bolero server boots on **port 4050**, overridable
via `BOLERO_PORT`. Port choice follows the house sequence (Coda 4012,
Ostinato 4013, Chaconne 4014); 4050 is bolero's reserved slot. A
refused-port / 401-class conflict is reported, never spawned over
(the taxonomy gate, the engine's own rule: agent-side auto-start is
refuse-only).

**Health endpoint shape.** `GET /health` (cheap lifecycle probe, the
engine's `phase` model re-expressed) returns:

```jsonc
{
  "phase": "warming" | "ready" | "draining",  // the lifecycle state
  "pid": 1234,                                 // the serving process
  "version": "bolero.v1",                      // the grammar gate value
  "queue": 0                                    // in-flight ingest jobs (E-11 load signal)
}
```

- `warming` — booting, store not yet committed; **refuse ingest jobs
  (409-class draining conflict), serve /health truthfully.**
- `ready` — normal operation; ingest + scheduler live.
- `draining` — graceful shutdown in flight; new ingests refused,
  in-flight bounded by the drain budget (the engine's `UNOWN_ENGINE_`+
  `DRAIN_BUDGET_MS` pattern), then the store closes. `GET /health`
  under load (E-11) still answers fast — it reads the lifecycle state,
  never blocks on a queued ingest job.

**Supervision assumption.** Bolero does NOT supervise itself. A
supervisor process owns the restart: the operator daemonizer (see
below) is the single owner. The server's own job is to be
supervision-FRIENDLY: it exposes `/health` so the supervisor's health
check is a one-line poll; it crashes loudly (non-zero exit on an
unrecoverable store state, never a silent hang) so the supervisor's
restart is a clear trigger; and it drains cleanly on SIGTERM (the
`draining` phase) so a supervised restart doesn't drop in-flight
ingests.

**Operator daemonizer integration (`.a1/scripts/dispatch-bg.py`).**
- The daemonizer boots the server as a supervised background process
  (`bun apps/bolero/src/server/index.ts`, the S-6 deploy lane).
- It polls `GET /health`; a `503`/connection-refused or a phase stuck
  at `warming` past a bounded grace is the restart trigger — the
  supervisor kills + respawns, and the boot idempotence (the store's
  temp+commit-swap recover) means a respawn never wedges on an orphan.
- Under the daemonizer, the "server restart mid-run" lane (E-03) is a
  SUPERVISOR event the operator can observe, not an unlogged crash:
  the committed-prefix law means a half-run never corrupts the store,
  and the scheduler's skip-and-record means a restarted server doesn't
  double-fire a schedule.
- One-command local boot (`bun run bolero:dev`, S-6) runs the same
  supervised loop WITHOUT the daemonizer — the supervision assumption
  is identical, the owner is the shell instead of dispatch-bg.py. Both
  paths trust `/health` as their single contract.

## 6. The test strategy

**The fixture-first law (the PRD's W5 rule, verbatim).** Every runner
feature lands against a LOCAL, deterministic fixture page committed
under `apps/bolero/fixtures/` — no live-network test ever runs in CI.
Real public-site runs are **canaries, never the verifier**: the canary
lane (`--canary`, S-2) hits a small fixed set of public pages,
rate-limited and cached, and it records a divergence verdict (E-10) but
the GREEN/RED gate is always the fixture lane. This is the exact
Chaconne "no live-network test ever runs in CI" law, extended with
the canary split.

**Named fixture set (deterministic, offline-verifiable):**

| Fixture | Purpose | Drives |
|---|---|---|
| `form-iframe.html` | form with an iframe-hosted field | E-06 kin (value-landed read-back) |
| `tall.html` | content > viewport, target near the bottom | full-page screenshot (E-06) |
| `slow.html` | timer-driven late content | timeout mid-run → committed prefix (E-03 kin) |
| `dynamic.html` | timer-driven DOM change | assert-text/element timing determinism |
| `blank.html` | empty document control | selector-not-found, NOT a hang |

Fixtures are static, zero-network (inline timers only, no CDNs), served
by `serve.mjs` / the e2e config's webServer at
`http://127.0.0.1:4050/fixtures/…` so the runner's real adapter and
the e2e battery address the SAME deterministic pages.

**The e2e config (`playwright.bolero.config.ts`, repo root, S-8).**
Shaped on the Chaconne config verbatim:
- `testDir: "e2e"`, `testMatch: /bolero-.*\.spec\.ts/` — selects ONLY
  the bolero specs.
- module-scope `process.env.BOLERO_E2E = "1"` arms the marker; the root
  landing lane never does, so bolero specs self-skip under every other
  lane (the `CODA_E2E`/`CHACONNE_E2E` self-skip-guard precedent).
- `outputDir: "download/test-results-bolero"` (gitignored scratch).
- `baseURL: "http://127.0.0.1:4050"`; Chromium-desktop-only project
  (`devices["Desktop Chrome"]`) — the PRD's platform scope (WebKit/
  Firefox/mobile stay `[U]`).
- webServer entries: the dashboard static serve AND the fixtures serve
  (the runner's fixture-serve is the same server), `reuseExistingServer:
  !process.env.CI`, `timeout: 60_000` (Chaconne's values).

**The unit lane (two-lane purity, the house pattern).** `bun run
bolero:test` = `cd apps/bolero && bun test` (Lane A, DOM-free, the
enforcement lane — no `bunfig.toml` preload, so `src/domain/`'s
DOM-free boundary is enforced against a genuinely DOM-free runtime, the
Chaconne precedent). From the repo root, `bun test apps/bolero` runs
the same files under the root `bunfig.toml`'s happy-dom preload
(Lane B, compatibility — the DOM-guarded dashboard UI pins run here).
Runner unit tests are DOM-free + Node-fs and run in both lanes.

**The a11y lane (S-8, the Ostinato precedent ported).**
- **Keyboard-only flow (K-1):** register a watch → see its status →
  open the latest screenshot/failure detail, ZERO pointer events, an
  e2e spec pins it (`e2e/bolero-flow.spec.ts`).
- **axe WCAG 2.2 A/AA both schemes** (light + dark) in
  `e2e/bolero-a11y.spec.ts` via `@axe-core/playwright` (root dep),
  + the tab-order pin + Esc focus-return on every overlay (the house
  dialog contract: role=dialog, aria-modal, attach-before-focus).
- **Offline boot (O-1)** + **crash-resume (R-1 / E-12)** in
  `e2e/bolero-resilience.spec.ts` — the offline lane pins the PWA boot
  from cache with data intact; the crash-resume lane pins the
  kill-and-resume committed-prefix law.

**The gates (named, all must be green on the final tree — the V-31
operator gate re-runs every lane):**
- `bun run bolero:test` — Lane A unit (domain + runner + server +
  scheduler + the 14 edge pins, minus the browser-gated ones).
- `bun run bolero:e2e` — the isolated Chromium battery (flow / a11y /
  resilience + the runner's real-browser fixture lane + the flagged
  canary lane, self-skipped without its marker).
- `bun run bolero:verify-precache` — the static precache derivation
  proof (`<N> URLs, 0 missing — PASS`), the Ostinato O-5 pattern.
- The CI `bolero` job (S-8): frozen lockfile + zero-dep invariant +
  both unit lanes + the precache proof + the isolated e2e battery +
  the fixture-honesty comment — Chromium-desktop-only, stated plainly.
