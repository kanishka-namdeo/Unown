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

## Improvements

(none yet — the first improvement entries will carry: baseline behaviour,
improved behaviour, benchmark delta, and the receipts that prove both.)
