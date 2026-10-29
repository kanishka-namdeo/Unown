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

## F10 — the landing phase shipped a page/route conflict that broke the production build (a P0 caught after the push)

**Failure (found by the excellence round's baseline, 2026-10-29).** `bun run
build` on `main` at `6d043c5` failed with *"Conflicting route and page at
/nocturne/status/[slug]: route at /nocturne/status/[slug]/route and page at
/nocturne/status/[slug]/page"* — the App Router forbids a `page.tsx` and a
`route.ts` in the same segment. CI's `build` job went red on the push, the
Vercel deploy of `6d043c5` failed (production kept serving the prior commit),
and the deploy-verify workflow run for the SHA reported the failure.

**Reproduction.** Checkout `6d043c5`, `bun install`, `bun run build` — the
Turbopack error above, exit 1. `bun test src` stays green the whole time
(1909/1909): the conflict is invisible to the unit lane and only surfaces in
the bundler.

**Root cause.** App-side defect (Unown-the-repo, not the agent engine): the
nocturne round's landing phase added the public status JSON route and the
public status HTML page at the SAME path, and the round's verification
checkpoint recorded "136 landing tests green" without a production-build run
before the push. The repo's own root contract (AGENTS.md: the landing page
auto-deploys on push to main *in parallel with CI, not after it*) means a
red build reaches the deploy lane — the gate that would have caught this is
a local `next build` before commit, which no documented round checklist
step enforces.

**Fix implemented.** The JSON twin moved to
`/nocturne/api/public-status/[slug]/route.ts` (house style: every other
nocturne data route lives under `/nocturne/api/`); the HTML page stays at
`/nocturne/status/[slug]`. The provider fetch, the component-test mock and
the doc comments updated to the new path. Commit `3c4cf87`→follow-up: build
green (both routes listed), 388/388 nocturne tests green, 1909/1909 repo.

**Benchmark created.** None beyond the existing CI `build` job — the gap was
process, not coverage. The excellence round's pre-push checklist (its
session doc, CP0) now pins `bun run build` as a required local gate before
every push, and the website-excellence screenshot lane depends on the
standalone build, making a broken build un-screenshotable and therefore
un-shippable in the new flow.

---

## F11 — four lint errors shipped to main (the round's closeout skipped `bun run lint`)

**Failure (found by the excellence round's baseline, 2026-10-29).** `bun run
lint` on `main` at `6d043c5` failed with 4 errors: `react-hooks/immutability`
(nocturne-provider: `reopen` referenced `openIncident` before declaration —
"use before declare" inside a `useCallback` chain), and two
`@typescript-eslint/no-require-imports` (`require("node:crypto")` inside two
test bodies in `sessions.test.ts`), plus two stale `eslint-disable`
directives.

**Reproduction.** Checkout `6d043c5`, `bun run lint` — exit 1 with the four
errors above.

**Root cause.** Same class as F10: the nocturne round's closeout ran the
unit suite but not the lint gate before pushing. The provider defect is a
real ordering bug pattern (calling a `useCallback` that is lexically
declared later — it worked at runtime only because the call happens after
mount, but the compiler is right to reject it); the test-file defects are
CJS habits inside an ESM suite.

**Fix implemented.** `openIncident` hoisted above `reopen` with its
dependency added to `reopen`'s deps array (the stale `eslint-disable`
dropped); the two `require()` calls lifted to one top-level
`import { createHmac } from "node:crypto"`; the unused disable in
`public-status.tsx` removed. Lint green (0 errors, 4 pre-existing warnings
in `scripts-dev/` debug probes and one fugue warning — out of scope here).

**Benchmark created.** The existing CI `lint` job is the regression net;
the process fix (lint in the pre-push checklist) is the actual prevention.
Recorded in the excellence round's session doc CP0 alongside F10's build
gate.

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

