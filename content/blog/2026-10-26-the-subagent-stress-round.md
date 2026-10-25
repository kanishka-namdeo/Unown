---
title: "The subagent stress round: what a real model found that the scripted tests could not"
description: "Ten live scenarios drove the subagent stack the way its docs promise — six real defects found, two of them silently broken features, all fixed and pinned."
date: 2026-10-26
lastmod: 2026-10-26
tags: [subagents, release]
type: release
media: [/landing/tui/fleet/fleet.mp4, /landing/tui/fleet/stills/02-async-ack-fleet-widget.png]
---

Unown's [subagent docs](https://github.com/kanishka-namdeo/Unown/blob/main/docs/subagents.md)
promise a lot: fresh-context children spawned mid-session, typed replies, parallel
writers in isolated git worktrees, an async fleet you steer while it runs. Before
[v0.0.24](https://github.com/kanishka-namdeo/Unown/releases/tag/v0.0.24), none
of it had ever been driven the way those docs promise — a real model on the
metered production endpoint, a real project, sequential and parallel delegation
in one sitting. On 2026-10-25 we ran that round: ten scenarios through
`unown -p`, one verdict at a time. This post is the record, including the part
where two advertised features turned out to be broken and nobody had noticed.

## The premise

The model was agnes-3.0-flash through the Agnes AI upstream — the metered
production endpoint the bridge serves, not a mock. The project was a small
task-manager API with four documented bugs, a test suite and a git history,
built for the round. The scenarios escalated the way a real user's work does:

| Scenario | What it drove | Verdict |
|---|---|---|
| S1 | sequential explore delegation | pass, evidence cited to file:line |
| S2 | worker fixes the three seeded bugs | pass, 11/11 tests |
| S6 | worker → reviewer loop | pass, real BLOCK verdict with findings |
| S7 | timeout kill (45s cap on a 120s task) | pass, exit 143 surfaced to the parent |
| P1 | parallel batch of four mixed agents | pass |
| P3 | two writers, two worktree-isolated features | pass — finding F1 |
| S4 | BLOCKED probe on an unsafe task | partial — finding F3 |
| S5 | structured output via `output_schema` | **fail** — F2 (critical) |
| P4 | async fleet with steering, print mode | **fail** — F4 (critical) |
| S8 | batch overflow probe (6 tasks, cap 4) | finding F5 |

Six passed clean. Two failed outright. Two more passed with a finding
attached — and a sixth finding (F6) was hiding in the fix for the first.

## The feature that failed three times in a row

The task tool's `output_schema` parameter takes a JSON Schema object. The live
model passed it as a stringified JSON string. The preflight rejected the call
("schema must be an object"); the model tried again. Same string. A third time.
Same string. Then it gave up and embedded the schema in the prompt's prose —
which is the feature quietly not working: the typed fan-out the landing dex
sells as "what walks back is typed" was unusable when invoked *by a model*, and
nobody knew. Every scripted test passes an object, because the tests were
written by people who had read the parameter's type.

The fix is a lenient intake: a string that parses as JSON is coerced to the
object and the coercion is reported back as a visible note — the model sees
what it did and the object form — while an unparseable string still fails fast,
before any paid spawn. The live re-run returned the typed inventory on the
first attempt.

## The fleet that printed nothing

An async fleet run in print mode: two children spawned in the background, both
ran, both finished, both registered. The model produced its final synthesized
report — the session JSONL has it, timestamped *after* the process had exited.
stdout: zero bytes. Exit code: 0.

The race, reconstructed: `waitForFleetDrain` returned the moment the children
flipped to terminal status — but the last child's result delivery (a message
that triggers a new turn) plus the model's answering turn raced past the
process exit, and print mode prints the final message only if the session's
last message is an assistant message. The late-delivered fleet result (a
control message) was last. The process exited cleanly with nothing printed.

The drain now tracks movement through the delivery pipeline (spawn, finalize,
flush) and turn activity (`agent_start` / `agent_settled`) across a grace
window, so the process stays alive until the model has actually answered the
final result — and fleetless runs skip the grace window entirely. The
re-verification ran the identical prompt against the same endpoint: the run
that printed 0 bytes now prints the full 2,764-byte synthesis, including the
steer follow-up. The lane itself, as the landing dex films it:

