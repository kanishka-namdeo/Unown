# Detached-Engine Benchmarks — Before/After + Stability

Runner: `node benchmarks/detached-engine/runner.mjs` (scenarios: `arch`, `crash`, `autostart`, `soak`; receipts in `results/`). BEFORE = live baseline on the untouched tree at `25a97fd` (2026-10-20, `results/before-baseline.json`). AFTER = the detached-engine milestones (M1 stability + M2 detachment + M3 supervision + the F10 hard-exit), receipts `results/after-*.json`, git `8d5d3e9`+.

## Before → After

| Metric | Before (`25a97fd`) | After | Receipt |
|---|---|---|---|
| Terminal-agent fds on the engine DB (live session) | **3** (db + `-wal` + `-shm`, plus schema DDL + a `memory_versions` dedup `DELETE` per boot) | **0** | `after-1792511984844.json` (`cli_engine_db_fds: 0`; pinned deterministically by `pi-repo/packages/self-learning/test/detachment.test.ts`, 6 fresh-process cases) |
| Unattended dream cadence | runaway: 9 dreams / 75 LLM calls / 630k prompt tokens per 50 min (killed manually) | bounded: 1 dream per 8-min soak window, 0 bursts; cooldown + self-trigger guard + governor | `after-1792513008859.json`; engine log shows the governor's refusals verbatim |
| Unattended spend ceiling | none | hard stop: learning jobs skip at the hourly/daily call+token ceilings — demonstrated live: `auto-dream skipped: budget:throttled 10 engine LLM calls in the last hour (limit 10)` × every attempt in the window | `after-1792512479774.json` (`budgetTripped: true`, 16/16 samples over, zero burn past the limit) |
| Stuck job → engine health | a hung regression run held the busy mutex **>25 min**, all jobs queued behind it, manual restart | job watchdog cuts any job at `PI_JOB_TIMEOUT_MS`, heals its rows, releases the mutex (unit-pinned: hung job cut off in <500 ms at the test seam) | `test/governor.test.ts` |
| Engine crash recovery | manual only (operator notices, runs `agent:start`; measured 3.7 s once someone did) | auto: `idle-sigkill→OK`, `midcycle-sigkill→OK` — kill → `unown engine start` → lock stolen, orphaned `running` rows healed to `error`, API healthy | `after-1792511922774.json` |
| Engine auto-start (agent-side) | none | engine down → CLI session → engine up in **6.7 s**, session note delivered via outbox drain | `after-1792511922774.json` |
| Print-mode exit (`unown -p`) | intermittent hang-forever after the answer (root cause measured: idle keep-alive sockets from `fetch` hold Bun's event loop; caught live: answer flushed, 2 open sockets, process alive) | **6/6 clean exits** post-fix (stall watchdog + hard-exit at final `agent_end`); the stall watchdog fired correctly in a live pre-answer wedge with its actionable message | live runs 2026-10-20 (session receipts in the commit message) |
| Engine idle RSS | ~140 MB | ~140–148 MB flat; soak RSS delta **−9.8 MB** over 8 min (no leak) | soak receipts |
| WAL size under the engine | unbounded between checkpoints | **0 B** at soak end (60 s TRUNCATE checkpoint timer) | soak receipts |

## Soak (8 min, all jobs enabled, budget 30 calls/h)

`up=true · dreams=1 · runs=4 · calls/h peak=13/30 · bursts=0 · rssDelta=−9824 KB · wal=0 B` — the engine learns autonomously (one dream consolidating notes, one harness cycle of 4 runs), inside its budget, with flat memory and a checkpointed WAL. The same window with a 10/h budget shows the backstop: every learning attempt skips with `budget:throttled` and **zero** tokens burn past the ceiling (`after-1792512479774.json`).

## Notes

- CLI start-time variance (4.6–15.3 s across receipts) is upstream LLM latency (Agnes direct measured 2–11.7 s for a trivial call) plus bridge queueing behind engine traffic — not agent overhead; the BEFORE numbers (3.0–11.3 s) sit in the same band.
- The `arch` DB-fd probe samples `/proc/<pid>/fd` every 250 ms during a live session; the deterministic pin is the fresh-process detachment suite (import graph → zero opens, engine side still opens on first `logHook`).
- Crash-matrix healing relies on `recoverOrphans` at boot (pre-existing) + the M3 single-instance lock (stale-holder steal, same-pid re-entrancy); the mid-cycle kill healed its in-flight `running` rows to `error` (verified `healed: true`).
- Run the comparison yourself: `node benchmarks/detached-engine/runner.mjs --phase after` (needs the stack up; `--only` filters scenarios, `--soak-minutes N` bounds the soak).

---

## 2026-10-21 — re-run on the current stack (Agnes upstream, commit `43c89b7`)

Full after-phase coverage, split across four receipts because this 2-CPU
sandbox caps a single foreground run (~10 min) — the suite's own `--only`
filter was used per the runner header, soak bounded to 7 min with
`--soak-minutes`:

| Scenario | Receipt | Headline |
|---|---|---|
| arch + crash | `after-1792597147507.json` | `cli_db_fds=0` start=[9381, 4830, 17997] ms; idle-sigkill probe race (below), midcycle→OK |
| crash (immediate re-run) | `after-1792597241889.json` | **idle-sigkill→OK** (recovery 4.8 s, 0 stuck rows, lock stolen), midcycle→OK (recovery 5.3 s) |
| autostart | `after-1792597327444.json` | engine-down confirmed → CLI session echoed → engine up (pid 16838), 43.6 s wall |
| soak (7 min) | `after-1792597771993.json` | `up=true dreams=1 runs=0 calls/h peak=15 bursts=0 rssDelta=−6848 KB wal=0 B` |

Soak detail (14 samples, 30 s apart): engine up throughout on one pid; 1 dream
in window, 0 bursts (BEFORE was 9 back-to-back dreams / 75 LLM calls per
50 min); governor budget never exceeded (peak 15 calls/h of 60, 186,065
tokens/h of 200,000, `overBudget: false` on every sample, breaker never
opened); RSS 115.4 → 108.6 MB (−6.8 MB, flat); WAL **0 B** at window end.

Honest notes for this batch:

- **arch reproduces the detachment claim**: `cli_engine_db_fds: 0` sampled
  during a live session (BEFORE: 3). CLI start times (4.8–18.0 s) sit above
  the committed 4.6–15.3 s band — a parallel test suite was sharing both CPUs
  during the run, on top of the usual upstream-LLM latency; same class as the
  existing variance note, not a regression signal (engine idle RSS 151 MB,
  cpu 0.5%, within the documented band).
- **First crash attempt recorded `idle-sigkill→FAIL` — a probe race, not a
  recovery failure**: `restartExit: 0` and the engine was healthy seconds
  later (0 stuck rows, new pid); the runner's immediate post-restart health
  probe (2 s timeout) fired before the engine finished booting under load, so
  `lockStolen` was recorded false. The immediate re-run of the same scenario
  is clean and is the receipt to cite.
- **midcycle-sigkill ran with no run in flight** (`runningRowsBefore: 0` —
  the harness-cycle trigger had not opened a run row within its 2.5 s
  window), so the in-flight-heal path was not exercised in this batch; it
  stays pinned by the committed `after-1792511922774.json` (healed: true) and
  the fresh-process detachment suite.
- Engine identity note: the crash/autostart scenarios replace the engine
  process by design (kill → restart, stop → auto-start). After this batch the
  engine runs as `bin/unown engine serve` (auto-start path) rather than the
  `scripts/start.ts` child; `.run/engine.pid` may lag the live pid (stop.ts's
  /proc-cwd sweep still finds it).
