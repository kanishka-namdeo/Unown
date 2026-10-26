# Long-run endurance bench — "what breaks when the agent runs for a long time"

The 2026-10-27 stress round for **long-running tasks**: every round before it
(subagents v0.0.24, browser v0.0.29) drove *feature breadth*; this one drives
**duration** — many-turn sessions, forced compaction cycles, kill/resume
torture, a multi-job engine soak with live terminal traffic, budget/breaker
fidelity under the metered endpoint, and the unattended ralph loop.

## Research grounding

The scenario list is not improvised; each lane pins a documented failure
mode or an established methodology:

| Source | Finding this bench pins |
|---|---|
| [METR time-horizon](https://metr.org/blog/2025-03-19-measuring-ai-ability-to-complete-long-tasks/) ([arXiv 2503.14499](https://arxiv.org/abs/2503.14499)) | reliability over duration is the differentiator — per-scenario verdicts, not just pass rates; score-as-you-go inside one long session |
| [METR RE-Bench](https://github.com/METR/RE-Bench) | agents fail to *build on progress over time* — the staged buildout (10 sequential features, one session) is exactly that shape |
| [Terminal-Bench 2.x](https://www.tbench.ai/news/announcement-2-0) + [timeout doctrine](https://www.tbench.ai/news/leaderboard-integrity-and-timeouts) | fixed, published wall-clock caps per scenario (process-group SIGKILL); pinned fixture = no dependency-drift false failures |
| [Terminal-Bench Challenges](https://www.tbench.ai/news/terminal-bench-challenges) | multi-hour single-goal runs regress — pass bars are score-floored (features ≥ 8/10), not all-or-nothing |
| [tau-bench pass^k](https://github.com/sierra-research/tau-bench) | consistency under repetition — the soak samples repeat-run outcomes across cycles |
| Claude Code [#105086](https://github.com/anthropics/claude-code/issues/105086), [#100710](https://github.com/anthropics/claude-code/issues/100710), Codex [#14447](https://github.com/openai/codex/issues/14447) | compact→refill→compact thrash; context loss on auto-compact — the compact-thrash drill (24k window, tightened reserves) |
| Gemini CLI [#26116](https://github.com/google-gemini/gemini-cli/issues/26116) | "stuck in thinking loop for hours" — the loop-guard lure + the `--max-tool-repetitions` contract |
| Claude Code `--max-turns` / `--max-budget-usd` ([cli-reference](https://docs.claude.com/en/docs/claude-code/cli-reference)) | turn caps: default unlimited, hard cap with an honest exit — the turn-cap scenario |
| [k6/Grafana soak doctrine](https://grafana.com/docs/k6/latest/testing-guides/test-types/soak-testing/) | duration ≫ smoke, RSS-slope (not absolute) criteria, fd stability, warmup discard, 30 s sample cadence |
| [SQLite WAL docs](https://sqlite.org/wal.html) | long-lived readers block checkpoints — WAL bytes are a sampled verdict field |
| [USE Method](https://www.brendangregg.com/USEmethod/uselinux.html) | per-resource saturation/errors — engine RSS + fds + threads + WAL + bridge counters every 30 s |

## The fixture

`fixture/` is **ledgerlog** — a tiny expense-ledger CLI (pure TypeScript,
dependency-free, `bun test` suite). It ships a working core (add / list /
balance + 14 tests) and a staged buildout in `features/feature-01..10.md`:
category filter → date-range filter → CSV export → CSV import → monthly
summary → budgets → undo stack → audit journal → recurring templates →
versioned persistent store with migration. Ten features is a genuine
long-horizon task: ~80–150 tool turns, context accumulation, repeated
compactions, per-feature commits.

`acceptance/` is the bench-owned scoring suite: per-feature tests that are
**never in the agent workspace during a session** — the runner copies them
into `<workspace>/tests/acceptance/` at scoring time, runs
`bun test tests/acceptance/`, and removes them. The agent cannot see, edit
or delete what scores it (anti-tamper by construction, the benchmarks
README's rule 3). Calibration: against the pristine fixture the acceptance
suite scores 0/10 features (the 6 passing tests are baseline-behavior pins
on the shipped core).

## Scenarios

Run:

```bash
node benchmarks/longrun/runner.mjs --scenario all --model agnes-3.0-flash
node benchmarks/longrun/runner.mjs --scenario marathon,engine-soak --resume <run-ts>   # resume-safe
node benchmarks/longrun/runner.mjs --list
```

Prereqs: the stack up (`bun run agent:start`) — scenarios drive the shared
bridge :3031 (the metered Agnes upstream is part of the stress); bench
engines boot on scratch ports 3040–3044 with scratch data/db dirs and are
torn down per scenario.

| Scenario | What it drives | Cap | Pass bar |
|---|---|---|---|
| `marathon` | one headless session, features 01–10, `--max-turns 150` | 45 min | ≥ 8/10 features, exit 0, session parses, bounded agent RSS slope, no context wedge |
| `compact-thrash` | features 01–06 with `contextWindow 24000` + tightened compaction reserves | 30 min | ≥ 2 compactions, ≥ 3/6 features, no overflow-error loop |
| `kill-resume` | features 01–08; SIGKILL at 3 staged gates, `--resume` the same session each time | 45 min | ≥ 2 kills landed, ≥ 2 resumes took, session never corrupt, ≥ 5/8 features |
| `loop-guard` | an impossible read-only spec lure + `--max-tool-repetitions 6` | 12 min | contract exit (0/1/4), guard fires honestly or model gives up — never a hang |
| `turn-cap` | features 01–03 with `--max-turns 8` | 15 min | `capped: true`, exit 0, `num_turns ≤ 8`, answer present |
| `notes-storm` | engine DOWN: 6 real terminal sessions queue outbox notes; bench engine boots → note-sync drains → auto-dream consolidates | ~30 min | outbox filled ≥ 2, drained, 0 dead letters, no note loss, dream ran |
| `engine-soak` | jobs enabled (harness-cycle, auto-dream, task-mint, dream-check) + a terminal session every 5 min; 30 s sampling: engine RSS/fds/threads/WAL, governor, breaker, runs, dreams, bridge counters | 45 min (`--soak-minutes`) | engine up throughout, learning happened, RSS slope ≤ 30 MB/h after warmup, fd drift ≤ 25, WAL ≤ 64 MB, graceful shutdown |
| `budget-fidelity` | engine A `PI_ENGINE_MAX_CALLS_HOUR=3` → 2nd cycle `budget:throttled`; engine B dead bridge → breaker opens, jobs skip; engine C live bridge → recovered | ~10 min | throttle skip seen, breaker reacted, recovered after restart |
| `ralph-chain` | 6-iteration worker/reviewer loop (agnes-3.0-flash worker, agnes-2.5-flash reviewer), fresh context per iteration | 45 min | contract exit (0/1), ralph state present, no crash artifacts |

Receipts land in `results/run-<ts>/receipt-<scenario>.json` (machine verdict
+ checks + full metrics), `logs/`, and `summary.json` (all-pass rollup).
`--resume <ts>` skips scenarios that already have a verdict — the runner is
itself a long-running task.

## Honest limitations

- One model (`agnes-3.0-flash`), one OS (Linux), one box (2 CPU / 4 GB RAM)
  — the pass bars are measured for that envelope, and the metered ~20 RPM
  upstream is *part of the stress*, not a controlled variable.
- The soak's default is 45 minutes, not the k6-canonical 8–72 h; it is the
  longest duration that fits a working session on this box. The knob is
  `--soak-minutes`; the verdict math (slope, drift, bounds) is
  duration-independent.
- Engine runs inside scenarios use the sandbox fallback lane of the host
  (bwrap where available — `scripts/bwrap_smoke.sh` gates it); the bench
  does not pin a specific isolation backend.
- `pass^k` consistency is observed (repeat-run outcomes across soak cycles)
  but not formally swept like tau-bench's k=1..4.
