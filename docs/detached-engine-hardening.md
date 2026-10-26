# Detached Engine Hardening — 2026-10-26 Verdict & Decision Record

> **Verdict**: the detached self-learning engine STAYS. Every serious system that runs *continuous* memory consolidation ships a locally-supervised daemon (OpenAI's `codex-app-server-daemon`, MemOS's local plugin, Supermemory's single-binary server, Letta's agent server); the alternatives all cost more than they save. What the round shipped instead is six targeted hardening lanes — outbox dead-lettering, delivery retry, `/api/health` lifecycle phases, an in-flight job drain registry, Windows pidfile recovery, and cross-install token discovery — each closing a gap the competitor reverse-engineering sweep exposed. The engine was already sound; now its honest-failure lanes are sound too.

- **Status**: accepted — all six lanes implemented, tested, and live (v0.0.28)
- **Method**: ~54-source landscape survey ([detached-vs-embedded-research.md](detached-vs-embedded-research.md)) + source-level reverse engineering of ten repos at pinned SHAs ([memory-competitor-source-deep-dive.md](memory-competitor-source-deep-dive.md)) + a full codebase walk of the live supervision stack (engine-supervisor/server/router/outbox/term), each gap mapped to a published precedent before implementation
- **Sections**: [The question](#the-question) · [The evidence](#the-evidence) · [The verdict](#the-verdict) · [What shipped](#what-shipped) · [What was deliberately NOT done](#what-was-deliberately-not-done) · [Verification](#verification) · [Benchmarks](#benchmarks)
- **Related pages**: [detached-engine-architecture.md](detached-engine-architecture.md) (the accepted design this round hardens) · [resilience.md](resilience.md) (the failure-mode catalog) · [memory.md](memory.md) · [configuration.md](configuration.md) (the new knobs)

## The question

The memory system is Unown's core USP, and it runs in the detached engine. Three options were on the table:

1. **Retain** the detached daemon, harden the weak lanes (agent-side and cross-platform compatibility);
2. **Embed** the memory system into the terminal agent process (no daemon);
3. Something else — a sidecar spawned per-session, a library + cron, a hosted service.

The specific doubts, collected from the live system's own records: the always-on layer is source-install-only (compiled binaries refuse the service install); a binary install talking to a source-repo engine 401s forever (the R11 token split); the Windows detach lane never writes a pidfile; a poisoned outbox note retries forever, silently; a SIGTERM under a live dream orphans it for the next boot to heal.

## The evidence

Tiered per the house rule — `[V]` verified at a cited source, `[C]` upstream-claimed, `[U]` unknown.

**The market split is clean, and it favors detachment for continuous learning [V]:**

- Interactive coding agents (Claude Code, Gemini CLI, Cursor, opencode, Aider) run **files + in-process memory, zero daemons** — but none of them consolidate memory in the background; their memory is static between sessions [V: detached-vs-embedded-research.md §1].
- Every system with *continuous* consolidation runs a detached process: Letta's sleep-time compute is a second agent on the server [V: letta archive branch, `run_manager.py`], Cognee pipelines run anchored asyncio tasks with a drain registry [V: `cognee/infrastructure/background_tasks.py`], MemOS's local plugin is a per-agent TypeScript daemon over better-sqlite3 with a KeepAlive supervisor [V: `apps/memos-local-plugin/ARCHITECTURE.md`].
- **The killer precedent**: OpenAI ships `codex-app-server-daemon` — a detached, pidfile + file-lock managed local daemon with a lifecycle CLI, `shutdownGraceSeconds`, and an embedded fallback when the daemon cannot initialize [V: detached-vs-embedded-research.md §2]. OpenAI converged on the hybrid Unown already implements, almost feature-for-feature.
- Supermemory local is "a single self-contained memory-server binary — no Docker, no database to provision" [C: supermemory docs] — the exact shape of Unown's engine on :3030 [V].

**The embedded alternative is worse on the axes that matter [V]:**

- Bun #40659: on Windows, `BEGIN IMMEDIATE` does not exclude across processes — "silently breaks any cross-process mutex built on SQLite write transactions," **closed as not planned** [V: oven-sh/bun#40659]. The engine-as-single-DB-writer rule is load-bearing, not stylistic; embedding means the terminal agent and the learning loop would contend on one SQLite file from (at least) two processes.
- The measured coupling that motivated detachment in the first place (the terminal CLI opening the engine's SQLite — 3 fds per boot; a runaway dream loop burning ~630k tokens in 50 minutes) has not gone away [V: detached-engine-architecture.md "Current state"].
- Embedding puts the ~20-minute watchdog'd jobs inside the interactive process: a wedged dream wedges the TUI. The failure isolation runs the other way too — the terminal agent's crashes would take the learning loop with it.

**The failure-mode catalog was already textbook [V]** — probe taxonomy → spawn-only-on-refused; cross-process crash-loop circuit; single-instance lock with pid-reuse defense; HTTP-first drain for Windows; version-skew handshake; bounded-loss repair (`engine repair`); 188-file test suite. The gaps that remained were honest-failure lanes, not architectural:

| Gap | Precedent that closed it |
|---|---|
| Poisoned outbox note retried forever, silently | MemOS `AutoDroppingQueue` + dead-letter quarantine PR #2403; Graphiti's 202-then-drop loss #1707 [V] |
| No retry before the durable fallback | Letta's generated client: 2 retries + Retry-After + exponential backoff [V] |
| No lifecycle probe for stoppers | codex-app-server-daemon's warming/ready/draining + `shutdownGraceSeconds` [V] |
| SIGTERM orphans a mid-flight dream | Cognee's background-task registry + `wait_for_background_tasks(timeout)` [V: `cognee/infrastructure/background_tasks.py`] |
| Windows pidfile never written | scripts/start.ts's own netstat recovery lane [V] |
| Binary↔source 401 split (R11) | the shared well-known discovery path pattern (Ollama/Supermemory single-binary servers) [C] |

## The verdict

**Retain. Harden.** The detached engine is stable (crash-loop circuit, single-instance lock, quick_check boot gate — all test-pinned), viable (source installs get an OS service; every agent touchpoint auto-starts on refusal; the terminal agent never depends on it), and scalable in the dimension that matters (one engine serves many projects; the governor bounds spend; retention prunes the DB). Replacing it would re-introduce the coupling and token-burn failure modes the detachment round measured and fixed, and would fight Bun #40659 on Windows.

The hardening lanes below are the "how do we make it more robust wrt the agent and cross platform" answer.

## What shipped

All six lanes in v0.0.28; file-level detail in the commit `engine: the hardening round`:

1. **H1 — outbox dead-letter lane** (durability, engine-side). `UNOWN_OUTBOX_MAX_ATTEMPTS` (5) ingest attempts per outbox file, tracked in `notes/outbox-state.json` with the last error; then the file moves to `notes/dead/` with a `.reason.txt` sidecar — never deleted, `mv` back to retry. Unparseable files dead-letter on first sight (they can never succeed). The dead count surfaces in `/engine`, `unown doctor` and `unown engine status`. `[V: term.ts, outbox.ts, engine-cli.ts, cli.ts, engine-status.ts]`
2. **H2 — delivery retry-before-outbox** (agent-side). A NETWORK-failed note POST gets ONE bounded ~600 ms retry before the outbox fallback — a note landing inside the engine-restart window delivers directly instead of waiting for the 5-minute note-sync drain. HTTP error statuses are never retried (an answering engine is deliberate). The 2.5 s delivery budget still bounds everything; the outbox remains the guarantee. `[V: term.ts]`
3. **H3 — `/api/health` lifecycle** (supervision contract). A cheap dedicated probe — no 500-run scan, no bridge fetch — answering `{ok, phase: warming|ready|draining, pid, uptimeMs, drainBudgetMs, version}`; `/api/overview` carries the same fields additively. The phase flips to `draining` FIRST, so a poller during the drain window sees the truth, and a stopper can wait out the drain instead of racing it. `[V: server.ts]`
4. **H4 — in-flight job drain registry** (crash containment on deliberate stop). `withBusy` — the single choke point every job holder goes through — tracks the promise of the work holding the mutex; `beginDraining()` refuses every NEW job with the 409-class conflict; the graceful drain awaits the in-flight job bounded by `UNOWN_ENGINE_DRAIN_BUDGET_MS` (10 s default) before closing the store. A deliberate stop lets a mid-flight dream or harness cycle FINISH instead of orphaning its `running` rows for the next boot's `recoverOrphans` sweep. `[V: router.ts, server.ts]`
5. **H5 — Windows pidfile recovery** (cross-platform parity). The `cmd /c start /b` lane (the bun#31603 escape) now polls the engine post-spawn (bounded 15 s) and writes the pidfile from `/api/overview`'s pid — the same source of truth the probe taxonomy trusts. `engine status`'s pidfile verdict and `engine stop`'s SIGTERM target stop being Windows-blind. `[V: engine-supervisor.ts]`
6. **H6 — cross-install token discovery** (the R11 binary↔source split). The engine mirrors its per-boot token to `$UNOWN_HOME/engine.token` — the one tree every install shape resolves identically — written at token-commit, ownership-checked at drain, self-healed in maintenance. Clients resolve a pair (own data dir first, shared mirror second); the 401 retry re-presents whichever side rotated OR the other side's token. A binary CLI probing a source-repo engine now heals instead of reporting `blocked · token` forever. `[V: engine-auth.ts, server.ts]`

## What was deliberately NOT done

- **Embedded fallback mode** (codex's "if the daemon cannot initialize, the TUI starts an embedded server"): our agent-side auto-start already covers the no-daemon case with gated spawn + outbox durability, and an embedded engine would violate the single-writer rule (Bun #40659) whenever the daemon comes up later. Revisit only if the spawn lane proves insufficient in the field. `[U: needs field data]`
- **Embedder child-process isolation** (Cognee's watched Kuzu/LanceDB workers): the ONNX embedder already degrades to the deterministic lexical embedder at load time [V: memzero.ts], the supervisor restarts the engine on a native crash, and dream idempotence (notes stay undreamed until marked) makes a mid-extraction crash lossless. A worker process adds IPC latency to every extraction for a rare failure class. Accepted residual risk, revisitable if engine logs show native crashes in the wild. `[U]`
- **Always-on engine for compiled binaries**: `engine-service.ts` refuses service installation on compiled binaries today ("the engine stack is a source feature" — engine-service.test.ts). Lifting this means teaching the OS service layer to locate and re-exec a moving binary target plus update-time service rewrite; genuinely valuable (the biggest remaining reach gap), deliberately out of this round's scope. `[U: design needed]`
- **Letta-style per-bullet optimistic-version history** in the memory store: only matters with a second writer (dashboard edits, teammate import); the engine is the single writer by design. The `memory_versions` table already gives whole-tier history + rollback.

## Verification

- 5 new test files, 44 new tests: `test/outbox-deadletter.test.ts` (7 — including the poisoned-ingest subprocess probe), `test/note-delivery-retry.test.ts` (3), `test/engine-health.test.ts` (12 — health payload, phase contract, drain registry, draining conflicts), `test/engine-pid-recovery.test.ts` (6 — injectable poll loop), `test/engine-token-mirror.test.ts` (9 — pair resolution + cross-install 401 heal against a live Bun.serve endpoint).
- Full engine suite: **4825 pass / 0 fail / 92 skip across 208 files** (the 92 are env-gated live lanes).
- Live receipts: `/api/health` answering `{"phase":"ready","drainBudgetMs":10000}`; the shared token mirror written and matching the DATA_DIR token; a SIGTERM under a live `auto-dream` job logging `drain: in-flight job 'auto-dream' still running after 10000ms budget — closing under it`; both tokens removed at drain; a clean re-boot to `ready`.
- Pre-existing flake noted honestly: `sync-lane crash sweep (round-4 live finding R4-F1)` (kill -9 timing) fails intermittently **on pristine main too** — not a regression.

## Benchmarks

This round is correctness/observability hardening, not throughput; no benchmark suite changed. The detach-contract receipts that justify the retained architecture remain [benchmarks/detached-engine/RESULTS.md](../benchmarks/detached-engine/RESULTS.md) (0 DB fds in the terminal import chain; before/after supervision). The new surfaces are measurable via `/api/health` uptime + phase and the outbox `dead` counter — both wired into the existing dashboard/status surfaces rather than a new suite.
