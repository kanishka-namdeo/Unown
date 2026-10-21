# Detached Self-Learning Engine — Architecture & Design Record

> **Verdict**: the self-learning engine should be a fully independent daemon process that is installed together with the terminal agent but never depends on it being alive — and the terminal agent should never depend on the engine being alive. The split is sound, cheap on resources when idle, and the failure modes are all addressable with known patterns (gate the event feedback loop, watch every job, budget the LLM spend, supervise with ping-and-spawn). What makes it sound is that the engine already is a separate process with an HTTP surface; what makes it necessary is the measured coupling (the terminal CLI opens the engine's SQLite database — 3 fds — on every boot) and the observed failure (a runaway dream-check loop burned ~630k prompt tokens in 50 minutes).

- **Status**: accepted, implementation in progress
- **Method**: architecture walk of the live system (2026-10-20), empirical failure reproduction, ~90-source research review ([detached-engine-research.md](detached-engine-research.md)), before/after benchmarks (`scripts-dev/arch-bench.sh`, receipts in `benchmarks/detached-engine/`)
- **Sections**: [Current state](#current-state) · [Target architecture](#target-architecture) · [Responsibility split](#responsibility-split) · [Failure modes & mitigations](#failure-modes--mitigations) · [Resource budget](#resource-budget) · [Implementation plan](#implementation-plan) · [Benchmarks](#benchmarks)
- **Related pages**: [memory.md](memory.md) · [configuration.md](configuration.md) · [resilience.md](resilience.md) · [testing-strategy.md](testing-strategy.md) · [install.md](install.md) · [updating.md](updating.md)

## Current state

Four processes make up the system today [V — `mini-services/AGENTS.md`, live walk 2026-10-20]:

| Process | Entry | Port | Started by |
|---|---|---|---|
| Terminal agent (`unown`) | `bin/unown` → `boot.ts` → `cli.ts` | — | the user, per session |
| Engine (agent-service) | `mini-services/agent-service/index.ts` → `server.ts` | 3030 | `bun run agent:start` (manual) |
| LLM bridge | `mini-services/llm-bridge/index.ts` | 3031 | `bun run agent:start` (manual) |
| Dashboard | Next.js `src/` | 3000 | `bun run agent:start` (manual) |

**Already detached** [V]: the engine is a separate OS process with a REST+SSE API; note transport is async and durable (HTTP POST with a filesystem outbox fallback, `term.ts:395`); memory pick-up is file-based (the agent re-reads `.unown/memory/project.md` on every `/new`, `/resume`, `/fork`, `cli.ts:638`); the agent degrades to warn-level when the engine is down (`doctor`, `cli.ts:1196`).

**Still coupled** [V — import chains walked 2026-10-20]:

1. **One shared library.** Both processes import `pi-repo/packages/self-learning/src/` — the terminal pulls the engine half in transitively: `termhooks.ts:40` → `hooks.ts:49` → `store.ts`, and `tools.ts:108` → `llm.ts:8` → `store.ts`.
2. **The terminal agent opens the engine's database.** `store.ts:233` runs `new Store()` at module scope, so every `unown` boot opens `db/selflearning.db` (WAL) — measured: **3 fds** (`/proc/<pid>/fd`, before-benchmark). The constructor also *writes*: `PRAGMA journal_mode = WAL`, the schema DDL exec, and the `memory_versions` dedup `DELETE` (`store.ts:211`) run on every open. On Windows, cross-process `BEGIN IMMEDIATE` exclusion is broken in Bun (oven-sh/bun#40659, [C]) — a Windows terminal session contending with a writing engine is a real hazard, not a theoretical one.
3. **No supervision.** Nothing restarts a crashed engine; nothing starts it at all unless the user runs `agent:start`. Crash recovery exists only at next boot (`recoverOrphans`, `server.ts:431`).
4. **No job-level watchdog.** The router serializes all jobs behind one busy mutex; a job that never returns wedges the engine forever [V — reproduced: a regression run sat `running` >25 min holding the mutex].
5. **The event job feedback loop.** `dream-check` (event: `run:finished`) calls `runDream()` ungated (`router.ts:266`); the dream's own canary run finishes → emits `run:finished` → queues another `dream-check` → forever [V — reproduced 2026-10-20: 9 back-to-back dreams, ~630k prompt tokens in 50 min before manual disable].

## Target architecture

```
┌──────────────────────────┐         ┌──────────────────────────────────┐
│  TERMINAL AGENT (short-  │         │  SELF-LEARNING ENGINE (daemon)   │
│  lived, per session)     │         │  auto mode — runs alone          │
│                          │         │                                  │
│  • coding sessions (TUI) │  notes  │  Router jobs (watched, budgeted):│
│  • CRUD: notes,          │ ──────► │   harness-cycle, auto-dream,     │
│    automations, memory   │  HTTP   │   note-sync, task-mint,          │
│    rollback requests     │  +fs    │   sandbox-gc, dream-check (gated)│
│  • memory injection      │  outbox │  Automations scheduler           │
│    (file read, no DB)    │         │  Headless agent runs (sandboxes) │
│  • never opens engine DB │ ◄────── │  Own LLM calls via bridge        │
└───────────┬──────────────┘  memory │  Single writer: the only process │
            │                 files  │  that opens db/selflearning.db   │
            ▼                 +skills│  Supervision: ping → spawn →     │
      user's project                 │  poll health; crash-restart with │
      .unown/memory/project.md       │  backoff; SIGTERM = drain+exit   │
                                    └──────────┬───────────────────────┘
                                               │ all LLM traffic
                                               ▼
                                    ┌──────────────────────────────────┐
                                    │  LLM BRIDGE (:3031) — unchanged  │
                                    └──────────────────────────────────┘
```

Design rules:

1. **One binary, two entry points.** The agent and the engine ship in the same install (same repo, same release artifacts); `unown` is the CLI, the engine is `unown engine` (plus the existing `agent:start` path). Versions can never drift apart.
2. **The engine owns the database — exclusively.** The engine becomes the single writer *and* single opener of `db/selflearning.db` (single-tenant by design; scale-out stays "more engine instances against separate data dirs", per `mini-services/AGENTS.md`). The terminal agent's import graph must not be able to reach `store.ts` — enforced by a pinned unit test that imports the terminal entry chain and asserts no DB file is opened.
3. **The agent talks to the engine over HTTP + files only** (notes via `POST /api/notes`, automations CRUD via the REST API, memory via versioned files in the project, outbox files as the durable fallback). Both directions survive the other side being down.
4. **The engine makes its own LLM calls** (miner, dream, mint, skills sub-agents, headless agent runs — all via the bridge, as today) with a **budget governor** that hard-stops spend per hour/day.
5. **Supervision without a supervisor process** (the Ollama pattern, [C]): every agent-side touchpoint (note delivery, `unown doctor`, automations commands) pings the engine's health endpoint; on connection-refused it spawns the engine detached once (single-flight in-process + cross-process lockfile), then polls health with jittered backoff. The engine itself installs SIGTERM/SIGINT handlers that drain in-flight requests, checkpoint the WAL, and exit — and `recoverOrphans` keeps crash recovery idempotent at boot.

## Responsibility split

Who does what, with and without the other side alive:

| Capability | Agent+engine (both up) | Engine alone (auto mode) | Agent alone (engine down) |
|---|---|---|---|
| Coding sessions | agent runs TUI, injects memory stack | — | agent runs TUI with last-written memory files (stale but functional) |
| Session note capture | hooks build note → POST to engine (fast path) | engine sandboxes/automations generate their own benchmark + terminal notes | hooks build note → **outbox file** (durable), synced when engine returns |
| Note consolidation (AutoDream) | engine dreams on schedule + gated events | same — engine dreams projects that have pending notes; no agent needed | deferred; outbox accumulates (bounded by note size caps) |
| Project memory versioning | engine writes new versions + files; agent re-reads per session | same; applies to *future* agent sessions only | agent reads files; no new versions |
| Skill minting | engine mints into `<project>/.unown/skills/` | same | — |
| Harness self-improvement | engine runs cycles against its own task suite | same — this is the engine improving *itself*, no user project involved | — |
| Task minting / graduation | engine | same | — |
| Automations CRUD | agent relays user commands to engine REST | engine executes schedules by spawning unattended `unown` children | CRUD fails fast with an actionable message + auto-start attempt |
| Memory rollback / history | agent → engine REST | engine (dashboard-driven too) | unavailable; agent says so |
| Doctor / health | agent probes engine, reports KPIs | engine self-reports via `/api/overview` | agent reports engine down, offers `unown engine start` |
| LLM traffic | both → bridge (serialized spacing) | engine → bridge | agent → bridge (if up; bridge is its own process) |
| Database | **engine only** | **engine only** | not opened at all |

The one deliberate asymmetry: the *agent* never blocks on the engine for anything interactive. Note delivery has a 4s timeout, automations commands have short deadlines, and every fallback path is a file. The *engine* never blocks on the agent either — its only agent-shaped dependency is spawning unattended `unown` children for automations, which carry their own SIGKILL timeout (`automations.ts:467`).

## Failure modes & mitigations

Each scenario: trigger → observed/expected behavior → mitigation (implemented change). The operational companion to this section — what each failure looks like from the terminal (footer states, toasts, `/engine`, doctor) and the by-hand recovery playbook — is [resilience.md](resilience.md).

**F1 — Event feedback loop (runaway dreams).** *Observed* [V]: `run:finished` → `dream-check` → dream + canary → its own runs emit `run:finished` → repeat; 9 dreams, ~630k prompt tokens, 50 min. *Mitigation*: (a) `dream-check` now requires ≥ `PI_DREAM_CHECK_MIN_NOTES` **undreamed** notes (default 3 — its documented contract) instead of firing on every event; (b) runs spawned *by* a dream carry `meta.origin=dream` and their `run:finished` events do not re-trigger dream-check (self-trigger guard); (c) a per-job cooldown (default 10 min) collapses queued duplicates; (d) the budget governor (F7) is the hard backstop.

**F2 — Hung job wedges the engine (busy mutex).** *Observed* [V]: a regression run sat `running` >25 min; every other job queued behind it. *Mitigation*: every router job now runs under a **job watchdog** (`PI_JOB_TIMEOUT_MS`, default 20 min): a job exceeding it is aborted (AbortController plumbed into the runner), marked `errored` with `watchdog:timeout`, and the mutex is released; the next boot's `recoverOrphans` still heals rows. Watchdog events feed the dashboard and doctor.

**F3 — Engine crash / kill -9.** *Behavior*: agent sessions unaffected (they never needed the engine mid-turn); notes fall to the outbox [V]. *Mitigation*: ping-and-spawn auto-start (design rule 5) brings the engine back on the next agent touchpoint or dashboard load; `recoverOrphans` marks orphaned runs/cycles/dreams `errored` and discards unvalidated minted tasks at boot [V — verified in before-benchmark: 0 stuck `running` rows after SIGKILL+restart]. SQLite WAL makes `kill -9` survivable [C — sqlite.org/wal.html].

**F4 — Engine slow or wedged but alive (no crash).** *Mitigation*: `/api/overview` gains a `router.busyMs` field; the doctor warns when the busy mutex has been held > 2× the job timeout; the watchdog (F2) is the corrective.

**F5 — LLM upstream down / slow (bridge healthy, Agnes unreachable).** *Behavior*: bridge retries then errors; runner marks runs `error` (llmDead detection, `runner.ts:491`); dreams skip. *Mitigation*: circuit-breaker per upstream in the engine — after N consecutive failures the learning jobs pause themselves with `backoff_until` (exponential, full jitter, capped), and `doctor` reports "learning paused: upstream unhealthy". No token burn while down [C — AWS jitter/circuit-breaker patterns; see research doc §4].

**F6 — SQLite contention (two engines, or legacy agent opens).** *Mitigation*: after detachment the CLI never opens the DB (rule 2, pinned by test); the engine keeps `BEGIN IMMEDIATE` + `busy_timeout=5000` + `synchronous=NORMAL`, schedules `wal_checkpoint(TRUNCATE)` every 60s (bounded WAL growth under long-lived readers [C — WAL §6]) and on graceful shutdown; on Windows the cross-process-mutex footgun is moot because only one process opens the file at all.

**F7 — Resource burn (the "too hard on resources" question).** *Mitigation — budget governor*: the engine tracks LLM spend per rolling hour/day (calls + prompt/completion tokens from the bridge usage log) and refuses to *start* new learning jobs when over budget (`PI_ENGINE_MAX_CALLS_HOUR`, `PI_ENGINE_MAX_TOKENS_DAY`; defaults 60 calls/hour, 2M tokens/day), surfacing `budget:throttled` on the job row. Idle cost is structurally zero: the router sleeps on a 5s timer, no polling loops beyond the automations scheduler's 20s sweep, and measured idle CPU is 0.3% / ~140 MB RSS [V — before-benchmark].

**F8 — Orphaned children (automations/task subagents).** *Behavior*: Bun children keep the parent alive unless `unref`'d [V — research doc §2]; automation children have SIGKILL timeouts [V]. *Mitigation*: the engine's graceful-shutdown path kills tracked children; automation spawns keep their timeout; the child-reaper module continues to reap zombies. Print mode gains a bounded exit deadline (F10) so a stray handle can never wedge an unattended child.

**F9 — Concurrent engine starts (user runs `agent:start` twice, or auto-start races a manual start).** *Mitigation*: single-instance lock — the engine acquires an exclusive lockfile (`data/self-learning/engine.lock` via `flock` on POSIX, `LockFileEx` semantics via a lock-file-open on Windows) at boot; a second engine exits 0 with "already running (pid N)". The CLI's auto-spawn uses the same lock as cross-process single-flight, then re-checks health so racing spawners converge on the winner (the loser exits silently).

**F10 — CLI process won't exit (stray handle).** *Investigated and root-caused* [V]: idle **keep-alive sockets** left by Bun's `fetch` (note delivery to the engine, bridge traffic) hold the event loop alive after the answer is written — caught live (answer flushed, 2 open sockets, 8 threads, process alive; intermittent because the sockets sometimes close in time). *Mitigation (two nets)*: the stall watchdog (no session events for `PI_PRINT_STALL_MS`, default 3 min → force-exit with an actionable message — it fired correctly in a live pre-answer wedge) and a **hard-exit timer** armed only at a final `agent_end` (`PI_PRINT_EXIT_GRACE_MS`, default 15 s, nothing re-arms it — the work is done and the answer is flushed, so the process LEAVES). Post-fix: 6/6 clean exits where ~half previously hung forever.

**F11 — Memory poisoning via notes.** *Existing* [V]: adversarial-note guard (`guard.ts`) + poison-corpus benchmark (11 variants, `benchmarks/memory-eval/poison-corpus/`). *Unchanged by detachment*: the engine remains the sole writer of memory versions, so the guard surface does not grow. New note sources (outbox sync) pass through the same `ingestTerminalNote` path.

**F12 — Clock jumps / laptop sleep.** *Mitigation*: interval jobs schedule off `Date.now()` deltas already; missed intervals coalesce (a job fires once, not N times, after wake — clamped `next_run`); the automations scheduler already coalesces overdue runs.

**F13 — Engine API attack surface (M7).** *Observed* [V — pre-M7 probe]: the loopback bind plus CORS-only posture left three real holes — (a) CORS gates what a browser can **read**, never what it can **send**: a `text/plain` POST is preflight-free and the API parses any content-type, so any website the user visits could drive `POST /api/automations` (arbitrary prompt execution), `POST /api/notes` (memory poisoning), `POST /api/providers` (re-route engine LLM traffic at an attacker baseUrl) or `POST /api/shutdown` blind through their own browser; (b) same-port **DNS rebinding** (`evil.com` → `127.0.0.1:3030`) defeats CORS entirely (page origin == target origin) and allowed full reads; (c) `127.0.0.1` is a shared interface — every other local user's processes could `connect()` (the PostgreSQL local-trust lesson: loopback TCP carries no file-permission gate). *Mitigation* (`engine-auth.ts`, enforced in the `Bun.serve` fetch wrapper — never in `handleApi`, which the unit suite calls directly): (1) **Host-header validation** (Vite `allowedHosts`-style; `localhost`, `*.localhost`, IP literals, plus `UNOWN_ENGINE_HOSTS`) closes the rebinding lane; (2) **Origin enforcement** — a request that *carries* an `Origin` must be on the CORS allow-list, closing the preflight-free POST hole in every browser independent of the arriving PNA/LNA permission work; (3) a **per-boot bearer token** (`data/self-learning/engine.token`, 0600, Jupyter-style) required for every `/api` request except `GET /` liveness and preflights; same-user clients auto-discover it (`engineFetch` attaches it, re-reads once on 401 to heal across engine reboots), the web dashboard gets it from a Host-checked `/api/engine-token` server route, and SSE accepts `?token=` on `/api/events` only (EventSource cannot set headers). `UNOWN_ENGINE_AUTH=off` exists for same-UID containers but **refuses to boot** next to a non-loopback `UNOWN_ENGINE_HOST` — an Ollama-style accidental `0.0.0.0`-with-no-auth can never exist. `/api/overview` reports the posture (`auth: {mode, bind}`). *Honest threat model*: the token defends against other local users and browser confused-deputy attacks; it cannot defend against same-user malware (that code reads the token file and the SQLite DB directly — the sandbox/policy layers are that defense). Pinned by `test/engine-auth.test.ts` (29 cases incl. a fresh-process gate run: 401/403/200 matrix, exemptions, refusal).

**F14 — Data growth (the engine that never forgets).** *Observed* [V — R3 recon, 2026-10-21]: for its first months the engine pruned exactly ONE growing table (the governor's `llm_ledger`, 24h) — everything else accumulated forever. `hook_log` grows ~2 rows per tool call and `/api/overview` `COUNT(*)`s it on every hit; `runs` rows carry full JSON transcripts (~19KB average, the heaviest column in the DB); the governor's `budgetStatus()` summed `runs` by `ended_at` with **no index on that column**. *Mitigation (`retention.ts` + the `db-retention` router job)*: the load-bearing design decision is a **structural split** — OPERATIONAL telemetry (hook_log, runs, dreams, ended cycles, finished automation_runs, DREAMED notes) is pruned past its window; PRECIOUS data (memory_versions, skills, skill_versions, tasks, improvements, automations) has **no predicate in the registry at all**, so no aggressive `UNOWN_RETENTION_*` value can touch it, and undreamed notes (the dream work queue) are excluded the same way. Windows: hook_log 14d + a 250k-row cap backstop (Prometheus' time-OR-size shape — a runaway loop must not grow the table inside the window), runs 30d (`running` rows never pruned), dreams/cycles/automation_runs 90d, dreamed notes 90d; `UNOWN_RETENTION_DAYS=0` is the global kill switch. Pacing (the Home Assistant recorder `auto_purge` shape): deletes run in 5,000-row batches (the rowid-subselect form — SQLite's `DELETE…LIMIT` needs a compile flag bun does not ship), at most 50k rows per table per pass, and a pass with backlog remaining returns `moreRemaining`, which the router's self-reschedule seam (`nextRunInterval`) turns into a 5-minute re-run instead of the 24h cadence — a six-month-old install drains paced over hours, never in one boot, and a first contact that deletes more than 10k rows prints one explanatory line. Nothing prunes at startup: only the job fires it, first at 24h after seeding. The job is pure SQL, off `LEARNING_JOBS`, so it runs even while the governor throttles LLM spend (the note-sync/sandbox-gc class). SQLite notes: `auto_vacuum` stays NONE — freed pages go to the freelist for REUSE, so the file size plateaus at the window's high-water mark instead of shrinking — and no VACUUM ever runs on the hot path (it needs roughly 2x disk and locks the DB). New indexes: `runs(ended_at)` (governor + prune) and `automation_runs(started_at)` (in the automations schema, the guaranteed-ordered home). Automations gained the matching sleep behavior: the 5-minute misfire grace is env-tunable (`PI_AUTOMATION_MISFIRE_GRACE_MS`) and `UNOWN_AUTOMATION_MISFIRE_CATCHUP=1` opts into launchd-style catch-up-once — a slot missed while the machine slept (past grace, newer than 24h) runs ONCE, coalesced, rescheduled from now; never N replays. Pinned by `test/retention.test.ts` (16 cases: window edge cases, the structural exclusions at aggressive settings, an off-by-one in the row cap caught before shipping, batch cap + moreRemaining + idempotency, kill switch, missing-table tolerance) + 5 automations cases (catch-up on/off/beyond-24h/one-shot, widened grace).

## Resource budget

Targets, with the measured baseline [V — before-benchmark, 2026-10-20]:

| Metric | Before | Target / guarantee |
|---|---|---|
| Engine idle CPU | 0.3% | ≤ 1% (no change expected; router tick is 5s) |
| Engine idle RSS | ~140 MB | ≤ 160 MB (watchdog + budget code is O(KB)) |
| Terminal agent DB fds | **3 (opens engine DB)** | **0 (hard detachment, test-pinned)** |
| CLI cold start (first run) | 11.3 s | ≤ 12 s (unchanged; init work dominates) |
| CLI warm start | 3.0–4.4 s | ≤ 4.5 s |
| Learning spend, unattended | unbounded (F1) | ≤ 60 calls/hour, ≤ 2M tokens/day (defaults, configurable) |
| Dream cadence, steady state | every run:finished (F1) | ≥ 10 min apart + ≥3 undreamed notes |
| Engine crash recovery (auto) | manual restart | ≤ 15 s from next agent touchpoint (ping-spawn-poll) |

## Implementation plan

Milestones, each independently shippable and pushed separately:

- **M1 — Auto-mode stability (the engine must be safe alone).** F1 (gate + self-trigger guard + cooldown), F2 (job watchdog), F7 (budget governor), F5 (upstream circuit breaker + `backoff_until`), F4 (`router.busyMs` + doctor warning).
- **M2 — Detachment (the agent must be clean alone).** Lazy, engine-only `Store` (no module-scope open); split `hooks.ts` policy from persistence so `termhooks.ts` stops pulling `store.ts`; move `BRIDGE_URL` out of `store.ts`; enforce with an import-graph unit test (terminal chain opens zero DB fds) + a boot-probe test; F10 (print-mode exit deadline).
- **M3 — Supervision (the engine must come back alone).** F9 (single-instance lock), ping-and-spawn auto-start on note delivery + automations commands + doctor; graceful SIGTERM drain; WAL checkpoint scheduling (F6); `unown engine start|status|stop` CLI surface.
- **M4 — Benchmarks & stability harness.** `scripts-dev/arch-bench.sh` → `benchmarks/detached-engine/` receipts (before/after); soak test (engine alone 30 min: no runaway dreams, bounded WAL, flat RSS); crash-injection matrix (SIGKILL under dream, under harness, under note ingest); regression suite runs.
- **M5 — Docs, landing, cross-platform.** This record + README + landing claims updated; Windows/macOS paths verified where the container allows (spawn patterns, lockfile, path handling), gaps documented with [U] tags for hardware we lack.

## Benchmarks

Measured — receipts in [`benchmarks/detached-engine/`](../benchmarks/detached-engine/RESULTS.md) (runner: `node benchmarks/detached-engine/runner.mjs`; scenarios `arch`, `crash`, `autostart`, `soak`). Headlines: terminal-agent DB fds **3 → 0**; unattended dream cadence runaway (9 dreams / 75 calls / 630k tokens per 50 min) → bounded (1 dream / 8-min soak, 0 bursts, governor refusal verbatim in the engine log); crash recovery manual → automatic (`unown engine start`, 6.7 s from a down engine to healthy with orphan rows healed); print-mode intermittent hang-forever → 6/6 clean exits (root cause measured: idle `fetch` keep-alive sockets hold Bun's event loop; fixed by the F10 stall watchdog + hard-exit at final `agent_end`). Soak: RSS flat (−9.8 MB over 8 min), WAL checkpointed to 0 B, learning active (4 runs, 1 dream) at 13/30 of the hourly call budget.
