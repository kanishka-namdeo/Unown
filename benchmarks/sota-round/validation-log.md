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

### F5 — the environment-resurrection pair: launcher teardown kill re-verified + the parallel-predecessor collision (closed: caller environment ×2, one procedure gap)

> Numbered F5 in the shared lineage: F3/F4 live in the parley round's log
> ([the envelope fix](../../parley-round/validation-log.md) shipped by the
> predecessor session while this one was cloning — the same lineage's other
> branch, discovered mid-collision and reconciled below).

- **Description:** resuming the round on a fresh machine produced two failures
  in sequence. (a) A headless `unown -p … &` build session (plain `nohup`,
  backgrounded) died silently within ~90 s of the launching tool call ending —
  empty log, process gone, while the bridge usage log proved the session had
  started (3 upstream calls). (b) A UI-phase build session launched from a
  clone at `6d40de2` spent ~14 minutes rebuilding work that was already
  committed: the predecessor operator session was still alive and pushing
  (`3d10ed4` parley UI, `c05c9c2` CSP, `8cb4dff` SOTA midpoint — all
  timestamped after the clone), and the fresh clone's git log showed none of
  it.
- **Reproduction:** (a) process-table comparison across tool calls + the
  bridge usage log (session started, then gone; the engine/bridge — spawned
  through an intermediate process that exits immediately — survived every
  call). (b) `git fetch origin` on the supposedly-current clone returned
  `6d40de2..8cb4dff main -> origin/main` — four remote commits, one of them
  the exact phase the local session was re-doing; local receipts
  (`2026-10-28180733-0l4y.jsonl`, 144 tool rows) overlapped the remote
  commit's file list.
- **Root cause:** (a) F2's exact mechanism, re-verified on the new host: the
  caller harness's teardown kills direct descendants even under
  `nohup … &`; only the intermediate-exit spawn shape survives. (b) a
  procedure gap, not a tool defect: the clone was taken while the
  predecessor session was mid-flight, and no fetch-before-launch check
  existed to catch the divergence before spending a session on it.
- **Unown defect?** No — (a) is F2's family (caller environment, documented
  contract); (b) is an operator-process failure the git preflight in
  AGENTS.md already anticipates ("a pull can move the tree mid-task"), here
  in its clone-side variant.
- **Benchmark created:** this entry + the fetch-before-every-phase-launch
  rule now in the parley session record.
- **Improvement applied:** the intermediate-exit launcher rebuilt for this
  environment (`setsid bash -c 'exec …'` + immediate-exit parent + file
  stdio — the F2-proven shape, verified surviving across five subsequent
  tool calls); the duplicate session killed, its uncommitted writes
  discarded (the remote's committed, tested UI is canonical), its receipts
  retained as this entry's evidence; the round's snapshot driver committed
  (`benchmarks/parley-round/snapshot.mjs`) so the receipts lane survives
  environment changes.
- **Validation evidence:** the E2E session launched through the rebuilt
  launcher ran 50 turns to completion across many tool-call teardowns;
  `git fetch` divergence checks before each subsequent phase launch caught
  no further collision (the predecessor's last push was its midpoint
  snapshot, `8cb4dff`); the remote UI verified green on this machine
  (647 tests, `GET /parley` 200).
- **Retention:** the launcher + the fetch-first rule are now the standing
  procedure for every remaining phase and any future resurrection; F2/F5
  together fully specify the unattended-caller contract for both hosts this
  round has run on.

## Improvements

(none yet — the first improvement entries will carry: baseline behaviour,
improved behaviour, benchmark delta, and the receipts that prove both.)

### F3 — the embed contract dead in production: a three-layer root cause (closed: fixed + verified live)

- **Description:** after embedding Fugue, `curl /fugue/flows` and
  `/fugue/flows?embed=1` returned **byte-identical HTML** and the RSC payload
  serialized `embed:false` for both — in the production standalone build the
  `?embed=1` flag never reached the client tree, so the landing's iframe would
  have shipped the app's full standalone chrome (and the reset channel would
  never arm).
- **Reproduction:** byte-compare + RSC-payload grep (`"embed\\:false` for
  ?embed=1), the redirect route firing on `/fugue?embed=1`, and header
  inspection (`x-nextjs-prerender: 1`, `s-maxage=31536000`).
- **Root cause — three layers, each necessary:** (1) the pages read
  `searchParams` **synchronously** — in Next 15+/16 searchParams is a
  Promise, so the read returned undefined and the route prerendered with
  embed baked false; (2) a **zombie server** (`next-server` pid holding the
  port whose cmdline pkill did not match, its cwd a **deleted** standalone
  dir) served the old build while every "restart" silently died EADDRINUSE —
  two intermediate fixes tested against it and falsely appeared to fail;
  (3) with the reads fixed, Turbopack's static analysis still prerendered the
  sync-outer shell (`force-dynamic` was needed for parity with what the
  other three demo routes get naturally).
- **Unown defect?** No — an app bug (agent-authored pages) + an operator
  test-harness flaw (unverified server identity). Both closed inside the
  round.
- **Benchmark created:** the byte-identity check + RSC-payload grep is now
  the embed lane's acceptance probe (page tests pin the awaited contract;
  the live curl is the release checklist step).
- **Improvement applied:** pages converted to the bazaar/cadence/parley
  sync-outer + Suspense + async-inner shape with `force-dynamic`; the
  redirect/inner exported for the test lane; page tests rewritten to the
  cadence pattern (16 tests).
- **Validation evidence:** fresh server (pid verified, cwd not deleted):
  `/fugue/flows?embed=1` → `"embed":true`; `/fugue/flows` →
  `"embed":false`; `/fugue?embed=1` → 200 (no redirect). Full suite + typecheck
  + build green.
- **Retention:** the operator lesson is recorded here and in the receipt:
  **verify the server process, not just the port** — a listening port proves
  nothing about which build answers.
