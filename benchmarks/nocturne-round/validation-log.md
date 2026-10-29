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

## F9 — session-id collision in loginSession (a P0 the API test lane surfaced, the agent misdiagnosed twice, the operator traced, and the fed diagnosis converged in one session)

**Failure (N13–N14, surfaced by `rotations.test.ts`).** The test "an admin
deletes a teammate's override → 204" failed persistently: the admin's DELETE
returned 403 with `permission: rotation.override` while every unit-level
RBAC check passed in isolation.

**Reproduction.**
[`sessions/debug-theo.ts`](sessions/debug-theo.ts) (the operator's trace
script, kept as the receipt): `loginSession(theo)` → create an override
(seq bumps via `nc_ovr_100`) → `loginSession(sam)` → `loginSession(theo)`
again — theo's second session id collides with sam's, `sessionFromRequest`
resolves theo's cookie to **sam's session** (role responder), and the
admin-lane DELETE 403s.

**Root cause.** `src/app/nocturne/api/_state.ts:loginSession` built the
session row with `createSession(userId, tenantId, nowClock(), s.seq)` —
reading the state's `seq` counter WITHOUT bumping it (`store.nextId()` is
the only bumping allocator). Two consecutive logins with no other
seq-bumping operation between them minted IDENTICAL session ids
(`nc_ses_<seq>`), and `findStoredSession` resolves by first match — in a
real deployment, the second user to log in could act as the first. The
domain module's `sessions.test.ts` never caught it because it exercised
`createSession` one row at a time, never two consecutive state-level
logins.

**Memory contribution analysis.** The project memory carried the RBAC
carve-out semantics correctly (the agent re-derived them each session), but
nothing pinned the "ids must come from the bumping allocator" invariant —
the failure mode lived in the gap between the domain contract (fugue `seq`
pattern, plan §1) and the API state layer's implementation.

**Benchmark created.** The regression pin added to
`src/app/nocturne/api/__tests__/auth.test.ts` (N15): three consecutive
loginSessions (theo, sam, theo) must yield three DISTINCT session ids and
each cookie must resolve to its own user — plus the pre-existing
admin-delete test as the behavioral pin.

**Improvement implemented + rerun.** N15 (a fresh session fed the precise
diagnosis): `loginSession` now allocates through `nextId("ses")` — 14 turns,
one pass. Re-run: API suite 78/78 green, full repo 1880/1880 green
(was 1879/1), typecheck clean.

**Honest UX finding.** The agent's own fix loop did NOT converge on this
across two sessions (N13 circled the permission gate; N14 "misread its own
edits" — visible context drag at 520 s/capped). The operator had to
intervene with the trace (1 intervention row). The counter-signal worth
keeping: once fed a precise repro, the same agent fixed it cleanly in 14
turns — the failure was diagnosis, not execution. Candidate for a minted
task (diagnose-an-id-collision-from-a-repro) and a memory rule (ids come
from the bumping allocator, never a raw `s.seq` read).

**Retention.** Regression test in the suite — the scenario now passes
consistently (re-run verified above).

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

