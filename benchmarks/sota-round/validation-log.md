# The SOTA round — the validation log

> The failure→root-cause→benchmark→improvement→rerun ledger. Rules (the
> round's method, inherited from the Claude Code postmortem loop): never
> patch around a failure; decide where the defect lives (Unown, the caller's
> environment, or the app under construction); fix it where it lives; create
> the regression or benchmark that would catch it; rerun the original
> workflow and record before/after evidence. An entry that ends in "no Unown
> defect" is a valid, wanted outcome — the log exists to make the process
> visible, not to manufacture fixes.

## Failures

### F0 — print-mode "hang": never a Unown defect (closed: caller environment)

- **Description:** the first `unown -p` smoke runs through the Agnes AI bridge
  appeared to wedge after the final answer: the calling shell's pipeline
  stayed open for 120–280 s past completion while the JSON envelope had
  already been written; `timeout N`'s SIGTERM appeared ignored.
- **Reproduction:** 8 controlled runs: foreground runs through the host
  harness (open silent stdin pipe + pipeline stdout) vs background runs with
  file-redirected stdio, FIFO stdins, active periodic writers, with/without
  `timeout`, with/without `bun --inspect`, short stall budgets
  (`PI_PRINT_STALL_MS=20000`), and a detached `ps` genealogy snapshotter
  (2 s cadence) that survived the host's kill.
- **Root cause:** process-table evidence (`/tmp/ps-snap2.log`, the genealogy
  snapshot): the unown process tree exits cleanly **~6–31 s** after prompt
  start every single time — envelope written, exit taken. The lingering
  "wedge" was the *calling harness's* stdin-pipe/completion semantics waiting
  on its own end of the session pipe — exactly the supervisor-control-pipe
  interaction the unown stdin reader's comment warns about (cli.ts: "an open
  idle stdin (an agent harness, an editor, a supervisor)"). A discarded-output
  tool timeout initially masked this and briefly suggested a watchdog
  neutralisation theory; the genealogy snapshotter disproved it.
- **Unown defect?** No. Eight for eight, unown print mode bounded itself
  (worst observed: 31 s end-to-end incl. two Agnes calls).
- **Benchmark created:** this entry — the harness-forensics pattern now
  documented here; the unattended-caller contract (redirect stdio to files,
  background, poll the envelope) is the operating procedure for every later
  build session.
- **Improvement applied:** none to Unown (nothing to fix). Operating
  procedure adopted for the round: all build sessions run backgrounded with
  file-redirected stdio, envelopes polled from files.
- **Validation evidence:** `/tmp/ps-snap2.log` genealogy (processes gone at
  +6 s; harness wait continued +127 s); envelope receipts in
  `unown-smoke*/.unown/receipts/`; 2 bridge calls per run in the usage log.
- **Retention:** n/a (no code change). Lesson retained: never infer a hang
  from a caller-side wait; snapshot the process table first.

### F1 — the memory-lift experiment: a null result, kept honestly (closed: no defect)

- **Description:** the round's first matched-model improvement hypothesis —
  that four editing-discipline rules (what memory would carry after the
  baseline's three measured structural-swap failures) lift the agnes-3.0-flash
  edit-bench pass rate — was tested and **did not lift it**: 103/106 (97.2%),
  identical to the canonical baseline
  ([memory-lift RESULTS](../../edit-bench/results/memory-lift-2026-10-28/RESULTS.md)).
- **Reproduction:** full 106-fixture campaign, same model/fixtures/scoring as
  rerun-2026-10-21, `UNOWN_BENCH_MEMORY_LIFT=1` appending the rules to the
  harness system prompt; env-gated, default runs stay omp-faithful; results
  dirs named `memory-lift-*` so the landing receipt resolver ignores them.
- **Root cause of the null:** the rules targeted the swap category and healed
  one of its three failures (if-else-001), but a **non-target** failure
  appeared (structural-remove-case-label-004, a remove mutation) and the two
  hard swap failures persisted at n=1 — net zero. The rules change behaviour
  (mean task duration −32%, 16.8 s → 11.4 s, early-stop dominant; tokens
  +50%) but not correctness. agnes run-to-run variance is unmeasured
  ("not measured", never a guess).
- **Unown defect?** No — a negative experimental result, the same shape the
  self-improve round published from a different axis ("memory buys
  efficiency, not correctness").
- **Benchmark created:** the `UNOWN_BENCH_MEMORY_LIFT` lane itself (re-runnable
  against any future memory candidate) + the committed receipts.
- **Improvement applied:** none claimed. The engine-side counterpart stands:
  the measured if-else-006 failure became the sandbox capability task
  `swap-if-else-messages` (tasks-swap.ts) so harness cycles hit a real gap;
  it passes 12/12 in the engine's full-tool sandbox — the gap is
  edit-bench-toolset-specific, a measured nuance the Learning Report carries.
- **Validation evidence:** `results/memory-lift-2026-10-28/` (jsonl + summary
  + RESULTS.md); task-suite pins updated (23 tests, 0 fail).
- **Retention:** the null is retained as a finding — the loop's value must be
  shown through the engine's own receipts (mined tasks, gated mints, shipped
  patches with canary confirmation), never from hand-authored rules.

### F2 — background runners killed at tool-call teardown (closed: caller environment)

- **Description:** twice, a detached (`setsid nohup … &`) benchmark runner
  died within a minute of the launching tool call ending — silently, no error
  in its redirected log, its process simply gone.
- **Reproduction:** process-table + log comparison: alive at call end, dead by
  the next call; the engine and bridge (spawned by `scripts/start.ts` through
  an intermediate process that **exits immediately**) survive every call.
- **Root cause:** the host harness's teardown kills **direct descendants**
  even across `setsid`/`nohup`; only children orphaned *before* teardown (the
  intermediate-exit spawn pattern) escape the tree walk.
- **Unown defect?** No — F0's family, caller environment. Unown's own
  `startService` pattern (spawn detached + `unref()` from a short-lived
  spawner) is the host-proven survival shape.
- **Benchmark created:** this entry; the operating procedure is now exact.
- **Improvement applied:** a reusable launcher implementing the proven
  pattern (`detach-run.mjs` in the operator workspace: intermediate spawn,
  stdin `/dev/null`, file stdio, pidfile, immediate exit) — every later build
  session and benchmark run uses it.
- **Validation evidence:** the memory-lift campaign completed 106/106 on the
  third launch (killed at 14 done, killed again at 14, then ran to
  completion); launcher pidfile + log receipts.
- **Retention:** procedure recorded here and in the session receipt; the
  F0/F2 pair now fully specifies the unattended-caller contract on this host.

## Improvements

(none yet — the first improvement entries will carry: baseline behaviour,
improved behaviour, benchmark delta, and the receipts that prove both.)
