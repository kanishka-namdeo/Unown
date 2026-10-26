---
title: "The ledger round: the seams the chaos round wrote down"
description: "Round three paid the chaos round's IOUs: the stop that couldn't un-park, the re-ask that vanished, the name with no entropy, the crash with no trace."
date: 2026-10-26
lastmod: 2026-10-26
tags: [subagents, release]
type: release
media: [/landing/tui/fleet/stills/03-ask-question.png, /landing/tui/fleet/stills/05-resume-registry.png]
---

Every stress round so far has ended the same way: a shipped fix set, a pile of
pins, and a closing section titled *what this round did not cover*. The chaos
round's ledger had four entries. Three of them were seams we knew about and
had never probed live — the fleet's ask-park edge cases (a stop while parked,
an identical re-ask), the worktree name-collision seam, and the reaper
registration for the children of a crashed parent. The fourth, the
failure-cascade shape, was measured, judged bounded by the batch cap, and
deliberately left as designed. On 2026-10-26 we ran round three against that
ledger: the three unpaid edges, live, against the same metered production
endpoint that exposed every previous round. The discipline was the point —
each entry was reproduced *before* any fix was written, because a fix for a
shape you have never seen is a fix for a shape you imagined.

## The stop that couldn't un-park

The fleet's `ask_question` tool parks the child *inside the tool call*: it
writes its question to a file and blocks on a promise that only two things can
resolve — the orchestrator's answer, or a 600-second deadline. That design
survived round two's steering races because a steer while parked *is* the
answer. What nothing had ever exercised is the third command a parent can
send: **stop**.

The probe parked a child on *"Which currency should SplitLite use for expense
totals: USD or EUR?"* and then called the real `stop()`. The child's inbox
poller consumed the stop command — the control file drained to `[]` — and then
nothing happened, because nothing *could*: the stop branch never touched the
parked promise. The wrap-up instruction it delivered queued as a steer into a
turn that could never start. Three seconds later the parent's tree-kill
backstop SIGTERM'd the child mid-park: exit 143, the ask file rotting on disk,
and a stop the child's model never saw. The replay also surfaced a bonus
defect the probe wasn't looking for: the result was delivered **twice** — once
by `stop()`'s own finalize, once again when the killed child's exit handler
re-finalized — two identical "stopped" messages into the parent's context.