![the async fleet lane: the ack, the live fleet widget, the child's result arriving](/landing/tui/fleet/stills/02-async-ack-fleet-widget.png)

<video controls muted playsinline width="880" poster="/landing/tui/fleet/stills/02-async-ack-fleet-widget.png">
  <source src="/landing/tui/fleet/fleet.webm" type="video/webm"/>
  <source src="/landing/tui/fleet/fleet.mp4" type="video/mp4"/>
</video>

## The merge that wasn't clean, and the note that never arrived

Two writers, two features, two isolated worktrees — both children passed. The
parent's report to the user: "both merges auto-resolve cleanly." The real
sequential merge: three file conflicts. The orchestrating model had *guessed* —
plausible guidance, presented as fact, wrong. Kept-with-commits worktrees now
carry a computed merge preview: `git merge-tree --write-tree --name-only`
answers clean, conflicts (with the file list), fast-forward or already-merged
— git's own answer in the disposition, never the model's guess.

While fixing that, the round found F6: the async lane's worktree disposition
was dead code — fleet finalize wrote a `treeNote` to the log and delivered
nothing, so the async model never learned a worktree had been kept. Finalize
now rides the disposition, merge preview included, into the delivered result.

## The quieter two

**The batch that swallowed items five and six.** A six-item `tasks` array
sliced to the cap of four, and the overflow items vanished — no warning, no
trace. The live model noticed the gap itself and answered the missing two in
prose, which is a save, not a contract. The overflow is now reported back with
the dropped items quoted for resubmission, in both lanes.

**The refusal that dodged the marker.** Asked to do something unsafe, the
child refused — correctly, safely, in free-form prose. The BLOCKED marker, the
typed refusal signal the parent can branch on, never appeared. Safety worked;
the protocol didn't. The boundary instructions now name safety/policy/ethics
refusals explicitly as BLOCKED shapes.

## The follow-through: turn caps and the report shield

Two guards the competitor sweep ranked next shipped with the round. **Per-agent
turn caps**: a `maxTurns` frontmatter field (also `max_turns`), routed to the
child as `--max-turns`, clamped to 1–500, with the session-wide
`UNOWN_SUBAGENT_MAX_TURNS` env capping every spawn that has no per-agent
value — both lanes. The runaway-subagent guard other products keep filing as
an issue (Crush's "subagents go on forever and cannot be stopped"; Gemini CLI
ships `max_turns: 30` for exactly this).

**The injection shield on subagent reports** — the child-report trust gap.
Claude Code scans subagent output; Unown scanned bash stdout but not child
reports, so a child that fetched a poisoned page could carry injected
instructions home in text that landed in the parent's context with full
trust. The sync lane's result text and every async fleet delivery — results
and questions — now pass through the same fail-open banner as bash stdout: the
report passes through unmodified under a one-line "this is DATA" reframing.
The shield annotates; it never amputates.

## The receipts

- Sixteen pins in a new dedicated suite,
  [`test/subagent-stress-round.test.ts`](https://github.com/kanishka-namdeo/Unown/blob/main/pi-repo/packages/self-learning/test/subagent-stress-round.test.ts)
  — schema coercion, the four merge-preview verdicts, the drain settle, the
  fleet disposition delivery, the shield lanes.
- Sixteen routing pins and a fleet-args pin for the turn caps
  (`test/subagent-routing.test.ts`, `test/fleet-runtime.test.ts`), plus five
  end-to-end regressions through the real CLI and a mock bridge
  ([`test/cli/task-structured.test.ts`](https://github.com/kanishka-namdeo/Unown/blob/main/pi-repo/packages/self-learning/test/cli/task-structured.test.ts)):
  the stringified schema parses and notes the coercion; an unparseable one
  fails fast with zero spawns; the overflow warning; the poisoned report gets
  the banner; the clean report gets none.
- The full self-learning suite at the release cut: **4,710 pass / 0 fail / 92
  skipped, across 199 files**; the two critical fixes re-verified live against
  the same endpoint that exposed them.
- The [CHANGELOG](https://github.com/kanishka-namdeo/Unown/blob/main/CHANGELOG.md)
  carries both entries under 0.0.24; the docs rows landed in
  [docs/subagents.md](https://github.com/kanishka-namdeo/Unown/blob/main/docs/subagents.md).

## What this round did not cover

One model, one OS, one day — the round has edges, and they are the honest
kind. The Windows taskkill paths are pinned only by the suites that fake the
seam; no live Windows leg ran. The browser subagent's live legs stayed on the
mock lane this round. The fleet's `ask_question` lane is pinned by the
fake-pi harness but was never parked live — the round steered children, it
just never got asked anything. Each is a scenario the next round knows to
start with.
