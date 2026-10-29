# The nocturne round — the validation log

> The failure→root-cause→benchmark→improvement→rerun ledger, continuing the
> gallery-round lineage inherited from the aria round (which reserved F8 and
> recorded zero used entries), before it the Parley round (F3–F7) and the
> SOTA round (F0–F5) — so the nocturne round's entries start at **F8**: never
> patch around a failure; decide where the defect lives (Unown, the caller's
> environment, or the app under construction); fix it where it lives; create
> the regression or benchmark that would catch it; rerun the original
> workflow and record before/after evidence. An entry that ends in "no
> Unown defect" is a valid, wanted outcome — the log exists to make the
> process visible, not to manufacture fixes. Engine-level defects in the
> memory/learning core discovered during this round are also mirrored in the
> validation round's own ledger
> ([`../validation-round/validation-log.md`](../validation-round/validation-log.md))
> when they belong to it.

## Failures

---

## F8 — operator killed a live build session with a blocking shell timeout

**Failure (N4).** The first Lib resume session (N4) was launched with a
blocking `timeout 590 unown --resume …` shell call instead of the detached
F0/F2 launcher contract every prior gallery round used. The shell timeout
fired mid-run and SIGKILLed the agent while it was writing modules — 20
files survived, the run's envelope (turns/tokens receipt) was lost, and the
UX ledger row had to be marked with an operator intervention.

**Reproduction.** Any `unown --resume … < /dev/null > envelope.json` call
under a shell timeout shorter than the run's wall time; the process tree
dies with the shell.

**Root cause.** Operator-side process defect — deviation from the
established launcher contract (the gallery rounds' F0/F2 pattern: stdin
`</dev/null`, stdio to files, `setsid` detach, envelope polled from the
log). Not a Unown defect; the agent's own work survived the kill because
every file write is atomic and the suite stayed runnable.

**Benchmark created.** None needed for Unown itself (no agent defect). The
process control was fixed in-round:
`benchmarks/nocturne-round/sessions/launch.sh` + `poll.sh` (the detached
launcher + poller, per the F0/F2 contract) — every session N5 onward ran
through it and receipted its envelope.

**Improvement implemented + retention.** All subsequent sessions (N5–N9)
launched through the detached launcher; zero further kills. Retained as a
project-memory-worthy lesson (the launcher contract exists for a reason —
use it from session one).

---

## Positive validations (defects the system caught itself — recorded so the
loop's defenses are visible)

- **P8.1 (N8, the escalation-invariant catch).** The seed data written by
  N7 contained an incident whose `lastEscalatedAt` fell 18 minutes AFTER
  its `acknowledgedAt` — a violation of the platform's own
  escalation-only-while-unacked PBT invariant. The round's invariant test
  suite caught it on the next run without any operator involvement, and the
  N8/N9 fix loop repaired the seed. This is the self-improving-harness
  pattern working at the app layer: invariants minted from the plan
  contract caught a defect the writing session did not notice.