The fix follows the shape the steer-while-parked fix established: a stop
resolves the parked tool with an honest cancellation — `[stop requested by the
orchestrator] No answer will come. Finish your current thought in one short
sentence and stop` — returned *verbatim*, never dressed up as
`[orchestrator's answer]`. An interrupted question must not materialize an
answer; that exact fabrication is one of Claude Code's most-filed interrupt
bugs (#87179), and the consensus across every competitor we swept is an
explicit declined/interrupted disposition instead. The child now cleans up its
own ask file on the way out, `finalize()` is idempotent per child, and the
tree-kill backstop grew from 3 s to 12 s — enough for one wrap-up model round
trip — while being unref'd so it can never hold a draining parent open. If the
parent exits first anyway, the round's last fix below is the backstop of the
backstop.

## The re-ask that vanished

The parent dedups ask deliveries so a standing question is delivered once —
without that, round two measured a re-ask loop that ping-ponged forever. But
the dedup key was the question *text*, and the key only cleared when a watcher
tick observed the ask file absent. Reproduce the second ask fast enough —
delete and rewrite the identical question inside one one-second tick window —
and the parent never knows it happened.

Making a live model do that is the interesting part: instructed to ask twice
in *separate* turns, the child's model round trip is seconds wide, the tick
sees the gap, the re-ask delivers — correct only by timing luck. Instructed to
emit **two `ask_question` calls in one assistant message**, the runtime
executes them back to back, the file flips inside one window, and the probe
caught the swallow: one question delivered, the second parked for the full 600
seconds on a question the orchestrator never saw. Gemini CLI ships this exact
bug as a content-keyed history guard (#29026), and the consensus it produced
is the rule we adopted: **dedup on message identity, never on content**. Every
ask payload now carries a monotonic `seq`; the parent dedups on the
`(ts, seq)` pair. Identical text, new instance, new delivery.

The re-verification pass then found the *deeper* defect underneath: with both
calls in flight, the second park overwrote the child's single parked-waiter
slot — the first tool's waiter was lost forever, and the first resolve deleted
the ask file out from under the still-parked sibling. Parked waiters are now a
queue with their questions attached; the file shows the *standing* (latest)
question; an answer satisfies the asker of that standing question — and since
an answer to a question answers every copy of it, identical-text siblings all
resolve on one answer. The live re-run tells the whole story: one standing
question delivered, one answer, both tools resolved, and the child completed
with its `RE-ASK-COMPLETE` marker in four seconds. Pre-fix, that child never
finished at all.

## The name with no entropy left

Worktree spawn ids are built as `<agent-name>-<ts36>-<rand6>` and then
sanitized to 48 characters for the path. Slice 48 off the *front* of a long
name and you cut the suffix off the back: at 38+ characters of name the random
part starts eroding, and at 47+ the id is a pure function of the name — **zero
entropy, every spawn of that agent targeting one path**. The probe gave an
agent a 50-character name and fired two spawns in one batch: the second was
rejected with a typed `create_failed — worktree path already exists`. Then the
real trap: the first child wrote a file and its tree was *kept* (dirty), which
meant the deterministic path was occupied forever — every future spawn of that
agent rejected until a human ran `unown worktrees remove`. A livelock wearing
a legitimate-sounding error.

The truncation is now entropy-preserving: the name's first 32 characters plus
the id's **last 16** — where the timestamp and random suffix live — capped at
48 for the same Windows path-length headroom. The live re-run spawned the same
50-character agent three times across two phases and got three distinct trees,
zero collisions, zero rejections.

## The crash that left nothing behind

The round's headline. SIGKILL a parent mid-child-run — the `kill -9` shape,
not the group kill a terminal delivers — and watch what state remains: the
child itself lingers through its quiet phases (a mid-bash child until the bash
ends, when the dead parent's stdout pipe finally EPIPEs it; a *parked* child
the full 600 seconds, upstream tokens burning the whole time), and the record
of its existence is **zero**. The fleet registry only ever holds finished
children. No journal existed. The control and ask files rot in `.unown/fleet/`.
The worktree journal holds the tree as `spawned` forever. Codex users file
this exact gap as a feature request (#54428: durable reconciliation of
orphaned child turns after process loss).

The fix is the tmux/supervisor consensus shape, minus the daemon. A new
`fleet-reaper.ts` module gives every spawn an append-only journal entry —
`{op:"spawned", pid, parentPid, sessionFile, …}` in `.unown/fleet/journal.jsonl`
— and the child itself heartbeats `{pid, ts}` about once a second. A heartbeat
is the strongest identity a bare pid can never fake: the file is written by
the live child, so *fresh and self-reported* is proof, while a reused pid can
only ever look stale. Then **every session boot sweeps**: journal entries left
open (spawned without a terminal op) whose *parent is dead* are orphans — live
ones are tree-killed and journaled `reaped`, dead ones journaled `abandoned`,
the rotting channels cleaned, and an adopted worktree marked `orphaned` in the
worktree journal — kept on disk for manual recovery, the same rule as any kept
tree. The safety ordering matters more than the mechanics: a live parent
always wins (its children are not ours to touch), never kill a pid you cannot
identify (the process's own `ps` command line must name the child's session
file on macOS and Linux — a probe the release run itself taught us to
port, since macOS has no `/proc`; on Windows, where no cheap cmdline probe
exists, an unverifiable orphan is traced honestly rather than killed), and
the sweep never runs inside a subagent. A
kill-switch ships with it: `UNOWN_FLEET_REAPER=0`.

The live replay is the round's favorite receipt: crash the parent, boot any
`unown` command in that repo, and the boot prints
`fleet crash sweep: 1 live orphan(s) reaped, 0 already dead (traced), 1
worktree(s) marked orphaned` — the journal carrying the terminal record the
dead parent could not write, the fleet dir clean, the orphan gone. Fleet and
sync subagents also now register with the process-wide child reaper (the
SIGINT/SIGTERM/exit hygiene LSP and MCP servers always had), and `dispose()`
cleans channel files while deliberately leaving journal entries *open* — we
killed without observing the outcome, so the next boot records the honest
trace instead of us guessing "finished."

## The receipts

- Four live findings before any fix, two more found *by* the re-verification
  pass (the double-delivery, the waiter clobber) — the round's argument for
  re-running probes against your own fixes.
- 34 new unit pins: the unpark-on-stop text contract, the `(ts, seq)` instance
  dedup including the same-tick window, the waiter queue (concurrent asks,
  sibling resolution, stop-cancels-all), the heartbeat, the sweep's full
  decision table (live-parent skip, heartbeat-gated reap, stale abandon,
  idempotence, worktree orphan-marking), the entropy-preserving truncation
  with the livelock exit, and reaper registration through a real spawn.
- One end-to-end regression through the real CLI: a parent SIGKILLed
  mid-fleet-run, then a second real boot sweeps — journal `reaped`, channels
  cleaned, worktree orphaned, orphan dead.
- All four probes re-verified live post-fix against the same endpoint; the
  full self-learning suite at the release cut: **4,771 pass / 0 fail across
  202 files**; root typecheck clean.
- The [CHANGELOG](https://github.com/kanishka-namdeo/Unown/blob/main/CHANGELOG.md)
  carries the round under 0.0.26, and the limits table in
  [docs/subagents.md](https://github.com/kanishka-namdeo/Unown/blob/main/docs/subagents.md)
  gained its four new honest rows — stop backstop grace, heartbeat cadence and
  freshness, the sweep and its kill-switch.

## What this round did not cover

The failure-cascade shape remains as designed (bounded by the batch cap;
re-measured, still judged acceptable). The ask channel is a single file, so a
different-text concurrent ask overwritten before a watcher tick is never
*shown* to the parent — that asker falls back to the bounded 600-second
best-judgment timeout, and the edge is now documented instead of silent.
Windows cannot cheaply verify a pre-heartbeat orphan's cmdline, so an
orphaned 0.0.25-era fleet child on Windows is traced but left for manual
ending (0.0.26+ children heartbeat, so the window is an upgrade seam, not a
steady state). And the sync lane's own children of a SIGKILLed parent —
covered on the signal paths by the reaper registration but carrying no journal
or sweep of their own — are the round-four candidate, written down where the
next round will find them.
