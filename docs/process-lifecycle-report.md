# The process lifecycle report — the registry, measured

> The PLM round's first mission deliverable (2026-10-30): the Process
> Registry's own receipts — the state-transition analytics, the per-kind
> reliability, the recovery metrics and the reproducibility score, all
> measured over the live engine's API (`GET /api/plm`,
> `GET /api/processes`, `GET /api/recovery`) after hours of autonomous
> operation against Agnes (`agnes-3.0-flash`). Unmeasured things print
> "not measured" — the nulls are findings, not gaps in honesty.

- [The registry summary](#the-registry-summary)
- [State-transition analytics](#state-transition-analytics)
- [Process reliability metrics](#process-reliability-metrics)
- [Recovery metrics](#recovery-metrics)
- [Reproducibility](#reproducibility)
- [What the numbers prove](#what-the-numbers-prove)

Related: [PLM round session log](plm-round-session.md) ·
[Tool lifecycle report](tool-lifecycle-report.md) ·
[PLM competitor research](plm-competitor-research.md) ·
[PLM usage](plm.md)

## The registry summary

**31 processes tracked** across three kinds, each row carrying the full
mission contract (ID · parent · objective · owner · task · start · end ·
status · tool usage · token usage · outcome · lessons · checkpoint
pointer):

| Kind | Tracked | Succeeded | Notes |
| --- | --- | --- | --- |
| `job` | 23 | 19 | every router job execution (harness cycles, dreams, mints, GC, scans) |
| `run` | 7 | 6 | sandboxed agent runs, children of their jobs where applicable |
| `terminal-session` | 1 | 1 | the human-work lane, reported over HTTP by the terminal agent |

Current census: 23 SUCCEEDED · 5 ABANDONED · 1 FAILED · 2 RUNNING.
Average process duration: 6.7 s.

## State-transition analytics

Every edge ever entered (append-only `process_events`, the event-sourcing
discipline):

| Transition | Count | What it proves |
| --- | --- | --- |
| `(birth) → CREATED` | 31 | no activity outside the registry |
| `CREATED → QUEUED` | 19 | the scheduler pick-up is a recorded state |
| `QUEUED → RUNNING` | 19 | the guard-then-dispatch path, post-F1 |
| `CREATED → RUNNING` | 7 | the run lane's late-attach birth (both events journaled) |
| `RUNNING → SUCCEEDED` | 23 | verified completion, never asserted |
| `CREATED → ABANDONED` | 5 | the pre-fix cohort + honest governor skips |
| `RUNNING → FAILED` | 1 | the drain-closed dream-check, healed at boot |

The `WAITING` / `BLOCKED` / `RETRYING` / `VALIDATING` states recorded zero
entries in this window — correct for an engine whose jobs completed
without waiting on a human; the machine's edges are pinned by 102 unit
tests regardless.

## Process reliability metrics

- **Process success rate**: 23/29 terminal processes SUCCEEDED (79%);
  the 5 ABANDONED rows are the F1 pre-fix cohort plus governor skips
  (each carries its reason in `status_reason` — never a silent drop).
- **Sticky finalize**: the zombie-late finalize path is a no-op by
  construction (pinned); the one FAILED row demonstrates the boot heal
  closing an interrupted dream-check honestly.
- **Orphan healing**: state-aware (running→FAILED, parked→ABANDONED);
  the heal itself is a validated recovery ledger row (below).

## Recovery metrics

**1 recovery event, executed and validated — recovery score 100%:**

- Category `infrastructure`, action `monitor`, status `validated`.
- The chain in the ledger row: the failure ("engine boot healed 1
  orphaned process(es) left by an interrupted engine") → the plan → the
  execution evidence ("state-aware heal: RUNNING/RETRYING/VALIDATING →
  FAILED, parked/created → ABANDONED") → the validation evidence ("the
  engine booted and the registry shows no phantom live work").
- Recurring failure categories: none in the window (14-day analytics).
- Retry-frequency / MTTR: not yet measurable from one event — the
  analytics stay null until more failures land (honest absence).

## Reproducibility

- Checkpoints stored: one `validation` checkpoint per engine run
  finalize, each carrying the replay contract (objective, prompt, tool
  invocation shapes, verify outcome), capped at
  `UNOWN_PLM_MAX_CHECKPOINTS` (default 2,000) with the retention
  backstop.
- **Replay reproducibility: not measured** — no replay run was executed
  this round; the comparison machinery (`compareReplay`,
  `finishReplay`) is pinned by tests and the score prints null until a
  real replay lands.

## What the numbers prove

1. **Traceability is total** — 31/31 activities left a registry row; the
   `task-mint` job's solvability run appears as a `run` child of its `job`
   parent with its tool usage rollup.
2. **The state machine is enforced, not advisory** — both wiring defects
   that tried to bypass it (F1, F2) were caught by the machine itself in
   live operation, then fixed and pinned.
3. **Recovery is a ledger, not a log line** — the orphan heal landed as a
   classified, executed, validated row with its own evidence.
4. **Honesty holds under operation** — pre-fix ABANDONED rows keep their
   misleading-history value visibly; unmeasured scores print null.
