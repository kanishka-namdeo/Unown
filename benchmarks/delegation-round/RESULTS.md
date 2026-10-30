# The delegation round — results

> **The baseline is measured: Unown v0.0.45 scores 76/100 on the round's ten
> delegation axes, with every number receipt-backed and the gaps exactly where
> the mission aims.** No delegation carries a reason (0/8 spawns with a `why`),
> subagent reuse never happens (0 steers, 0 resumes), headless runs show
> nothing while children work (no delegation events in the print-mode stream),
> and the round's flagship product failure was caught live: a runaway scout
> that burned 596k tokens across 104 turns before the wall clock killed it
> (F26). Against that: handoffs are already decent (84%), the fleet lifecycle
> is honest (failure recovery 2/2), children learn (notes flow, dreams
> consolidate), and the TUI fleet widget is real (pane-truth receipt). The
> after-run (checkpoint 5) re-scores the same workload on the round's build.

- [Environment](#environment)
- [The baseline scores (v0.0.45)](#the-baseline-scores-v0045)
- [Per-lane results](#per-lane-results)
- [The findings ledger](#the-findings-ledger)
- [Reproduction](#reproduction)

## Environment

| What | Value |
|---|---|
| Agent under test | unown 0.0.45 @ `bd4b2d92` (source checkout, `bun bin/unown`) |
| Model path | `agnes-3.0-flash` via the bundled llm-bridge :3031 → Agnes upstream (live) |
| Engine | self-learning engine :3030 (live; notes + dreams on the production path) |
| Delegation policy | `UNOWN_DELEGATION_LEVEL=standard` (the default) |
| Workload | 9 headless lanes + 1 PTY lane, prompts byte-pinned in the runner |
| Receipts | `receipts/baseline-2026-10-30T07-43-53/` (this directory) |
| Scorer | `score-delegation.mjs` output: `receipts/baseline-2026-10-30T07-43-53/scores-baseline.json` |
| Method contract | [README.md](README.md) · the honest limitations (n=1, heuristic handoff, author-scored rubric axes) are binding |

## The baseline scores (v0.0.45)

| Axis | Score | The raw measurement |
|---|---:|---|
| Delegation quality | **86** | 8 spawns · 7 ok · handoff completeness 84% (the one miss is F26's runaway timeout) |
| Subagent reuse | **0** | 0 duplicate spawns · 0 steers/resumes — no reuse event ever happened |
| Context efficiency | **93** | child 901,107 tok · parent 67,207 tok · offload share 93% — **caveat: inflated by F26's 596k burn; offload is not virtue, the outcome axis catches the waste** |
| User explainability | **56** | `why` recorded on 0/8 spawns · agent+cost visible post-hoc on 88% · TUI widget visible (pane receipt) |
| Progress visibility | **55** | TUI fleet widget: box + live rows (pane receipt) · async ack visible · **headless stream: nothing (0/45)** |
| Memory utilisation | **100** | ≈11 child notes delivered for 8 spawns (engine notes Δ20 − 9 parent runs) |
| Learning retention | **70** | post-workload dream: notes consolidated, memory project v3→4, dreams Δ3 (pending not fully drained; trigger 409ed once — F28) |
| Failure recovery | **100** | 2/2 injected failures recovered (unknown-agent typed error + re-plan; path-jail BLOCK surfaced honestly) |
| Autonomous decision quality | **100** | 7/7 decision points ok (roles, batch parallelism, async lane; t1/t2/t4 answered inline — acceptable) |
| Human intervention rate | **100** | 9/9 lanes completed with no intervention-equivalent |
| **OVERALL (mean)** | **76** | mean of the ten measured axes |

## Per-lane results

| Lane | Verdict | Duration | Spawns | What the receipt shows |
|---|---|---:|---:|---|
| t1-map | ✓ | 8 s | 0 | answered inline, correct (fleet-reaper.ts + the 5 ops + both lanes) |
| t2-callers | ✓ | 11 s | 0 | answered inline, correct (tools.test.ts + subagent-catalog.test.ts) |
| t3-triptych | ✓ | 323 s | 3 | batch of 3 scouts; **one runaway** (F26: 104 turns/596k tok, timeout), two clean; all three answers correct |
| t4-script | ✓ | 17 s | 0 | self-hashing script written + run inline; digest verified by the harness |
| t5-review | ✓ | 40 s | 1 | delegated to `reviewer` (the right role), verdict-shaped answer |
| t6a-unknown-agent | ✓ | 212 s | 1 | typed unknown-agent failure surfaced; parent re-planned and got the count |
| t6b-blocked-task | ✓ | 14 s | 1 | child refused the path-jail violation; parent reported the refusal verbatim |
| t7-duplicate | ✓ | 40 s | 1 | inline find + one spawned double-check (compliant); answers agreed on `PI_MODEL_ID` |
| t8-async | ✓ | 9 s (+17 s run1, F29) | 1 (+1 run1) | async spawn, push delivery, correct count; **run1 polled status 7× (F32)** |
| pty-fleet | ✓ (widget + result panes) | ~4 min | 1 | the fleet widget live (`fleet-widget.pane.txt`, still rendered), the delivery with vitals (`fleet-result.pane.txt`); `/tasks` capture missed (non-fatal) |

## The findings ledger

Seven failures caught during the baseline, each with reproduction + root
cause + fix/fix-plan in [validation-log.md](validation-log.md):

- **F26** (product) — the runaway scout: no turn cap, no token budget, no
  loop guard for children; the clock is the only bound. → checkpoint 2 fix.
- **F27** (product) — async deliveries steer the turn but never persist to
  the session transcript. → checkpoint 2 fix.
- **F32** (product) — the parent polls a push channel (7 status calls in
  15 s). → checkpoint 3 fix (ack + status reply state the push contract).
- **F28–F31, F33** (harness) — the dream-trigger 409 without retry, the
  comma-blind marker, the resume lane that continued the prior session file,
  the resume tally that dropped spawns, the capture lane's stale root — all
  fixed in the runner/lane, evidence in the log.

## Reproduction

```bash
bun run agent:start                       # stack up
node benchmarks/delegation-round/run-delegation-bench.mjs --label baseline
UNOWN_ROOT=$PWD python3 benchmarks/delegation-round/pty_fleet_lane.py \
  --run benchmarks/delegation-round/receipts/<baseline-dir>
node benchmarks/delegation-round/score-delegation.mjs --run benchmarks/delegation-round/receipts/<baseline-dir>
```

The scorer is read-only over receipts (zero model spend). The after-run
(checkpoint 5) uses the same commands with `--label after` on the round's
build and `--compare` against this directory.


## The after-run (the round's build @ `91123d47`)

> **The delta: 76 → 79 overall, with the two axes the mission targeted
> moving hardest — user explainability 56 → 92 (the `why` field, stated on
> 12/13 spawns), progress visibility 55 → 100 (persisted deliveries) — and
> the runaway shape GONE: child token spend fell to 38% of baseline, total
> workload spend fell 54%, and the triptych lane dropped 323 s → 43 s.** The
> regressions are two measured artifacts, not hand-waved: the offload-share
> axis reads -18 because the baseline's number was INFLATED by the 596k
> runaway it no longer has (the raw totals tell the real story), and the
> dream trigger 409ed through its whole 5×30 s retry window — the benchmark's
> own load kept the engine busy (the engine's own scheduled dream still
> advanced memory v7 → v8). One new behavior was caught, not hidden: the
> model now sometimes over-retries a delegation (5 reviewer spawns for one
> review, one BLOCKED mid-chain) — a real over-delegation finding the
> delegation-auditor exists to police, and the round's honest limitation.

| Axis | Baseline (0.0.45) | After (round build) | Δ |
|---|---:|---:|---:|
| Delegation quality | 86 | 84 | -2 (13 spawns · 11 ok — MORE delegation, held quality) |
| Subagent reuse | 0 | 0 | = (the t5 retry chain is the new finding — see below) |
| Context efficiency | 93 | 75 | -18 on the SHARE axis; **the raw truth: total spend 968k → 450k tokens (-54%), child spend -62%** |
| User explainability | 56 | **92** | **+36 — `why` on 12/13 spawns, post-hoc vitals 85%** |
| Progress visibility | 55 | **100** | **+45 — persisted deliveries in transcripts (F27/F35 lanes)** |
| Memory utilisation | 100 | 100 | = (child notes ≈22 for 13 spawns) |
| Learning retention | 70 | 40 | -30 — the trigger 409ed ×5 (engine saturated by the run itself; memory still advanced v7→8) |
| Failure recovery | 100 | 100 | = (2/2 injected) |
| Autonomous decision quality | 100 | 100 | = (7/7) |
| Human intervention rate | 100 | 100 | = (9/9 lanes clean) |
| **OVERALL** | **76** | **79** | **+3** |

**The flagship deltas, receipt-quoted:**

- **The runaway is dead**: baseline t3 = `scout (timeout; killed at 300s
  budget; 104 turns, 596k in / 5k out, 111 tool calls)`; after t3 = 43 s,
  3 scouts, all clean (the turn caps + the "if you catch yourself looping,
  STOP" contract line).
- **Premises before delegating works**: the model stated its reason on
  12/13 spawns unprompted (the tool description asks; the ack shows it
  back) — e.g. t8's `_why: User wants the count while the session stays
  free to answer…`.
- **The envelope carries the final synthesis** (F35, caught by this run):
  the first after-run's t8 envelope held the interim "I'll report when it
  lands" while the session's last message had the count — fixed
  (`preferFinalAssistantText`), pinned, and the re-run's envelope carries
  the count.
- **9/9 lanes green** both runs; t8's first after-run failure is kept as
  `task-t8-async.receipt.run1.json` (the F35 reproduction).

**The new finding (honest, not hidden):** the t5 review lane spawned FIVE
reviewers for one review ask — `21 turns/36k` → `3 turns/8k` → `BLOCKED` →
`7 turns/11k` → `9 turns/11k` — re-asking the same review with reworded
prompts. The duplicate detector flags all four pairs (same agent +
Jaccard 0.62–0.75). This is over-retry: one BLOCKED spawn cascaded into
re-spawns where a single follow-up (or reading the BLOCKED reason and
fixing the ask) would do. The scorer counts it (reuse stays 0); the
`delegation-auditor` agent exists to police exactly this shape in
production; and it is the round's top candidate for the next iteration
(n=1 caveat applies — this is one model's discretionary behavior on one
lane).

**The dream axis, honestly:** the post-workload trigger answered 409
`engine-busy` on all five retries — the engine was digesting the
benchmark's own note flood (its scheduled jobs run continuously under that
load). The engine's own dream still ran inside the window (memory project
v7 → 8, notes 74 → 75), so learning DID happen; the axis's formula (a
triggered dream's counters) measures the harness's ability to grab the
scheduler, which the saturated engine denied. Recorded as measured.

**Reproduction:** identical commands to the baseline with `--label after`
(`receipts/after-2026-10-30T08-58-33/`; the t8 run-1 receipt is kept as
the F35 audit trail; the scorer is read-only and re-runnable).
