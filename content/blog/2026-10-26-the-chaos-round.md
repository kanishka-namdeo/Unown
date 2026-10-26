---
title: "The chaos round: orphaned fleets, stolen steering, and the reports that lied"
description: "The chaos round: nested CLI calls, watchdog kills, oversized reports, slow children outliving the process. Seven findings, fixed and pinned."
date: 2026-10-26
lastmod: 2026-10-26
tags: [subagents, release]
type: release
media: [/landing/tui/fleet/fleet.mp4, /landing/tui/fleet/stills/03-ask-question.png]
---

Round one of the [subagent stress
round](https://github.com/kanishka-namdeo/Unown/blob/main/content/blog/2026-10-26-the-subagent-stress-round.md)
drove the system the way its docs promise: sequential chains, parallel batches,
worktree isolation, steering. It found six defects and fixed them. What it did
not drive is what happens when things go *wrong* — when a child is killed
mid-work, when a report is too big, when a fleet child shells out to the CLI
itself, when a background child outlives the process that spawned it. On
2026-10-26 we ran that round: the chaos scenarios, against the same metered
production endpoint, in a fresh project (SplitLite, an expense-splitting API
with planted quirks). The competitor sweep came first — six products' issue
trackers ranked by real-user hit frequency — so the round would spend its
tokens where users actually bleed.

## What the competitors keep filing

The sweep across Claude Code, Crush, Gemini CLI, OpenCode, Codex and Amp issue
trackers collapsed into five families, in order of how often real users hit
them: **hang-and-kill** (children that run forever, wall-clock guards that
don't exist, OpenCode #11865 with 27 comments), **lying results** (cap-hits
and provider drops reported as success, silently truncated reports — Gemini
CLI #22323, OpenCode #37852 with 57 upvotes, Claude Code #91580), **concurrency
contention** (unbounded fan-out, `.git/config.lock` races, the 39-upvote
request for a max-parallel setting), **nested delegation** (grandchild
permission asks that never render, completion notifications that never arrive),
and **cost truth**. Round one had already shipped turn caps and the injection
shield. The chaos round took the first three families head-on.

## The parent that reported success while orphaning its children

The scenario sounds contrived until you run it: an async fleet child whose
task makes it run a ~80-second bash command. The parent spawns it, says
"SPAWNED", and waits. Fifteen seconds later the parent process exits — code 0,
success — with zero result deliveries. The child is still mid-command. The
child's work lands on a dead pipe and evaporates. The caller, unattended,
reads exit 0.

The instrumented timeline nailed the sequence: the print-mode **hard-exit
timer** — a 15-second grace armed at the SPAWNED turn's final `agent_end`,
designed to defeat keep-alive sockets — fired while the fleet drain was still
waiting for the child. The two guards had never been introduced to each other:
the drain's contract says "wait up to 900 s for children AND the model's answer
to the last result"; the hard-exit's contract says "the answer is written,
leave after 15 s." With a child that finishes inside the grace window, the
race is invisible — which is exactly why round one's live verification passed
and this one didn't.

The fix is a new synchronous probe, `isFleetBusy()` — live children, or
batched-but-undelivered results, or an in-flight result turn — consulted by
both exit guards: the hard-exit timer re-arms while the fleet is busy, and the
180-second stall watchdog counts fleet liveness as session liveness (a healthy
fleet produces no session events while its children work; the guard was
killing long-but-fine runs as "stalled"). Live re-verification: the identical
shape — a 45-second child against the real endpoint — now holds the parent
open for 64 seconds, delivers the result, prints the synthesis, exits 0 with
content instead of exit 0 with nothing.

## The grandchild that stole the steering

Fleet children are steered through a control file: the orchestrator appends a
command, the child polls every 250 ms. The child is spawned with the file's
path in its environment — and environments are inherited. When a fleet child
runs `unown -p …` through its bash tool, the grandchild inherits the control
file's path too, and *its* fleet-child extension dutifully starts polling the
same inbox. Two pollers, one file, read-and-clear semantics: whoever polls
first eats the command.

The live probes made the damage concrete. Injected steer markers were consumed
from the file and delivered *nowhere* — stolen by the grandchild, whose
delivery path silently swallowed them; the rightful child never saw them.
Markers injected after the tree died sat in the file forever, unconsumed. A
controlled repro with the grandchild removed proved the child's own lane was
never broken — the loss was pure theft.

The fix mirrors one the vendored bash tool already had: it strips `PI_*`
session variables from the environment of every process it spawns. The four
`UNOWN_FLEET_*` variables now get the same treatment — the control channel is
private to the direct child, and a nested CLI grandchild can't race its parent
for commands it was never meant to see. Live re-verification: three steers
injected mid-flight, three acknowledgments in the child's session, zero
markers in the grandchild's.

![the ask lane: a fleet child parks a question, the orchestrator answers through the same control channel](/landing/tui/fleet/stills/03-ask-question.png)

<video controls muted playsinline width="880" poster="/landing/tui/fleet/stills/02-async-ack-fleet-widget.png">
  <source src="/landing/tui/fleet/fleet.webm" type="video/webm"/>
  <source src="/landing/tui/fleet/fleet.mp4" type="video/mp4"/>
</video>

## The reports that lied

Two findings in the "lying results" family, both live-reproduced:

**The timeout that wore an exit code as a disguise.** A worker killed by the
300-second wall-clock watchdog surfaced to the parent as `exit 143` — a bare
code the model had to reverse-engineer, mid-sentence answer-so-far standing in
as the final report. (The live orchestrator *guessed*: "Two were cut short
(exit 143)." It had no way to know the harness had killed them for time, or
that the budget was 300 seconds.) The section header now names the cause and
the budget — `timeout; killed at 300s budget` — and the body says plainly that
the text above is mid-work, not a report. The async lane's stop reason —
timeout versus orchestrator request — now rides the delivered result instead
of dying in the log.

**The truncation that passed as whole.** A deep-reporting child returned
16,063 characters — 63 over the cap — ending mid-word *inside a code
snippet*. No marker, no note. The parent model, asked to report the exact size
of what it received, answered "4,833 characters" and correctly deduced
truncation from the missing sections: it had to infer a cut the harness knew
about and never said. Both lanes now append a visible note naming the cap and
the remedy — compress, or write the full report to a file and return the path.

## The quieter three

**The read-only child handed a writing task** burned 42 turns and 133k tokens
attempting the impossible before dying at the wall-clock cap — "missing
access" in the BLOCKED protocol was too abstract for the model to map onto "I
have no write tool." The boundary instructions now name the shape: a task that
needs a tool you do not have is a missing-access blocker, refused in the FIRST
reply.

**The timeout that didn't compose.** The docs promise the per-agent
`timeoutMs` frontmatter works in the async fleet lane; the fleet watchdog read
only the manager-level default (the browser agent's documented 600 s budget
silently ran to 900 s). Each child's watchdog now resolves its own routing
budget with the sync lane's clamp.

**The fan-out with no ceiling.** The batch cap bounds one call at four; the
stack of async spawns across turns was unbounded — the exact gap behind
Claude Code's 20-slot cap and OpenCode's most-upvoted feature request. The
fleet now caps live children at 8 per session (`UNOWN_FLEET_MAX_CONCURRENT`,
0 = unlimited), and the overflow is a typed failure that tells the model what
to do instead: wait for results, check `task_control {action:"list"}`, or stop
a child.

## The receipts

- Twenty-four pins in
  [`test/subagent-stress-round2.test.ts`](https://github.com/kanishka-namdeo/Unown/blob/main/pi-repo/packages/self-learning/test/subagent-stress-round2.test.ts)
  — status-label precedence, boundary text, fleet truncation and stop-reason
  notes, cap resolver semantics, the `isFleetBusy` legs, spawn refusal at the
  cap with slot reopening.
- Three end-to-end regressions through the real CLI and mock bridge
  ([`test/cli/task-structured.test.ts`](https://github.com/kanishka-namdeo/Unown/blob/main/pi-repo/packages/self-learning/test/cli/task-structured.test.ts)):
  the truncation note, the fleet-env strip proven by a fleet child whose own
  `env | grep UNOWN_FLEET_` finds nothing, and the print-mode run that stays
  alive four times past a 2-second exit grace while its child sleeps — the
  exact prompt that orphaned pre-fix.
- The golden harness itself gained an async-lane fix: mock scripts now fire
  once per user text, because steer-delivered fleet results land as
  user-role messages and the old matcher re-fired scripted tool calls into an
  infinite spawn loop.
- The full self-learning suite at the release cut: **4,737 pass / 0 fail /
  92 skipped, across 200 files**; the two critical fixes re-verified live
  against the same endpoint that exposed them.
- The [CHANGELOG](https://github.com/kanishka-namdeo/Unown/blob/main/CHANGELOG.md)
  carries the round under 0.0.25; the limits table in
  [docs/subagents.md](https://github.com/kanishka-namdeo/Unown/blob/main/docs/subagents.md)
  is the honest ledger.

## What this round did not cover

The fleet's ask-park edge cases (stop while parked, a re-ask with identical
text) are pinned by the fake-pi harness but were never parked live. The
failure-cascade shape — N simultaneous failures each triggering their own turn
— was measured, judged bounded by the batch cap of four, and deliberately left
as designed. The worktree name-collision seam (48-character truncation on very
long agent names) is real in the code and unprobed at speed. And the orphans a
*crashed* parent leaves behind now die with the tree but still leave no
registry trace — the reaper registration for fleet children is the next
round's first scenario. Each is written down; none is a surprise waiting to
happen.
